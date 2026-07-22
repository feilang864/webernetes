import { expect, it, vi } from "vitest";

import { getClock } from "../../clock-context.js";
import type { V1Node, V1Pod, V1Service } from "../../client/index.js";
import * as context from "../../go/context.js";
import type { Context } from "../../go/context.js";
import { withLatencyProvider, newLatencyProvider } from "../../latency.js";
import { both } from "../../test/describe.js";
import { waitFor } from "../../test/wait.js";
import { PodSandboxInstance } from "../cri/runtime.js";
import {
	ClusterNetwork,
	networkRequestIDHeader,
	type NetworkHop,
	type NetworkRequestEvent,
	type NetworkResponseEvent,
} from "./network.js";

both.describe("ClusterNetwork", ({ ctx }) => {
	it("matches Node fetch errors for invalid and unreachable targets", async () => {
		const network = new ClusterNetwork();
		const origin = nodeOrigin("node-1");
		const cases = [
			{
				target: "http://[:::1]/",
				message: "Failed to parse URL from http://[:::1]/",
				cause: { code: "ERR_INVALID_URL", message: "Invalid URL", name: "TypeError" },
			},
			{
				target: "ftp://example.com/",
				message: "fetch failed",
				cause: { message: "unknown scheme", name: "Error" },
			},
			{
				target: "http://10.1.2.3:8080/",
				message: "fetch failed",
				cause: {
					address: "10.1.2.3",
					code: "ECONNREFUSED",
					message: "connect ECONNREFUSED 10.1.2.3:8080",
					name: "Error",
					port: 8080,
					syscall: "connect",
				},
			},
		] as const;

		for (const { target, message, cause } of cases) {
			let error: unknown;
			try {
				await network.fetch(ctx, origin, target);
			} catch (caught) {
				error = caught;
			}
			expect(error).toMatchObject({ cause, message, name: "TypeError" });
		}
	});

	it("normalizes fetch init into HTTP requests", async () => {
		const network = new ClusterNetwork();
		const pod = new PodSandboxInstance(
			"sandbox-1",
			{
				metadata: {
					name: "web",
					uid: "pod-uid",
					namespace: "default",
					attempt: 0,
				},
				pod: podOrigin("pod-uid"),
			},
			0,
		);
		const registration = network.setupPodSandbox(pod, "10.244.0.0/24");
		pod.setNetworkRegistration(registration);
		registration.bindHttp(8080, async (_ctx, request) => ({
			status: 200,
			body: JSON.stringify({
				method: request.method,
				url: request.url.toString(),
				header: request.header,
				host: request.host,
				body: request.body,
			}),
		}));

		const response = await network.fetch(
			ctx,
			podOrigin("pod-uid"),
			`http://${registration.ip}:8080/echo`,
			{
				method: "POST",
				headers: {
					Host: "example.test",
					"X-Test": "yes",
				},
				body: "hello",
			},
		);
		expect(response.status).toBe(200);
		expect(JSON.parse(response.body)).toEqual({
			method: "POST",
			url: `http://${registration.ip}:8080/echo`,
			header: {
				Host: ["example.test"],
				"X-Test": ["yes"],
				"X-Webernetes-Request-Id": [expect.any(String)],
			},
			host: "example.test",
			body: "hello",
		});
	});

	it("returns HTTP 500 for handler failures and keeps the listener open", async () => {
		const network = new ClusterNetwork();
		const pod = new PodSandboxInstance(
			"sandbox-1",
			{
				metadata: {
					name: "web",
					uid: "pod-uid",
					namespace: "default",
					attempt: 0,
				},
				pod: podOrigin("pod-uid"),
			},
			0,
		);
		const registration = network.setupPodSandbox(pod, "10.244.0.0/24");
		pod.setNetworkRegistration(registration);

		for (const [index, failure] of ["throw", "reject"].entries()) {
			const port = 8080 + index;
			const message = `handler ${failure}`;
			let calls = 0;
			registration.bindHttp(port, () => {
				calls++;
				if (calls === 1) {
					if (failure === "throw") {
						throw new Error(message);
					}
					return Promise.reject(new Error(message));
				}
				return Promise.resolve({ status: 200, body: "ok" });
			});

			await expect(
				network.fetch(ctx, podOrigin("client-uid"), `http://${registration.ip}:${port}/`),
			).resolves.toEqual({ status: 500, body: message });
			await expect(
				network.fetch(ctx, podOrigin("client-uid"), `http://${registration.ip}:${port}/`),
			).resolves.toEqual({ status: 200, body: "ok" });
		}
	});

	it("returns DNS SERVFAIL for handler failures and keeps the listener open", async () => {
		const network = new ClusterNetwork();
		const pod = new PodSandboxInstance(
			"sandbox-1",
			{
				metadata: {
					name: "dns",
					uid: "pod-uid",
					namespace: "default",
					attempt: 0,
				},
				pod: podOrigin("pod-uid"),
			},
			0,
		);
		const registration = network.setupPodSandbox(pod, "10.244.0.0/24");
		pod.setNetworkRegistration(registration);

		for (const [index, failure] of ["throw", "reject"].entries()) {
			const port = 53 + index;
			let calls = 0;
			registration.bindDns(port, (request) => {
				calls++;
				if (calls === 1) {
					if (failure === "throw") {
						throw new Error("handler failed");
					}
					return Promise.reject(new Error("handler failed"));
				}
				return Promise.resolve({
					rcode: "NOERROR",
					answers: [{ type: "A", name: request.name, address: "192.0.2.1", ttl: 30 }],
				});
			});

			const target = `${registration.ip}:${port}`;
			await expect(network.sendDns(target, { name: "example.test", type: "A" })).resolves.toEqual({
				rcode: "SERVFAIL",
				answers: [],
			});
			await expect(network.sendDns(target, { name: "example.test", type: "A" })).resolves.toEqual({
				rcode: "NOERROR",
				answers: [{ type: "A", name: "example.test", address: "192.0.2.1", ttl: 30 }],
			});
		}
	});

	it("resolves localhost to the origin pod IP", async () => {
		const network = new ClusterNetwork();
		const pod = new PodSandboxInstance(
			"sandbox-1",
			{
				metadata: {
					name: "web",
					uid: "pod-uid",
					namespace: "default",
					attempt: 0,
				},
				pod: podOrigin("pod-uid"),
			},
			0,
		);
		const registration = network.setupPodSandbox(pod, "10.244.0.0/24");
		pod.setNetworkRegistration(registration);
		registration.bindHttp(8080, async (_ctx, request) => ({
			status: 200,
			body: request.url.toString(),
		}));

		await expect(
			network.fetch(ctx, podOrigin("pod-uid"), "http://localhost:8080/healthz"),
		).resolves.toEqual({
			status: 200,
			body: `http://${registration.ip}:8080/healthz`,
		});
	});

	it("resolves localhost to the origin node IP", async () => {
		const network = new ClusterNetwork();
		const pod = new PodSandboxInstance(
			"sandbox-1",
			{
				metadata: {
					name: "web",
					uid: "pod-uid",
					namespace: "default",
					attempt: 0,
				},
				pod: podOrigin("pod-uid"),
			},
			0,
		);
		const registration = network.setupPodSandbox(pod, "10.244.0.0/24");
		pod.setNetworkRegistration(registration);

		network.registerNode(nodeOrigin("node-1"));
		network.registerService(nodePortService());
		network.setServiceTargets("default", "web", 80, [`${registration.ip}:8080`]);
		registration.bindHttp(8080, async () => ({
			status: 200,
			body: "ok",
		}));

		await expect(
			network.fetch(ctx, nodeOrigin("node-1"), "http://localhost:30080/"),
		).resolves.toEqual({
			status: 200,
			body: "ok",
		});
	});

	it("routes requests to registered node IPs through NodePort services", async () => {
		const network = new ClusterNetwork();
		const pod = new PodSandboxInstance(
			"sandbox-1",
			{
				metadata: {
					name: "web",
					uid: "pod-uid",
					namespace: "default",
					attempt: 0,
				},
				pod: podOrigin("pod-uid"),
			},
			0,
		);
		const registration = network.setupPodSandbox(pod, "10.244.0.0/24");
		pod.setNetworkRegistration(registration);

		network.registerNode(nodeOrigin("node-1"));
		network.registerService(nodePortService());
		network.setServiceTargets("default", "web", 80, [`${registration.ip}:8080`]);
		registration.bindHttp(8080, async (_ctx, request) => {
			return {
				status: 200,
				body: request.url.toString(),
			};
		});

		await expect(
			network.fetch(ctx, nodeOrigin("node-1"), "http://192.168.1.1:30080/path"),
		).resolves.toEqual({
			status: 200,
			body: "http://192.168.1.1:30080/path",
		});
	});

	it("routes requests to registered node names through NodePort services", async () => {
		const network = new ClusterNetwork();
		const pod = new PodSandboxInstance(
			"sandbox-1",
			{
				metadata: {
					name: "web",
					uid: "pod-uid",
					namespace: "default",
					attempt: 0,
				},
				pod: podOrigin("pod-uid"),
			},
			0,
		);
		const registration = network.setupPodSandbox(pod, "10.244.0.0/24");
		pod.setNetworkRegistration(registration);

		network.registerNode(
			nodeOrigin("node-1", [
				{ type: "Hostname", address: "node-1" },
				{ type: "InternalDNS", address: "node-1.internal.test" },
			]),
		);
		network.registerService(nodePortService());
		network.setServiceTargets("default", "web", 80, [`${registration.ip}:8080`]);
		registration.bindHttp(8080, async (_ctx, request) => {
			return {
				status: 200,
				body: JSON.stringify({
					url: request.url.toString(),
					host: request.host,
				}),
			};
		});

		await expect(
			network.fetch(ctx, nodeOrigin("node-1"), "http://node-1:30080/path"),
		).resolves.toEqual({
			status: 200,
			body: JSON.stringify({
				url: "http://192.168.1.1:30080/path",
				host: "node-1:30080",
			}),
		});

		await expect(
			network.fetch(ctx, nodeOrigin("node-1"), "http://node-1.internal.test:30080/path"),
		).resolves.toEqual({
			status: 200,
			body: JSON.stringify({
				url: "http://192.168.1.1:30080/path",
				host: "node-1.internal.test:30080",
			}),
		});
	});

	it("stops routing node IP requests after the node is unregistered", async () => {
		const network = new ClusterNetwork();
		const pod = new PodSandboxInstance(
			"sandbox-1",
			{
				metadata: {
					name: "web",
					uid: "pod-uid",
					namespace: "default",
					attempt: 0,
				},
				pod: podOrigin("pod-uid"),
			},
			0,
		);
		const registration = network.setupPodSandbox(pod, "10.244.0.0/24");
		pod.setNetworkRegistration(registration);

		network.registerNode(nodeOrigin("node-1"));
		network.registerService(nodePortService());
		network.setServiceTargets("default", "web", 80, [`${registration.ip}:8080`]);
		registration.bindHttp(8080, async () => ({
			status: 200,
			body: "ok",
		}));

		await expect(
			network.fetch(ctx, nodeOrigin("node-1"), "http://192.168.1.1:30080/"),
		).resolves.toEqual({
			status: 200,
			body: "ok",
		});

		network.unregisterNode("node-1");

		await expectConnectionRefused(
			network.fetch(ctx, nodeOrigin("node-1"), "http://192.168.1.1:30080/"),
			"192.168.1.1",
			30080,
		);
	});

	it("falls back to default fetch for public IP literals", async () => {
		const network = new ClusterNetwork();
		const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("external", {
				status: 200,
				headers: { "Content-Type": "text/plain" },
			}),
		);
		try {
			await expect(
				network.fetch(ctx, nodeOrigin("node-1"), "https://93.184.216.34/"),
			).resolves.toEqual({
				status: 200,
				header: { "content-type": ["text/plain"] },
				body: "external",
			});
			expect(fetch).toHaveBeenCalledWith("https://93.184.216.34/", {
				method: undefined,
				headers: [],
				body: undefined,
				signal: expect.any(AbortSignal),
			});
		} finally {
			fetch.mockRestore();
		}
	});

	it("reports default fetch failures as network errors", async () => {
		const network = new ClusterNetwork();
		const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
		try {
			await expect(
				network.fetch(ctx, nodeOrigin("node-1"), "https://93.184.216.34/"),
			).rejects.toMatchObject({
				cause: { message: "Failed to fetch", name: "TypeError" },
				message: "fetch failed",
				name: "TypeError",
			});
		} finally {
			fetch.mockRestore();
		}
	});

	it("keeps private and local IP literals on the simulated network", async () => {
		const network = new ClusterNetwork();
		const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("external"));
		try {
			await expectConnectionRefused(
				network.fetch(ctx, nodeOrigin("node-1"), "http://10.1.2.3:8080/"),
				"10.1.2.3",
				8080,
			);
			await expectConnectionRefused(
				network.fetch(ctx, nodeOrigin("node-1"), "http://[fd12:3456::1]:8080/"),
				"[fd12:3456::1]",
				8080,
			);
			await expectConnectionRefused(
				network.fetch(ctx, nodeOrigin("node-1"), "http://[fe80::1]:8080/"),
				"[fe80::1]",
				8080,
			);
			expect(fetch).not.toHaveBeenCalled();
		} finally {
			fetch.mockRestore();
		}
	});

	it("routes service requests to registered pod endpoints even after the listener exits", async () => {
		const network = new ClusterNetwork();
		const pod = new PodSandboxInstance(
			"sandbox-1",
			{
				metadata: {
					name: "web",
					uid: "pod-uid",
					namespace: "default",
					attempt: 0,
				},
				pod: podOrigin("pod-uid"),
			},
			0,
		);
		const registration = network.setupPodSandbox(pod, "10.244.0.0/24");
		pod.setNetworkRegistration(registration);

		network.registerService(clusterIPService());
		network.setServiceTargets("default", "web", 80, [`${registration.ip}:8080`]);

		const listener = registration.bindHttp(8080, async () => ({
			status: 200,
			body: "ok",
		}));
		await expect(
			network.fetch(ctx, podOrigin("pod-uid"), "http://10.96.0.10:80/"),
		).resolves.toEqual({
			status: 200,
			body: "ok",
		});

		listener.close();

		await expectConnectionRefused(
			network.fetch(ctx, podOrigin("pod-uid"), "http://10.96.0.10:80/"),
			"10.96.0.10",
			80,
		);
	});

	it("keeps service targets while a service is re-registered before endpoint targets are reconciled", async () => {
		const network = new ClusterNetwork();
		const pod = new PodSandboxInstance(
			"sandbox-1",
			{
				metadata: {
					name: "web",
					uid: "pod-uid",
					namespace: "default",
					attempt: 0,
				},
				pod: podOrigin("pod-uid"),
			},
			0,
		);
		const registration = network.setupPodSandbox(pod, "10.244.0.0/24");
		pod.setNetworkRegistration(registration);
		registration.bindHttp(8080, async () => ({
			status: 200,
			body: "ok",
		}));

		network.registerService(clusterIPService());
		network.setServiceTargets("default", "web", 80, [`${registration.ip}:8080`]);

		await expect(
			network.fetch(ctx, podOrigin("client-uid"), "http://10.96.0.10:80/"),
		).resolves.toEqual({
			status: 200,
			body: "ok",
		});

		network.registerService(clusterIPService());

		await expect(
			network.fetch(ctx, podOrigin("client-uid"), "http://10.96.0.10:80/"),
		).resolves.toEqual({
			status: 200,
			body: "ok",
		});
	});

	it("emits request and response events with service endpoint chains", async () => {
		const network = new ClusterNetwork();
		const pod = new PodSandboxInstance(
			"sandbox-1",
			{
				metadata: {
					name: "web",
					uid: "pod-uid",
					namespace: "default",
					attempt: 0,
				},
				pod: podOrigin("pod-uid"),
			},
			0,
		);
		const registration = network.setupPodSandbox(pod, "10.244.0.0/24");
		pod.setNetworkRegistration(registration);
		network.registerService(clusterIPService());
		network.setServiceTargets("default", "web", 80, [`${registration.ip}:8080`]);
		let handlerRequestID = "";
		registration.bindHttp(8080, async (_ctx, request) => {
			handlerRequestID = request.header[networkRequestIDHeader]?.[0] ?? "";
			return {
				status: 201,
				header: { "X-App": ["ok"] },
				body: "created",
			};
		});

		const requests: NetworkRequestEvent[] = [];
		const responses: NetworkResponseEvent[] = [];
		network.on("request", (event) => requests.push(event));
		network.on("response", (event) => responses.push(event));

		await expect(
			network.fetch(ctx, podOrigin("client-uid"), "http://10.96.0.10:80/"),
		).resolves.toMatchObject({
			status: 201,
			body: "created",
		});

		expect(requests).toHaveLength(1);
		expect(responses).toHaveLength(1);
		const request = requests[0] as NetworkRequestEvent;
		const response = responses[0] as NetworkResponseEvent;
		expect(request.error).toBeUndefined();
		expect(request.latencyMs).toBe(0);
		expect(response.latencyMs).toBe(0);
		expect(request.chain.map((hop) => hop.type)).toEqual(["pod", "service", "pod"]);
		expect(response.chain.map((hop) => hop.type)).toEqual(["pod", "service", "pod"]);
		expect(request.chain[0]).toMatchObject({
			type: "pod",
			resource: { metadata: { uid: "client-uid" } },
		});
		expect(request.chain[1]).toMatchObject({
			type: "service",
			resource: { metadata: { name: "web", namespace: "default", uid: "service-uid" } },
		});
		expect(request.chain[2]).toMatchObject({
			type: "pod",
			resource: { metadata: { uid: "pod-uid" } },
		});
		expect(response.chain[0]).toEqual(request.chain[2]);
		expect(response.chain[1]).toEqual(request.chain[1]);
		expect(response.chain[2]).toEqual(request.chain[0]);
		const requestID = request.request.header[networkRequestIDHeader]?.[0];
		expect(requestID).toEqual(expect.any(String));
		expect(handlerRequestID).toBe(requestID);
		expect(response.request).toBe(request.request);
		expect(response.response?.header?.[networkRequestIDHeader]).toEqual([requestID]);
		expect(response.response?.header?.["X-App"]).toEqual(["ok"]);
	});

	it("emits connection refusals from a selected endpoint as response events", async () => {
		const network = new ClusterNetwork();
		const requests: NetworkRequestEvent[] = [];
		const responses: NetworkResponseEvent[] = [];
		network.on("request", (event) => requests.push(event));
		network.on("response", (event) => responses.push(event));

		await expectConnectionRefused(
			network.fetch(ctx, nodeOrigin("node-1"), "http://10.1.2.3:8080/"),
			"10.1.2.3",
			8080,
		);

		expect(requests).toHaveLength(1);
		expect(requests[0]?.latencyMs).toBe(0);
		expect(requests[0]?.error).toBeUndefined();
		expect(responses).toHaveLength(1);
		expect(responses[0]?.request).toBe(requests[0]?.request);
		expectConnectionRefusedEvent(responses[0]?.error, "10.1.2.3", 8080);
		expect(requests[0]?.chain.map((hop) => hop.type)).toEqual(["node"]);
	});

	it("emits a Service request error without a response when no targets are ready", async () => {
		const network = new ClusterNetwork();
		network.registerService(clusterIPService());
		const requests: NetworkRequestEvent[] = [];
		const responses: NetworkResponseEvent[] = [];
		network.on("request", (event) => requests.push(event));
		network.on("response", (event) => responses.push(event));

		await expectConnectionRefused(
			network.fetch(ctx, podOrigin("client-uid"), "http://10.96.0.10:80/health"),
			"10.96.0.10",
			80,
		);

		expect(responses).toEqual([]);
		expect(requests).toEqual([
			expect.objectContaining({
				request: expect.objectContaining({
					method: "GET",
					url: new URL("http://10.96.0.10:80/health"),
				}),
			}),
		]);
		expectConnectionRefusedEvent(requests[0]?.error, "10.96.0.10", 80);
		expect(requests[0]?.chain.map((hop) => hop.type)).toEqual(["pod", "service"]);
		expect(requests[0]?.chain[1]).toMatchObject({
			type: "service",
			resource: { metadata: { name: "web", namespace: "default", uid: "service-uid" } },
		});
	});

	it("emits a pod connection refusal response when a ready target has no listener", async () => {
		const network = new ClusterNetwork();
		const pod = new PodSandboxInstance(
			"sandbox-1",
			{
				metadata: {
					name: "web",
					uid: "pod-uid",
					namespace: "default",
					attempt: 0,
				},
				pod: podOrigin("pod-uid"),
			},
			0,
		);
		const registration = network.setupPodSandbox(pod, "10.244.0.0/24");
		pod.setNetworkRegistration(registration);
		network.registerService(clusterIPService());
		network.setServiceTargets("default", "web", 80, [`${registration.ip}:8080`]);
		const requests: NetworkRequestEvent[] = [];
		const responses: NetworkResponseEvent[] = [];
		network.on("request", (event) => requests.push(event));
		network.on("response", (event) => responses.push(event));

		await expectConnectionRefused(
			network.fetch(ctx, podOrigin("client-uid"), "http://10.96.0.10:80/health"),
			"10.96.0.10",
			80,
		);

		expect(requests).toHaveLength(1);
		expect(requests[0]?.error).toBeUndefined();
		expect(responses).toHaveLength(1);
		expect(responses[0]?.request).toBe(requests[0]?.request);
		expectConnectionRefusedEvent(responses[0]?.error, registration.ip, 8080);
		expect(requests).toEqual([
			expect.objectContaining({
				request: expect.objectContaining({
					method: "GET",
					url: new URL("http://10.96.0.10:80/health"),
				}),
			}),
		]);
		expect(requests[0]?.chain.map((hop) => hop.type)).toEqual(["pod", "service", "pod"]);
		expect(requests[0]?.chain[2]).toMatchObject({
			type: "pod",
			resource: { metadata: { uid: "pod-uid" } },
		});
	});

	it("dispatches to a listener that attaches during request latency", async () => {
		const clock = getClock(ctx);
		clock.pause();
		const network = new ClusterNetwork();
		const pod = new PodSandboxInstance(
			"sandbox-1",
			{
				metadata: { name: "web", uid: "pod-uid", namespace: "default", attempt: 0 },
				pod: podOrigin("pod-uid"),
			},
			0,
		);
		const registration = network.setupPodSandbox(pod, "10.244.0.0/24");
		pod.setNetworkRegistration(registration);
		const requests: NetworkRequestEvent[] = [];
		const responses: NetworkResponseEvent[] = [];
		let calls = 0;
		network.on("request", (event) => requests.push(event));
		network.on("response", (event) => responses.push(event));
		const latencyCtx = withLatencyProvider(
			ctx,
			newLatencyProvider({
				clusterNetworkRequestLatency: () => 100,
				clusterNetworkResponseLatency: () => 25,
			}),
		);

		const fetchPromise = network.fetch(
			latencyCtx,
			podOrigin("client-uid"),
			`http://${registration.ip}:8080/health`,
		);
		await waitFor(() => expect(requests).toHaveLength(1));
		expect(requests[0]?.error).toBeUndefined();
		expect(requests[0]?.latencyMs).toBe(100);
		clock.step(50);
		registration.bindHttp(8080, async () => {
			calls++;
			return { status: 200, body: "ok" };
		});
		clock.step(50);
		await waitFor(() => expect(responses).toHaveLength(1));
		expect(calls).toBe(1);
		expect(responses[0]?.error).toBeUndefined();
		expect(responses[0]?.latencyMs).toBe(25);
		clock.step(25);
		await expect(fetchPromise).resolves.toEqual({ status: 200, body: "ok" });
	});

	it("evaluates a missing listener after request latency", async () => {
		const clock = getClock(ctx);
		clock.pause();
		const network = new ClusterNetwork();
		const pod = new PodSandboxInstance(
			"sandbox-1",
			{
				metadata: { name: "web", uid: "pod-uid", namespace: "default", attempt: 0 },
				pod: podOrigin("pod-uid"),
			},
			0,
		);
		const registration = network.setupPodSandbox(pod, "10.244.0.0/24");
		pod.setNetworkRegistration(registration);
		const requests: NetworkRequestEvent[] = [];
		const responses: NetworkResponseEvent[] = [];
		network.on("request", (event) => requests.push(event));
		network.on("response", (event) => responses.push(event));
		const latencyCtx = withLatencyProvider(
			ctx,
			newLatencyProvider({ clusterNetworkRequestLatency: () => 100 }),
		);

		const fetchPromise = network.fetch(
			latencyCtx,
			podOrigin("client-uid"),
			`http://${registration.ip}:8080/health`,
		);
		await waitFor(() => expect(requests).toHaveLength(1));
		expect(requests[0]?.error).toBeUndefined();
		expect(responses).toHaveLength(0);
		clock.step(100);
		await expectConnectionRefused(fetchPromise, registration.ip, 8080);
		expect(responses).toHaveLength(1);
		expect(responses[0]?.request).toBe(requests[0]?.request);
		expectConnectionRefusedEvent(responses[0]?.error, registration.ip, 8080);
	});

	it("refuses a request when its listener disappears during request latency", async () => {
		const clock = getClock(ctx);
		clock.pause();
		const network = new ClusterNetwork();
		const pod = new PodSandboxInstance(
			"sandbox-1",
			{
				metadata: { name: "web", uid: "pod-uid", namespace: "default", attempt: 0 },
				pod: podOrigin("pod-uid"),
			},
			0,
		);
		const registration = network.setupPodSandbox(pod, "10.244.0.0/24");
		pod.setNetworkRegistration(registration);
		let calls = 0;
		const listener = registration.bindHttp(8080, async () => {
			calls++;
			return { status: 200, body: "unexpected" };
		});
		const requests: NetworkRequestEvent[] = [];
		const responses: NetworkResponseEvent[] = [];
		network.on("request", (event) => requests.push(event));
		network.on("response", (event) => responses.push(event));
		const latencyCtx = withLatencyProvider(
			ctx,
			newLatencyProvider({ clusterNetworkRequestLatency: () => 100 }),
		);

		const fetchPromise = network.fetch(
			latencyCtx,
			podOrigin("client-uid"),
			`http://${registration.ip}:8080/health`,
		);
		await waitFor(() => expect(requests).toHaveLength(1));
		listener.close();
		clock.step(100);
		await expectConnectionRefused(fetchPromise, registration.ip, 8080);
		expect(requests[0]?.error).toBeUndefined();
		expect(responses).toHaveLength(1);
		expectConnectionRefusedEvent(responses[0]?.error, registration.ip, 8080);
		expect(calls).toBe(0);
	});

	it("terminates an in-flight request when its target pod is removed during processing", async () => {
		const network = new ClusterNetwork();
		const pod = new PodSandboxInstance(
			"sandbox-1",
			{
				metadata: {
					name: "web",
					uid: "pod-uid",
					namespace: "default",
					attempt: 0,
				},
				pod: podOrigin("pod-uid"),
			},
			0,
		);
		const registration = network.setupPodSandbox(pod, "10.244.0.0/24");
		pod.setNetworkRegistration(registration);
		network.registerService(clusterIPService());
		network.setServiceTargets("default", "web", 80, [`${registration.ip}:8080`]);
		let started = false;
		let release: (() => void) | undefined;
		const processing = new Promise<void>((resolve) => {
			release = resolve;
		});
		registration.bindHttp(8080, async () => {
			started = true;
			await processing;
			return { status: 200, body: "completed" };
		});
		const requests: NetworkRequestEvent[] = [];
		const responses: NetworkResponseEvent[] = [];
		network.on("request", (event) => requests.push(event));
		network.on("response", (event) => responses.push(event));

		const fetchPromise = network.fetch(ctx, podOrigin("client-uid"), "http://10.96.0.10:80/work");
		await waitFor(() => expect(started).toBe(true));
		registration.unregister();
		release?.();

		const error = await fetchPromise.catch((caught: unknown) => caught);
		expect(error).toMatchObject({
			message: "fetch failed",
			name: "TypeError",
			cause: {
				code: "UND_ERR_SOCKET",
				message: "other side closed",
				name: "SocketError",
			},
		});
		expect(socketErrorConstructorName(error)).toBe("SocketError");
		expect(requests).toHaveLength(1);
		expect(requests[0]?.error).toBeUndefined();
		expect(requests[0]?.chain.map((hop) => hop.type)).toEqual(["pod", "service", "pod"]);
		expect(responses).toHaveLength(1);
		expect(responses[0]?.request).toBe(requests[0]?.request);
		expect(responses[0]?.error).toMatchObject({
			code: "UND_ERR_SOCKET",
			message: "other side closed",
			name: "SocketError",
		});
		expect(responses[0]?.chain.map((hop) => hop.type)).toEqual(["pod", "service", "pod"]);
	});

	it("terminates an in-flight request when its cancelled handler throws during pod removal", async () => {
		const network = new ClusterNetwork();
		const pod = new PodSandboxInstance(
			"sandbox-1",
			{
				metadata: {
					name: "web",
					uid: "pod-uid",
					namespace: "default",
					attempt: 0,
				},
				pod: podOrigin("pod-uid"),
			},
			0,
		);
		const registration = network.setupPodSandbox(pod, "10.244.0.0/24");
		pod.setNetworkRegistration(registration);
		network.registerService(clusterIPService());
		network.setServiceTargets("default", "web", 80, [`${registration.ip}:8080`]);
		let started = false;
		registration.bindHttp(8080, async (requestCtx) => {
			started = true;
			await requestCtx.done().receive();
			throw new Error("handler context cancelled");
		});
		const requests: NetworkRequestEvent[] = [];
		const responses: NetworkResponseEvent[] = [];
		network.on("request", (event) => requests.push(event));
		network.on("response", (event) => responses.push(event));
		const fetchPromise = network.fetch(ctx, podOrigin("client-uid"), "http://10.96.0.10:80/work");
		await waitFor(() => expect(started).toBe(true));
		registration.unregister();

		const error = await fetchPromise.catch((caught: unknown) => caught);
		expect(error).toMatchObject({
			message: "fetch failed",
			name: "TypeError",
			cause: {
				code: "UND_ERR_SOCKET",
				message: "other side closed",
				name: "SocketError",
			},
		});
		expect(socketErrorConstructorName(error)).toBe("SocketError");

		expect(requests).toHaveLength(1);
		expect(requests[0]?.error).toBeUndefined();
		expect(responses).toHaveLength(1);
		expect(responses[0]?.request).toBe(requests[0]?.request);
		expect(responses[0]?.error).toMatchObject({
			code: "UND_ERR_SOCKET",
			message: "other side closed",
			name: "SocketError",
		});
		expect(responses[0]?.response).toBeUndefined();
	});

	it("emits a connection-refused response when its target pod is removed during request latency", async () => {
		const clock = getClock(ctx);
		clock.pause();
		const network = new ClusterNetwork();
		const pod = new PodSandboxInstance(
			"sandbox-1",
			{
				metadata: {
					name: "web",
					uid: "pod-uid",
					namespace: "default",
					attempt: 0,
				},
				pod: podOrigin("pod-uid"),
			},
			0,
		);
		const registration = network.setupPodSandbox(pod, "10.244.0.0/24");
		pod.setNetworkRegistration(registration);
		network.registerService(clusterIPService());
		network.setServiceTargets("default", "web", 80, [`${registration.ip}:8080`]);
		registration.bindHttp(8080, async () => ({ status: 200, body: "unexpected" }));
		const requests: NetworkRequestEvent[] = [];
		const responses: NetworkResponseEvent[] = [];
		network.on("request", (event) => requests.push(event));
		network.on("response", (event) => responses.push(event));
		const latencyCtx = withLatencyProvider(
			ctx,
			newLatencyProvider({ clusterNetworkRequestLatency: () => 100 }),
		);

		const fetchPromise = network.fetch(
			latencyCtx,
			podOrigin("client-uid"),
			"http://10.96.0.10:80/work",
		);
		await waitFor(() => expect(requests).toHaveLength(1));
		registration.unregister();
		clock.step(100);

		await expectConnectionRefused(fetchPromise, "10.96.0.10", 80);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.error).toBeUndefined();
		expect(requests[0]?.chain.map((hop) => hop.type)).toEqual(["pod", "service", "pod"]);
		expect(responses).toEqual([expect.objectContaining({})]);
		expect(responses[0]?.request).toBe(requests[0]?.request);
		expectConnectionRefusedEvent(responses[0]?.error, registration.ip, 8080);
		expect(responses[0]?.chain.map((hop) => hop.type)).toEqual(["pod", "service", "pod"]);
	});

	it("emits a socket-closed response when request latency is cancelled before dispatch", async () => {
		const clock = getClock(ctx);
		clock.pause();
		const network = new ClusterNetwork();
		const pod = new PodSandboxInstance(
			"sandbox-1",
			{
				metadata: {
					name: "web",
					uid: "pod-uid",
					namespace: "default",
					attempt: 0,
				},
				pod: podOrigin("pod-uid"),
			},
			0,
		);
		const registration = network.setupPodSandbox(pod, "10.244.0.0/24");
		pod.setNetworkRegistration(registration);
		registration.bindHttp(8080, async () => ({ status: 200, body: "unexpected" }));
		const requests: NetworkRequestEvent[] = [];
		const responses: NetworkResponseEvent[] = [];
		network.on("request", (event) => requests.push(event));
		network.on("response", (event) => responses.push(event));
		const latencyCtx = withLatencyProvider(
			ctx,
			newLatencyProvider({ clusterNetworkRequestLatency: () => 100 }),
		);
		const [requestCtx, cancel] = context.withCancel(latencyCtx);

		const fetchPromise = network.fetch(
			requestCtx,
			podOrigin("client-uid"),
			`http://${registration.ip}:8080/work`,
		);
		await waitFor(() => expect(requests).toHaveLength(1));
		const requestID = requests[0]?.request.header[networkRequestIDHeader]?.[0];
		expect(requests[0]?.error).toBeUndefined();
		expect(requestID).toEqual(expect.any(String));

		cancel();

		await expect(fetchPromise).rejects.toBe(context.Canceled);
		clock.step(100);
		expect(requests).toHaveLength(1);
		expect(responses).toHaveLength(1);
		const matchingResponses = responses.filter(
			(event) => event.request.header[networkRequestIDHeader]?.[0] === requestID,
		);
		expect(matchingResponses).toHaveLength(1);
		expect(matchingResponses[0]?.error).toMatchObject({
			code: "UND_ERR_SOCKET",
			message: "other side closed",
			name: "SocketError",
		});
		expect(matchingResponses[0]?.response).toBeUndefined();
	});

	it("waits after request and response events using configured latency", async () => {
		const clock = getClock(ctx);
		clock.pause();
		const network = new ClusterNetwork();
		const pod = new PodSandboxInstance(
			"sandbox-1",
			{
				metadata: {
					name: "web",
					uid: "pod-uid",
					namespace: "default",
					attempt: 0,
				},
				pod: podOrigin("pod-uid"),
			},
			0,
		);
		const registration = network.setupPodSandbox(pod, "10.244.0.0/24");
		pod.setNetworkRegistration(registration);
		let handlerCalls = 0;
		registration.bindHttp(8080, async () => {
			handlerCalls++;
			return { status: 200, body: "ok" };
		});

		const events: Array<{
			type: string;
			latencyMs: number;
			chain: NetworkHop[];
			requestID: string | undefined;
		}> = [];
		const latencyContexts: Context[] = [];
		network.on("request", (event) => {
			events.push({
				type: "request",
				latencyMs: event.latencyMs,
				chain: event.chain,
				requestID: event.request.header[networkRequestIDHeader]?.[0],
			});
		});
		network.on("response", (event) => {
			events.push({
				type: "response",
				latencyMs: event.latencyMs,
				chain: event.chain,
				requestID: event.request.header[networkRequestIDHeader]?.[0],
			});
		});
		const latencyCtx = withLatencyProvider(
			ctx,
			newLatencyProvider({
				clusterNetworkRequestLatency: (latencyCtx, event) => {
					latencyContexts.push(latencyCtx);
					return event.chain.length * 10;
				},
				clusterNetworkResponseLatency: (latencyCtx, event) => {
					latencyContexts.push(latencyCtx);
					return event.chain.length * 20;
				},
			}),
		);

		let resolved = false;
		const responsePromise = network
			.fetch(latencyCtx, podOrigin("client-uid"), `http://${registration.ip}:8080/`)
			.then((response) => {
				resolved = true;
				return response;
			});

		await waitFor(() => expect(events).toHaveLength(1));
		expect(events).toMatchObject([
			{
				type: "request",
				latencyMs: 20,
				chain: [
					{ type: "pod", resource: { metadata: { uid: "client-uid" } } },
					{ type: "pod", resource: { metadata: { uid: "pod-uid" } } },
				],
			},
		]);
		expect(latencyContexts).toEqual([latencyCtx]);
		expect(resolved).toBe(false);
		expect(handlerCalls).toBe(0);
		await waitFor(() => expect(clock.pendingTaskCount()).toBe(1));

		clock.step(20);
		await waitFor(() => expect(events).toHaveLength(2));
		expect(handlerCalls).toBe(1);
		expect(events[1]).toMatchObject({
			type: "response",
			latencyMs: 40,
			chain: [
				{ type: "pod", resource: { metadata: { uid: "pod-uid" } } },
				{ type: "pod", resource: { metadata: { uid: "client-uid" } } },
			],
		});
		expect(latencyContexts).toEqual([latencyCtx, latencyCtx]);
		expect(resolved).toBe(false);

		clock.step(40);
		await expect(responsePromise).resolves.toMatchObject({ status: 200, body: "ok" });
		expect(resolved).toBe(true);
		expect(events).toHaveLength(2);
		expect(events.filter((event) => event.type === "request")).toHaveLength(1);
		expect(events.filter((event) => event.type === "response")).toHaveLength(1);
		expect(events[0]?.requestID).toEqual(expect.any(String));
		expect(events[1]?.requestID).toBe(events[0]?.requestID);
	});

	it("rejects caller-provided network request IDs with a Node-style cause", async () => {
		const network = new ClusterNetwork();

		await expect(
			network.fetch(ctx, nodeOrigin("node-1"), "http://10.1.2.3:8080/", {
				headers: { [networkRequestIDHeader]: "mine" },
			}),
		).rejects.toMatchObject({
			cause: {
				message: `${networkRequestIDHeader} is managed by ClusterNetwork`,
				name: "Error",
			},
			message: "fetch failed",
			name: "TypeError",
		});
	});
});

async function expectConnectionRefused(
	request: Promise<unknown>,
	address: string,
	port: number,
): Promise<void> {
	let error: unknown;
	try {
		await request;
	} catch (caught) {
		error = caught;
	}
	expect(error).toMatchObject({
		cause: {
			address,
			code: "ECONNREFUSED",
			message: `connect ECONNREFUSED ${address}:${port}`,
			port,
			syscall: "connect",
		},
		message: "fetch failed",
		name: "TypeError",
	});
}

function expectConnectionRefusedEvent(error: unknown, address: string, port: number): void {
	expect(error).toMatchObject({
		address,
		code: "ECONNREFUSED",
		message: `connect ECONNREFUSED ${address}:${port}`,
		port,
		syscall: "connect",
	});
}

function socketErrorConstructorName(error: unknown): string | undefined {
	if (!(error instanceof TypeError) || !(error.cause instanceof Error)) {
		return undefined;
	}
	return error.cause.constructor.name;
}

function podOrigin(uid: string): V1Pod {
	return {
		apiVersion: "v1",
		kind: "Pod",
		metadata: {
			name: "web",
			namespace: "default",
			uid,
		},
	};
}

function nodeOrigin(
	name: string,
	addresses: NonNullable<V1Node["status"]>["addresses"] = [],
): V1Node {
	return {
		apiVersion: "v1",
		kind: "Node",
		metadata: { name },
		status: {
			addresses: [{ type: "InternalIP", address: "192.168.1.1" }, ...addresses],
		},
	};
}

function nodePortService(): V1Service {
	return serviceResource("NodePort");
}

function clusterIPService(): V1Service {
	return serviceResource("ClusterIP");
}

function serviceResource(type: "ClusterIP" | "NodePort"): V1Service {
	return {
		apiVersion: "v1",
		kind: "Service",
		metadata: {
			name: "web",
			namespace: "default",
			uid: "service-uid",
		},
		spec: {
			type,
			clusterIP: "10.96.0.10",
			ports: [{ port: 80, targetPort: 8080, nodePort: type === "NodePort" ? 30080 : undefined }],
		},
	};
}
