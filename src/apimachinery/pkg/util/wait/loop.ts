/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import * as context from "../../../../go/context.js";
import { select } from "../../../../go/channel.js";
import type { ConditionWithContextFunc } from "./delay.js";
import type { Timer } from "./timer.js";

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/loop.go loopConditionUntilContext.
export async function loopConditionUntilContext(
	ctx: context.Context,
	timer: Timer,
	immediate: boolean,
	sliding: boolean,
	condition: ConditionWithContextFunc,
): Promise<Error | undefined> {
	let timeCh: ReturnType<Timer["c"]> | undefined;
	try {
		if (!sliding) {
			timeCh = timer.c();
		}

		if (immediate) {
			const [ok, err] = await condition(ctx);
			if (err || ok) {
				return err;
			}
		}

		if (sliding) {
			timeCh = timer.c();
		}
		if (!timeCh) {
			throw new Error("timer channel was not initialized");
		}

		for (;;) {
			const selected = await select()
				.case(ctx.done(), () => "done" as const)
				.case(timeCh, () => "time" as const);

			if (selected === "done" || ctx.err()) {
				return ctx.err();
			}

			if (!sliding) {
				timer.next();
			}

			const [ok, err] = await condition(ctx);
			if (err || ok) {
				return err;
			}

			if (sliding) {
				timer.next();
			}
		}
	} finally {
		timer.stop();
	}
}
