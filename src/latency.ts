import * as context from "./go/context.js";
import type { PreNetworkRequestEvent, PreNetworkResponseEvent } from "./cluster/cni/network.js";
import type { V1Container } from "./client/index.js";

const key = Symbol("latencyProvider");
const noopValue = () => 0;
const noop = newLatencyProvider();

export interface LatencyProvider {
	clusterNetworkRequestLatency(ctx: context.Context, event: PreNetworkRequestEvent): number;
	clusterNetworkResponseLatency(ctx: context.Context, event: PreNetworkResponseEvent): number;
	containerTerminationLatency(
		ctx: context.Context,
		event: ContainerTerminationLatencyEvent,
	): number;
}

export interface ContainerTerminationLatencyEvent {
	container: V1Container;
}

export function newLatencyProvider(options: Partial<LatencyProvider> = {}): LatencyProvider {
	return {
		clusterNetworkRequestLatency: options.clusterNetworkRequestLatency ?? noopValue,
		clusterNetworkResponseLatency: options.clusterNetworkResponseLatency ?? noopValue,
		containerTerminationLatency: options.containerTerminationLatency ?? noopValue,
	};
}

export function withLatencyProvider(
	ctx: context.Context,
	latencyProvider?: LatencyProvider,
): context.Context {
	return context.withValue(ctx, key, latencyProvider ?? noop);
}

export function getLatencyProvider(ctx: context.Context): LatencyProvider {
	const latencyProvider = ctx.value(key);
	return isLatencyProvider(latencyProvider) ? latencyProvider : noop;
}

function isLatencyProvider(value: unknown): value is LatencyProvider {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as {
		clusterNetworkRequestLatency?: unknown;
		clusterNetworkResponseLatency?: unknown;
		containerTerminationLatency?: unknown;
	};
	return (
		typeof candidate.clusterNetworkRequestLatency === "function" &&
		typeof candidate.clusterNetworkResponseLatency === "function" &&
		typeof candidate.containerTerminationLatency === "function"
	);
}
