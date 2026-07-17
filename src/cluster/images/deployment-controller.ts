import { DeploymentController as Controller } from "../../controller/deployment/deployment-controller.js";
import type { ProcessContext } from "../cri/index.js";
import { BaseImage } from "./base.js";

export class DeploymentController extends BaseImage {
	static readonly imageName = "webernetes/deployment-controller";
	static readonly imageVersion = "1.0";

	readonly defaultCommand = ["deployment-controller"];

	override async exec(ctx: ProcessContext, argv: readonly string[]): Promise<number> {
		if (argv[0] !== "deployment-controller") {
			return await super.exec(ctx, argv);
		}
		const controller = new Controller(ctx.api, ctx.kubeConfig);
		await controller.run(ctx);
		try {
			return await ctx.waitUntilKilled();
		} finally {
			await controller.stop();
		}
	}
}
