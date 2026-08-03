import { expect, it } from "vitest";
import type { CoreV1Event, V1Container, V1Pod } from "../gen/models/index.js";
import { k3s, kubernetes } from "../../test/harnesses/kubernetes.js";

const busyboxImage = "busybox:1.36";
const pauseImage = "registry.k8s.io/pause:3.10";
const probeObservationMs = 1_200;

kubernetes.describe("Probes", ({ discovery, helpers }) => {
	const {
		createAgnhostPod,
		createService,
		eventsFor,
		getTestNamespace,
		readPod,
		containerStatus,
		waitFor,
	} = helpers;

	async function createPod(
		name: string,
		container: V1Container,
		labels?: Record<string, string>,
	): Promise<V1Pod> {
		return await helpers.createPod({
			metadata: { name, labels },
			spec: {
				containers: [container],
			},
		});
	}

	it("readiness probe starts false, then becomes true after HTTP endpoint succeeds", async () => {
		await createAgnhostPod({
			metadata: { name: "http-readiness-success" },
			spec: {
				containers: [
					{
						readinessProbe: {
							httpGet: { path: "/readyz", port: "http" },
							initialDelaySeconds: 1,
							periodSeconds: 1,
							failureThreshold: 1,
						},
					},
				],
			},
		});

		await waitFor(async () => {
			const pod = await readPod("http-readiness-success");
			expect(containerStatus(pod, "server").ready).toBe(false);
			expect(conditionStatus(pod, "Ready")).toBe("False");
		});

		await waitFor(async () => {
			const pod = await readPod("http-readiness-success");
			expect(containerStatus(pod, "server").ready).toBe(true);
			expect(conditionStatus(pod, "Ready")).toBe("True");
		});
	});

	it("pod with no readiness probe becomes ready when running", async () => {
		const created = await createAgnhostPod({ metadata: { name: "no-readiness" } });

		await waitFor(async () => {
			const pod = await readPod(created);
			expect(containerStatus(pod, "server")).toMatchObject({ ready: true, started: true });
			expect(conditionStatus(pod, "ContainersReady")).toBe("True");
		});
	});

	it("pod with no probes is ready even when its declared port has no listener", async () => {
		const name = "no-probes-unbound-port";
		const labels = { app: name };
		const created = await createPod(
			"no-probes-unbound-port",
			{
				name: "busybox",
				image: busyboxImage,
				command: ["sleep", "3600"],
				ports: [{ name: "http", containerPort: 8080 }],
			},
			labels,
		);
		await createService({
			metadata: { name },
			spec: {
				selector: labels,
				ports: [{ name: "http", port: 80, targetPort: "http" }],
			},
		});

		await waitFor(async () => {
			const pod = await readPod(created);
			expect(containerStatus(pod, "busybox")).toMatchObject({ ready: true, started: true });
			expect(conditionStatus(pod, "ContainersReady")).toBe("True");
			expect(conditionStatus(pod, "Ready")).toBe("True");

			const slices = await discovery.listNamespacedEndpointSlice({
				namespace: await getTestNamespace(),
				labelSelector: `kubernetes.io/service-name=${name}`,
			});
			expect(slices.items.flatMap((slice) => slice.endpoints)).toContainEqual(
				expect.objectContaining({
					conditions: expect.objectContaining({ ready: true }),
					targetRef: expect.objectContaining({ name }),
				}),
			);
		});
	});

	it("startup probe gates readiness until it succeeds", async () => {
		await createAgnhostPod({
			metadata: { name: "startup-gates-readiness" },
			spec: {
				containers: [
					{
						startupProbe: {
							httpGet: { path: "/healthz", port: "http" },
							initialDelaySeconds: 1,
							periodSeconds: 1,
							failureThreshold: 1,
						},
						readinessProbe: {
							httpGet: { path: "/readyz", port: "http" },
							periodSeconds: 1,
							failureThreshold: 1,
						},
					},
				],
			},
		});

		await waitFor(async () => {
			const pod = await readPod("startup-gates-readiness");
			expect(containerStatus(pod, "server").started).toBe(false);
			expect(containerStatus(pod, "server").ready).toBe(false);
		});

		await waitFor(async () => {
			const pod = await readPod("startup-gates-readiness");
			expect(containerStatus(pod, "server").started).toBe(true);
			expect(containerStatus(pod, "server").ready).toBe(true);
		});
	});

	it("failing readiness probe marks container and pod not ready", async () => {
		await createAgnhostPod({
			metadata: { name: "http-readiness-failure" },
			spec: {
				containers: [
					{
						readinessProbe: {
							httpGet: { path: "/echo?code=500", port: "http" },
							periodSeconds: 1,
							failureThreshold: 1,
						},
					},
				],
			},
		});

		await waitFor(async () => {
			const pod = await readPod("http-readiness-failure");
			expect(pod.status?.phase).toBe("Running");
			expect(containerStatus(pod, "server").ready).toBe(false);
			expect(conditionStatus(pod, "Ready")).toBe("False");
		});
		expect(containerStatus(await readPod("http-readiness-failure"), "server").restartCount).toBe(0);
	});

	it("HTTP readiness probe records connection refused events when no process listens on the port", async () => {
		const pod = await createPod(
			"http-readiness-connection-refused",
			{
				name: "pause",
				image: pauseImage,
				ports: [{ name: "http", containerPort: 8080 }],
				readinessProbe: {
					httpGet: { path: "/", port: "http" },
					periodSeconds: 1,
					failureThreshold: 1,
				},
			},
			{ app: "http-readiness-connection-refused" },
		);
		await createService({
			metadata: { name: "http-readiness-connection-refused" },
			spec: {
				selector: { app: "http-readiness-connection-refused" },
				ports: [{ name: "http", port: 80, targetPort: "http" }],
			},
		});

		await waitFor(async () => {
			const current = await readPod(pod);
			expect(current.status?.phase).toBe("Running");
			expect(containerStatus(current, "pause").ready).toBe(false);
			expect(conditionStatus(current, "Ready")).toBe("False");
		});

		await waitFor(async () => {
			const event = newestEventWithReason(await eventsFor(pod), "Unhealthy");
			expect(event?.message).toContain("Readiness probe failed:");
			expect(event?.message).toContain("connection refused");
		});
	});

	it("TCP readiness probe records connection refused events when no process listens on the port", async () => {
		const pod = await createPod(
			"tcp-readiness-connection-refused",
			{
				name: "pause",
				image: pauseImage,
				ports: [{ name: "tcp", containerPort: 8081 }],
				readinessProbe: {
					tcpSocket: { port: "tcp" },
					periodSeconds: 1,
					failureThreshold: 1,
				},
			},
			{ app: "tcp-readiness-connection-refused" },
		);
		await createService({
			metadata: { name: "tcp-readiness-connection-refused" },
			spec: {
				selector: { app: "tcp-readiness-connection-refused" },
				ports: [{ name: "tcp", port: 80, targetPort: "tcp" }],
			},
		});

		await waitFor(async () => {
			const current = await readPod(pod);
			expect(current.status?.phase).toBe("Running");
			expect(containerStatus(current, "pause").ready).toBe(false);
			expect(conditionStatus(current, "Ready")).toBe("False");
		});

		await waitFor(async () => {
			const event = newestEventWithReason(await eventsFor(pod), "Unhealthy");
			expect(event?.message).toContain("Readiness probe failed:");
			expect(event?.message).toContain("connection refused");
		});
	});

	it("exec readiness probe records errored events when the command is missing", async () => {
		const pod = await createPod(
			"exec-readiness-missing-command",
			busyboxContainer({
				readinessProbe: {
					exec: { command: ["definitely-not-a-real-command"] },
					periodSeconds: 1,
					failureThreshold: 1,
				},
			}),
		);

		await waitFor(async () => {
			const current = await readPod(pod);
			expect(current.status?.phase).toBe("Running");
			expect(containerStatus(current, "test").ready).toBe(false);
			expect(conditionStatus(current, "Ready")).toBe("False");
		});

		await waitFor(async () => {
			const event = newestEventWithReason(await eventsFor(pod), "Unhealthy");
			expect(event?.message).toContain("Readiness probe errored and resulted in unknown state:");
			expect(event?.message).toContain("definitely-not-a-real-command");
			expect(event?.message).toContain("executable file not found");
		});
	});

	it("exec readiness probe succeeds based on command exit code", async () => {
		await createPod(
			"exec-readiness-success",
			busyboxContainer({
				readinessProbe: {
					exec: { command: ["true"] },
					periodSeconds: 1,
					failureThreshold: 1,
				},
			}),
		);

		await waitFor(async () => {
			expect(containerStatus(await readPod("exec-readiness-success")).ready).toBe(true);
		});
	});

	it("exec readiness probe fails based on command exit code", async () => {
		const pod = await createPod(
			"exec-readiness-failure",
			busyboxContainer({
				readinessProbe: {
					exec: { command: ["false"] },
					periodSeconds: 1,
					failureThreshold: 1,
				},
			}),
		);

		await waitFor(async () => {
			expect(containerStatus(await readPod("exec-readiness-failure")).ready).toBe(false);
		});

		await waitFor(async () => {
			const event = newestEventWithReason(await eventsFor(pod), "Unhealthy");
			expect(event?.message).toContain("Readiness probe failed:");
			expect(event?.message).not.toContain("probe errored");
			expect(event?.message).not.toContain("unknown state");
		});
	});

	it("liveness failure restarts the container and increments restart count", async () => {
		await createAgnhostPod({
			metadata: { name: "liveness-restart" },
			spec: {
				containers: [
					{
						livenessProbe: {
							httpGet: { path: "/echo?code=500", port: "http" },
							periodSeconds: 1,
							failureThreshold: 1,
						},
					},
				],
			},
		});

		await waitFor(async () => {
			const status = containerStatus(await readPod("liveness-restart"), "server");
			expect(status.restartCount).toBeGreaterThan(0);
		});
	});

	it("exec liveness probe success does not restart the container", async () => {
		await createPod(
			"exec-liveness-success",
			busyboxContainer({
				livenessProbe: {
					exec: { command: ["true"] },
					periodSeconds: 1,
					failureThreshold: 1,
				},
			}),
		);

		await waitFor(async () => {
			expect(containerStatus(await readPod("exec-liveness-success")).started).toBe(true);
		});
		await observeFor(probeObservationMs);
		expect(containerStatus(await readPod("exec-liveness-success")).restartCount).toBe(0);
	});

	it("tcpSocket liveness probe success does not restart the container", async () => {
		await createAgnhostPod({
			metadata: { name: "tcp-liveness-success" },
			spec: {
				containers: [
					{
						livenessProbe: {
							tcpSocket: { port: "http" },
							periodSeconds: 1,
							failureThreshold: 1,
						},
					},
				],
			},
		});

		await waitFor(async () => {
			expect(containerStatus(await readPod("tcp-liveness-success"), "server").started).toBe(true);
		});
		await observeFor(probeObservationMs);
		expect(containerStatus(await readPod("tcp-liveness-success"), "server").restartCount).toBe(0);
	});

	it("tcpSocket readiness succeeds when the container listens on the target port", async () => {
		await createAgnhostPod({
			metadata: { name: "tcp-readiness-success" },
			spec: {
				containers: [
					{
						readinessProbe: {
							tcpSocket: { port: "http" },
							periodSeconds: 1,
							failureThreshold: 1,
						},
					},
				],
			},
		});

		await waitFor(async () => {
			const pod = await readPod("tcp-readiness-success");
			expect(containerStatus(pod, "server").ready).toBe(true);
			expect(conditionStatus(pod, "Ready")).toBe("True");
		});
	});
});

k3s.describe("Probe lifecycle observation", ({ helpers }) => {
	const { containerStatus, createPod, exec, readPod, waitFor } = helpers;

	it("executes readiness and liveness for a replacement before its startup worker observes the new container", async () => {
		const pod = await createPod({
			metadata: { name: "startup-gates-replacement-readiness" },
			spec: {
				restartPolicy: "Always",
				terminationGracePeriodSeconds: 0,
				volumes: [{ name: "state", emptyDir: {} }],
				containers: [
					{
						name: "test",
						image: busyboxImage,
						command: [
							"sh",
							"-c",
							[
								"generation=0",
								"test ! -f /state/generation || generation=$(cat /state/generation)",
								"generation=$((generation + 1))",
								'echo "$generation" > /state/generation',
								'echo "container:$generation" >> /state/probes',
								"exec sleep 3600",
							].join("\n"),
						],
						volumeMounts: [{ name: "state", mountPath: "/state" }],
						startupProbe: {
							exec: {
								command: [
									"sh",
									"-c",
									'generation=$(cat /state/generation); echo "startup:$generation" >> /state/probes; test "$generation" = 1 || test -f "/state/allow-startup-$generation"',
								],
							},
							periodSeconds: 5,
							failureThreshold: 100,
						},
						livenessProbe: {
							exec: {
								command: [
									"sh",
									"-c",
									'generation=$(cat /state/generation); echo "liveness:$generation" >> /state/probes; test "$generation" != 1 || test ! -f /state/fail-liveness-1',
								],
							},
							periodSeconds: 1,
							failureThreshold: 1,
						},
						readinessProbe: {
							exec: {
								command: [
									"sh",
									"-c",
									'generation=$(cat /state/generation); echo "readiness:$generation" >> /state/probes',
								],
							},
							periodSeconds: 1,
							failureThreshold: 1,
						},
					},
				],
			},
		});

		let firstContainerID = "";
		await waitFor(async () => {
			const status = containerStatus(await readPod(pod), "test");
			expect(status.started).toBe(true);
			expect(status.ready).toBe(true);
			expect(status.containerID).toBeDefined();
			firstContainerID = status.containerID ?? "";
		});

		const failResult = await exec(pod, "test", ["touch", "/state/fail-liveness-1"]);
		expect(failResult.exitCode).toBe(0);

		let secondContainerID = "";
		await waitFor(async () => {
			const status = containerStatus(await readPod(pod), "test");
			expect(status.containerID).toBeDefined();
			expect(status.containerID).not.toBe(firstContainerID);
			secondContainerID = status.containerID ?? "";
		});
		expect(secondContainerID).not.toBe(firstContainerID);

		let observations = "";
		await waitFor(async () => {
			const result = await exec(pod, "test", ["cat", "/state/probes"]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("startup:2");
			observations = result.stdout;
		});

		const startup = observations.indexOf("startup:2");
		const readiness = observations.indexOf("readiness:2");
		const liveness = observations.indexOf("liveness:2");
		expect(readiness).toBeGreaterThanOrEqual(0);
		expect(liveness).toBeGreaterThanOrEqual(0);
		expect(readiness).toBeLessThan(startup);
		expect(liveness).toBeLessThan(startup);
	});
});

function busyboxContainer(overrides: Partial<V1Container> = {}): V1Container {
	return {
		name: "test",
		image: busyboxImage,
		command: ["sleep", "3600"],
		...overrides,
	};
}

function conditionStatus(pod: V1Pod, type: string): string | undefined {
	return pod.status?.conditions?.find((condition) => condition.type === type)?.status;
}

function newestEventWithReason(
	events: readonly CoreV1Event[],
	reason: string,
): CoreV1Event | undefined {
	return events
		.filter((event) => event.reason === reason)
		.sort((left, right) => eventTime(right).localeCompare(eventTime(left)))[0];
}

function eventTime(event: CoreV1Event): string {
	const value = event.lastTimestamp ?? event.eventTime ?? event.firstTimestamp;
	if (value instanceof Date) {
		return value.toISOString();
	}
	return value ?? "";
}

async function observeFor(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}
