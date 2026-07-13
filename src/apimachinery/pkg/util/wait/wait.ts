/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { select, type ReadOnlyChannel } from "../../../../go/channel";
import * as context from "../../../../go/context";
import type { MaybePromise } from "../../../../promise";
import type { ConditionWithContextFunc } from "./delay";
import { errWaitTimeout } from "./error";

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait.go ForeverTestTimeout.
export const foreverTestTimeout = 30_000;

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait.go ConditionFunc.
export type ConditionFunc = () => MaybePromise<[done: boolean, err: Error | undefined]>;

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait.go waitWithContextFunc.
export type WaitWithContextFunc = (ctx: context.Context) => ReadOnlyChannel<void> | undefined;

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait.go ContextForChannel.
// TypeScript contexts carry simulator services through values, so preserve the parent value chain.
export function contextForChannel(
	ctx: context.Context,
	parentCh: ReadOnlyChannel<void>,
): context.Context {
	return new ChannelContext(ctx, parentCh);
}

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait.go channelContext.
class ChannelContext implements context.Context {
	constructor(
		private readonly ctx: context.Context,
		private readonly stopCh: ReadOnlyChannel<void>,
	) {}

	done(): ReadOnlyChannel<void> {
		return this.stopCh;
	}

	err(): context.ContextError | undefined {
		return this.stopCh.tryReceive() ? context.Canceled : undefined;
	}

	value(key: unknown): unknown {
		return this.ctx.value(key);
	}
}

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait.go Jitter.
export function jitter(durationMs: number, maxFactor: number): number {
	if (maxFactor <= 0) {
		maxFactor = 1;
	}
	return durationMs + Math.random() * maxFactor * durationMs;
}

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait.go runConditionWithCrashProtectionWithContext.
export async function runConditionWithCrashProtectionWithContext(
	ctx: context.Context,
	condition: ConditionWithContextFunc,
): Promise<[done: boolean, err: Error | undefined]> {
	try {
		return await condition(ctx);
	} catch (error: unknown) {
		return [false, error instanceof Error ? error : new Error(String(error))];
	}
}

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait.go waitForWithContext.
export async function waitForWithContext(
	ctx: context.Context,
	wait: WaitWithContextFunc,
	fn: ConditionWithContextFunc,
): Promise<Error | undefined> {
	const [waitCtx, cancel] = context.withCancel(ctx);
	try {
		const c = wait(waitCtx);
		for (;;) {
			const selected = await select()
				.case(c, (result) => ({ type: "tick" as const, open: result.ok }))
				.case(ctx.done(), () => ({ type: "done" as const }));
			if (selected.type === "done") {
				return errWaitTimeout;
			}

			const [ok, err] = await runConditionWithCrashProtectionWithContext(ctx, fn);
			if (err) {
				return err;
			}
			if (ok) {
				return undefined;
			}
			if (!selected.open) {
				return errWaitTimeout;
			}
		}
	} finally {
		cancel();
	}
}
