/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { Channel, select } from "../../../../go/channel.js";
import * as context from "../../../../go/context.js";
import * as time from "../../../../go/time.js";
import type { ConditionWithContextFunc } from "./delay.js";
import { errWaitTimeout } from "./error.js";
import {
	type ConditionFunc,
	type WaitWithContextFunc,
	runConditionWithCrashProtectionWithContext,
	waitForWithContext,
} from "./wait.js";

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/poll.go Poll.
export async function poll(
	ctx: context.Context,
	intervalMs: number,
	timeoutMs: number,
	condition: ConditionFunc,
): Promise<Error | undefined> {
	return await pollWithContext(ctx, intervalMs, timeoutMs, async () => await condition());
}

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/poll.go PollWithContext.
export async function pollWithContext(
	ctx: context.Context,
	intervalMs: number,
	timeoutMs: number,
	condition: ConditionWithContextFunc,
): Promise<Error | undefined> {
	return await pollInternal(ctx, false, poller(intervalMs, timeoutMs), condition);
}

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/poll.go PollUntil.
export async function pollUntil(
	ctx: context.Context,
	intervalMs: number,
	condition: ConditionFunc,
): Promise<Error | undefined> {
	return await pollUntilWithContext(ctx, intervalMs, async () => await condition());
}

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/poll.go PollUntilWithContext.
export async function pollUntilWithContext(
	ctx: context.Context,
	intervalMs: number,
	condition: ConditionWithContextFunc,
): Promise<Error | undefined> {
	return await pollInternal(ctx, false, poller(intervalMs, 0), condition);
}

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/poll.go PollInfinite.
export async function pollInfinite(
	ctx: context.Context,
	intervalMs: number,
	condition: ConditionFunc,
): Promise<Error | undefined> {
	return await pollInfiniteWithContext(ctx, intervalMs, async () => await condition());
}

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/poll.go PollInfiniteWithContext.
export async function pollInfiniteWithContext(
	ctx: context.Context,
	intervalMs: number,
	condition: ConditionWithContextFunc,
): Promise<Error | undefined> {
	return await pollInternal(ctx, false, poller(intervalMs, 0), condition);
}

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/poll.go PollImmediate.
export async function pollImmediate(
	ctx: context.Context,
	intervalMs: number,
	timeoutMs: number,
	condition: ConditionFunc,
): Promise<Error | undefined> {
	return await pollImmediateWithContext(ctx, intervalMs, timeoutMs, async () => await condition());
}

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/poll.go PollImmediateWithContext.
export async function pollImmediateWithContext(
	ctx: context.Context,
	intervalMs: number,
	timeoutMs: number,
	condition: ConditionWithContextFunc,
): Promise<Error | undefined> {
	return await pollInternal(ctx, true, poller(intervalMs, timeoutMs), condition);
}

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/poll.go PollImmediateUntil.
export async function pollImmediateUntil(
	ctx: context.Context,
	intervalMs: number,
	condition: ConditionFunc,
): Promise<Error | undefined> {
	return await pollImmediateUntilWithContext(ctx, intervalMs, async () => await condition());
}

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/poll.go PollImmediateUntilWithContext.
export async function pollImmediateUntilWithContext(
	ctx: context.Context,
	intervalMs: number,
	condition: ConditionWithContextFunc,
): Promise<Error | undefined> {
	return await pollInternal(ctx, true, poller(intervalMs, 0), condition);
}

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/poll.go PollImmediateInfinite.
export async function pollImmediateInfinite(
	ctx: context.Context,
	intervalMs: number,
	condition: ConditionFunc,
): Promise<Error | undefined> {
	return await pollImmediateInfiniteWithContext(ctx, intervalMs, async () => await condition());
}

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/poll.go PollImmediateInfiniteWithContext.
export async function pollImmediateInfiniteWithContext(
	ctx: context.Context,
	intervalMs: number,
	condition: ConditionWithContextFunc,
): Promise<Error | undefined> {
	return await pollInternal(ctx, true, poller(intervalMs, 0), condition);
}

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/poll.go poll.
export async function pollInternal(
	ctx: context.Context,
	immediate: boolean,
	wait: WaitWithContextFunc,
	condition: ConditionWithContextFunc,
): Promise<Error | undefined> {
	if (immediate) {
		const [done, err] = await runConditionWithCrashProtectionWithContext(ctx, condition);
		if (err) {
			return err;
		}
		if (done) {
			return undefined;
		}
	}

	const selected = await select()
		.case(ctx.done(), () => "done" as const)
		.default(() => "wait" as const);
	if (selected === "done") {
		return errWaitTimeout;
	}
	return await waitForWithContext(ctx, wait, condition);
}

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/poll.go poller.
export function poller(intervalMs: number, timeoutMs: number): WaitWithContextFunc {
	return (ctx) => {
		const ticks = new Channel<void>();
		void (async () => {
			const ticker = new time.Ticker(ctx, intervalMs);
			const timeout = timeoutMs === 0 ? undefined : new time.Timer(ctx, timeoutMs);
			try {
				for (;;) {
					const selected = await select()
						.case(ctx.done(), () => "done" as const)
						.case(ticker.C, () => "tick" as const)
						.case(timeout?.C, () => "timeout" as const);
					if (selected === "done" || selected === "timeout") {
						return;
					}
					ticks.trySend(undefined);
				}
			} finally {
				ticker.stop();
				timeout?.stop();
				ticks.close();
			}
		})();
		return ticks.readOnly();
	};
}
