import {
	ReplicaSetController as Controller,
	type ReplicaSetControllerFeatures,
	defaultReplicaSetControllerFeatures,
} from "../../controller/replicaset/replica-set.js";
import type { ProcessContext } from "../cri/index.js";
import { BaseImage } from "./base.js";

export {
	defaultReplicaSetControllerFeatures,
	getPodKeys,
	getPodsToDelete,
	slowStartBatch,
} from "../../controller/replicaset/replica-set.js";
export {
	calculateStatus,
	filterOutCondition,
	getCondition,
	newReplicaSetCondition,
	removeCondition,
	setCondition,
} from "../../controller/replicaset/replica-set-utils.js";
export type { ReplicaSetControllerFeatures } from "../../controller/replicaset/replica-set.js";

export class ReplicaSetController extends BaseImage {
	static readonly imageName = "webernetes/replicaset-controller";
	static readonly imageVersion = "1.0";

	readonly defaultCommand = ["replicaset-controller"];

	constructor(
		private readonly controllerFeatures: ReplicaSetControllerFeatures = defaultReplicaSetControllerFeatures(),
	) {
		super();
	}

	override async exec(ctx: ProcessContext, argv: readonly string[]): Promise<number> {
		if (argv[0] !== "replicaset-controller") {
			return await super.exec(ctx, argv);
		}
		const controller = new Controller(ctx.api, ctx.kubeConfig, this.controllerFeatures);
		await controller.run(ctx);
		try {
			return await ctx.waitUntilKilled();
		} finally {
			await controller.stop();
		}
	}
}
