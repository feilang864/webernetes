import { expect, it } from "vitest";

import type {
	NetworkHop,
	PreNetworkRequestEvent,
	PreNetworkResponseEvent,
} from "./cluster/cni/network";
import type { V1Container } from "./client";
import { Cluster } from "./cluster/cluster";
import * as context from "./go/context";
import { getCluster } from "./cluster/context";
import {
	getLatencyProvider,
	newLatencyProvider,
	withLatencyProvider,
	type ContainerTerminationLatencyEvent,
} from "./latency";
import { browser } from "./test/describe";

browser.describe("LatencyProvider", () => {
	const chain: NetworkHop[] = [{ type: "external", host: "example.com" }];
	const requestEvent: PreNetworkRequestEvent = {
		chain,
		request: {
			method: "GET",
			url: new URL("http://example.com/"),
			header: {},
			host: "example.com",
		},
	};
	const responseEvent: PreNetworkResponseEvent = {
		...requestEvent,
		response: { status: 200, body: "" },
	};
	const container: V1Container = { name: "main", image: "busybox:1.36" };
	const containerTerminationEvent = {
		container,
	};

	it("converts missing latency options to zero-returning functions", () => {
		const provider = newLatencyProvider();
		const ctx = context.background();

		expect(provider.clusterNetworkRequestLatency(ctx, requestEvent)).toBe(0);
		expect(provider.clusterNetworkResponseLatency(ctx, responseEvent)).toBe(0);
		expect(provider.containerTerminationLatency(ctx, containerTerminationEvent)).toBe(0);
	});

	it("passes the network event to latency option functions", () => {
		let requestLatency = 1;
		let responseLatency = 10;
		let terminationLatency = 100;
		const requestEvents: PreNetworkRequestEvent[] = [];
		const responseEvents: PreNetworkResponseEvent[] = [];
		const terminationEvents: ContainerTerminationLatencyEvent[] = [];
		const provider = newLatencyProvider({
			clusterNetworkRequestLatency: (_ctx, event) => {
				requestEvents.push(event);
				return requestLatency++;
			},
			clusterNetworkResponseLatency: (_ctx, event) => {
				responseEvents.push(event);
				return (responseLatency += 5);
			},
			containerTerminationLatency: (_ctx, event) => {
				terminationEvents.push(event);
				return (terminationLatency += 25);
			},
		});

		const ctx = context.background();
		expect(provider.clusterNetworkRequestLatency(ctx, requestEvent)).toBe(1);
		expect(provider.clusterNetworkRequestLatency(ctx, requestEvent)).toBe(2);
		expect(provider.clusterNetworkResponseLatency(ctx, responseEvent)).toBe(15);
		expect(provider.clusterNetworkResponseLatency(ctx, responseEvent)).toBe(20);
		expect(provider.containerTerminationLatency(ctx, containerTerminationEvent)).toBe(125);
		expect(provider.containerTerminationLatency(ctx, containerTerminationEvent)).toBe(150);
		expect(requestEvents).toEqual([requestEvent, requestEvent]);
		expect(responseEvents).toEqual([responseEvent, responseEvent]);
		expect(terminationEvents).toEqual([containerTerminationEvent, containerTerminationEvent]);
	});

	it("passes the cluster-owned context to latency option functions", async () => {
		const cluster = new Cluster({ nodes: 1 });
		const provider = newLatencyProvider({
			clusterNetworkRequestLatency: (ctx, event) => {
				expect(getCluster(ctx)).toBe(cluster);
				expect(event).toBe(requestEvent);
				return 12;
			},
		});
		try {
			expect(provider.clusterNetworkRequestLatency(cluster.ctx, requestEvent)).toBe(12);
		} finally {
			await cluster.close();
		}
	});

	it("stores and retrieves providers through context", () => {
		const provider = newLatencyProvider({
			clusterNetworkRequestLatency: (_ctx) => 12,
			clusterNetworkResponseLatency: (_ctx) => 34,
			containerTerminationLatency: (_ctx) => 56,
		});
		const ctx = withLatencyProvider(context.background(), provider);

		expect(getLatencyProvider(ctx)).toBe(provider);
	});

	it("falls back to the no-op provider when context has no latency provider", () => {
		const provider = getLatencyProvider(context.background());
		const ctx = context.background();

		expect(provider.clusterNetworkRequestLatency(ctx, requestEvent)).toBe(0);
		expect(provider.clusterNetworkResponseLatency(ctx, responseEvent)).toBe(0);
		expect(provider.containerTerminationLatency(ctx, containerTerminationEvent)).toBe(0);
	});
});
