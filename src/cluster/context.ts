import type { Cluster } from "./cluster.js";
import * as context from "../go/context.js";

const key = Symbol("cluster");

export function withCluster(ctx: context.Context, cluster: Cluster): context.Context {
	return context.withValue(ctx, key, cluster);
}

export function getCluster(ctx: context.Context): Cluster {
	const cluster = ctx.value(key);
	if (cluster === undefined) {
		throw new Error("context has no cluster");
	}
	return cluster as Cluster;
}
