import { V1Node } from "../../client/index.js";
import type * as context from "../../go/context.js";
import { Etcd } from "../etcd.js";
import { Store } from "./store.js";

export class NodeStore extends Store<V1Node> {
	public constructor(ctx: context.Context, etcd: Etcd) {
		super(ctx, etcd, {
			apiVersion: "v1",
			defaultQualifiedResource: "nodes",
			kind: "Node",
			singularQualifiedResource: "node",
			namespaced: false,
		});
	}

	protected async validateCreate(node: V1Node): Promise<void> {
		if (!node.metadata?.name) {
			throw new Error("Node name is required");
		}
	}
}
