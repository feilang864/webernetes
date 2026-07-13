/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { expect, it } from "vitest";

import { Channel, select } from "../../../../go/channel";
import * as context from "../../../../go/context";
import { WaitGroup } from "../../../../go/sync/wait-group";
import * as time from "../../../../go/time";
import { browser } from "../../../../test/describe";
import type { ConditionWithContextFunc } from "./delay";
import { errWaitTimeout } from "./error";
import {
	pollInfinite,
	pollImmediateUntilWithContext,
	pollInternal,
	pollUntil,
	poller,
} from "./poll";
import {
	contextForChannel,
	foreverTestTimeout,
	type WaitWithContextFunc,
	waitForWithContext,
} from "./wait";

// The browser harness supplies the parent context; mirrored tests declare their own `ctx` values.
browser.describe("wait", ({ ctx: rootCtx }) => {
	// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait_test.go TestPoller.
	it("TestPoller", async () => {
		const [ctx, cancel] = context.withCancel(rootCtx);
		const w = poller(1, 2);
		const ch = w(ctx);

		let count = 0;
		DRAIN: for (;;) {
			const selected = await select()
				.case(ch, (result) => ({ type: "channel" as const, open: result.ok }))
				.case(time.after(ctx, foreverTestTimeout), () => ({ type: "timeout" as const }));
			if (selected.type === "channel") {
				if (!selected.open) {
					break DRAIN;
				}
				count++;
			} else {
				throw new Error("unexpected timeout after poll");
			}
		}
		cancel();
		expect(count).toBeLessThanOrEqual(3);
	});

	// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait_test.go TestPoll.
	it("TestPoll", async () => {
		let invocations = 0;
		const f: ConditionWithContextFunc = () => {
			invocations++;
			return [true, undefined];
		};
		const fp = new FakePoller(1);

		const [ctx, cancel] = context.withCancel(rootCtx);
		try {
			const err = await pollInternal(ctx, false, fp.getWaitFunc(), f);
			expect(err).toBeUndefined();
			await fp.wg.wait();
			expect(invocations).toBe(1);
			expect(fp.used).toBe(1);
		} finally {
			cancel();
		}
	});

	// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait_test.go TestPollError.
	it("TestPollError", async () => {
		const expectedError = new Error("Expected error");
		const f = () => [false, expectedError] as [boolean, Error];
		const fp = new FakePoller(1);

		const [ctx, cancel] = context.withCancel(rootCtx);
		try {
			const err = await pollInternal(ctx, false, fp.getWaitFunc(), f);
			expect(err).toBe(expectedError);
			await fp.wg.wait();
			expect(fp.used).toBe(1);
		} finally {
			cancel();
		}
	});

	// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait_test.go TestPollImmediate.
	it("TestPollImmediate", async () => {
		let invocations = 0;
		const f: ConditionWithContextFunc = () => {
			invocations++;
			return [true, undefined];
		};
		const fp = new FakePoller(0);

		const [ctx, cancel] = context.withCancel(rootCtx);
		try {
			const err = await pollInternal(ctx, true, fp.getWaitFunc(), f);
			expect(err).toBeUndefined();
			expect(invocations).toBe(1);
			expect(fp.used).toBe(0);
		} finally {
			cancel();
		}
	});

	// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait_test.go TestPollImmediateError.
	it("TestPollImmediateError", async () => {
		const expectedError = new Error("Expected error");
		const f: ConditionWithContextFunc = () => [false, expectedError];
		const fp = new FakePoller(0);

		const [ctx, cancel] = context.withCancel(rootCtx);
		try {
			const err = await pollInternal(ctx, true, fp.getWaitFunc(), f);
			expect(err).toBe(expectedError);
			expect(fp.used).toBe(0);
		} finally {
			cancel();
		}
	});

	// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait_test.go TestPollForever.
	it("TestPollForever", async () => {
		const ch = new Channel<void>();
		const errc = new Channel<Error>(1);
		const done = new Channel<void>(1);
		const complete = new Channel<void>();
		const wg = new WaitGroup();
		wg.add(1);
		void (async () => {
			try {
				const f = async (): Promise<[boolean, undefined]> => {
					await ch.send(undefined);
					const selected = await select()
						.case(done, () => true)
						.default(() => false);
					return [selected, undefined];
				};

				const err = await pollInfinite(rootCtx, 1, f);
				if (err) {
					errc.trySend(new Error(`unexpected error ${err.message}`));
				}
				ch.close();
				await complete.send(undefined);
			} finally {
				wg.done();
			}
		})();

		await ch.receive();
		for (let i = 0; i < 10; i++) {
			const selected = await select()
				.case(ch, (result) => ({ type: "channel" as const, open: result.ok }))
				.case(time.after(rootCtx, foreverTestTimeout), () => ({ type: "timeout" as const }));
			if (selected.type === "channel") {
				if (selected.open) {
					continue;
				}
				if (errc.length !== 0) {
					const err = await errc.receive();
					if (err.ok) {
						throw err.value;
					}
				}
				throw new Error("did not expect channel to be closed");
			}
			throw new Error("channel did not return at least once within the poll interval");
		}

		done.trySend(undefined);
		wg.add(1);
		void (async () => {
			try {
				for (let i = 0; i < 2; i++) {
					const result = await ch.receive();
					if (!result.ok) {
						return;
					}
				}
				throw new Error("expected closed channel after two iterations");
			} finally {
				wg.done();
			}
		})();
		await complete.receive();

		if (errc.length !== 0) {
			const err = await errc.receive();
			if (err.ok) {
				throw err.value;
			}
		}
		await wg.wait();
	});

	// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait_test.go Test_waitFor.
	it("Test_waitFor", async () => {
		let invocations = 0;
		const testCases = {
			"invoked once": {
				F: () => {
					invocations++;
					return [true, undefined] as [boolean, Error | undefined];
				},
				Ticks: 2,
				Invoked: 1,
				Err: false,
			},
			"invoked and returns a timeout": {
				F: () => {
					invocations++;
					return [false, undefined] as [boolean, Error | undefined];
				},
				Ticks: 2,
				Invoked: 3,
				Err: true,
			},
			"returns immediately on error": {
				F: () => {
					invocations++;
					return [false, new Error("test")] as [boolean, Error | undefined];
				},
				Ticks: 2,
				Invoked: 1,
				Err: true,
			},
		};
		for (const [k, c] of Object.entries(testCases)) {
			invocations = 0;
			const ticker = fakeTicker(c.Ticks);
			const done = new Channel<void>();
			try {
				const ctx = contextForChannel(rootCtx, done.readOnly());
				const err = await waitForWithContext(ctx, ticker, c.F);
				if (c.Err && !err) {
					throw new Error(`${k}: Expected error, got nil`);
				}
				if (!c.Err && err) {
					throw new Error(`${k}: Expected no error, got: ${err.message}`);
				}
				if (invocations !== c.Invoked) {
					throw new Error(`${k}: Expected ${c.Invoked} invocations, got ${invocations}`);
				}
			} finally {
				done.close();
			}
		}
	});

	// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait_test.go Test_waitForWithEarlyClosing_waitFunc.
	it("Test_waitForWithEarlyClosing_waitFunc", async () => {
		const stopCh = new Channel<void>();
		try {
			const ctx = contextForChannel(rootCtx, stopCh.readOnly());
			const start = new Date();
			const err = await waitForWithContext(
				ctx,
				(_ctx) => {
					const c = new Channel<void>();
					c.close();
					return c.readOnly();
				},
				(_ctx) => [false, undefined],
			);
			const duration = new Date().getTime() - start.getTime();

			expect(duration).toBeLessThan(foreverTestTimeout / 2);
			expect(err).toBe(errWaitTimeout);
		} finally {
			stopCh.close();
		}
	});

	// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait_test.go Test_waitForWithClosedChannel.
	it("Test_waitForWithClosedChannel", async () => {
		const stopCh = new Channel<void>();
		stopCh.close();
		const c = new Channel<void>();
		try {
			const ctx = contextForChannel(rootCtx, stopCh.readOnly());
			const start = new Date();
			const err = await waitForWithContext(
				ctx,
				() => c.readOnly(),
				(_ctx) => [false, undefined],
			);
			const duration = new Date().getTime() - start.getTime();

			expect(duration).toBeLessThan(foreverTestTimeout / 2);
			expect(err).toBe(errWaitTimeout);
		} finally {
			c.close();
		}
	});

	// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait_test.go Test_waitForWithContextCancelsContext.
	it("Test_waitForWithContextCancelsContext", async () => {
		const [ctx, cancel] = context.withCancel(rootCtx);
		try {
			const waitFn = poller(1, foreverTestTimeout);
			let ctxPassedToWait: context.Context | undefined;
			await waitForWithContext(
				ctx,
				(ctx) => {
					ctxPassedToWait = ctx;
					return waitFn(ctx);
				},
				async (_ctx) => {
					await new Promise<void>((resolve) => {
						globalThis.setTimeout(resolve, 10);
					});
					return [true, undefined];
				},
			);
			if (ctxPassedToWait?.err() !== context.Canceled) {
				throw new Error(
					`expected the context passed to waitForWithContext to be closed with: ${context.Canceled.message}, but got: ${ctxPassedToWait?.err()?.message}`,
				);
			}
		} finally {
			cancel();
		}
	});

	// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait_test.go TestPollUntil.
	it("TestPollUntil", async () => {
		const stopCh = new Channel<void>();
		const called = new Channel<boolean>();
		const pollDone = new Channel<void>();
		const wg = new WaitGroup();
		const ctx = contextForChannel(rootCtx, stopCh.readOnly());
		wg.add(1);
		void (async () => {
			try {
				await pollUntil(ctx, 1, async () => {
					await called.send(true);
					return [false, undefined];
				});
				pollDone.close();
			} finally {
				wg.done();
			}
		})();

		await called.receive();
		stopCh.close();
		void (async () => {
			for await (const _called of called) {
			}
		})();
		await pollDone.receive();
		called.close();
		await wg.wait();
	});

	// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait_test.go TestContextForChannel.
	it("TestContextForChannel", async () => {
		const parentCh = new Channel<void>();
		const done = new Channel<void>();
		const wg = new WaitGroup();

		for (let i = 0; i < 3; i++) {
			wg.add(1);
			void (async () => {
				try {
					const ctx = contextForChannel(rootCtx, parentCh.readOnly());
					await ctx.done().receive();
				} finally {
					wg.done();
				}
			})();
		}

		void (async () => {
			await wg.wait();
			done.close();
		})();

		parentCh.close();
		const selected = await select()
			.case(done, () => "done" as const)
			.case(time.after(rootCtx, foreverTestTimeout), () => "timeout" as const);
		if (selected === "timeout") {
			throw new Error("unexpected timeout waiting for parent to cancel child contexts");
		}
	});

	// Go check:
	//
	//   package main
	//
	//   import (
	//    	"fmt"
	//    	"k8s.io/apimachinery/pkg/util/wait"
	//   )
	//
	//   func main() {
	//    	stopCh := make(chan struct{}, 1)
	//    	stopCh <- struct{}{}
	//    	fmt.Println(wait.ContextForChannel(stopCh).Err())
	//   }
	//
	// Output:
	//   context canceled
	it("ContextForChannel returns Canceled when its stop channel has a value", () => {
		const stopCh = new Channel<void>(1);
		stopCh.trySend(undefined);

		const ctx = contextForChannel(rootCtx, stopCh.readOnly());

		expect(ctx.err()).toBe(context.Canceled);
	});

	// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait_test.go TestPollImmediateUntilWithContext.
	it("TestPollImmediateUntilWithContext", async () => {
		const fakeErr = new Error("my error");
		const tests = [
			{
				name: "condition throws error on immediate attempt, no retry is attempted",
				condition:
					(_attempts: number): ConditionWithContextFunc =>
					() => [false, fakeErr],
				errExpected: fakeErr,
				attemptsExpected: 1,
			},
			{
				name: "condition returns done=true on immediate attempt, no retry is attempted",
				condition:
					(_attempts: number): ConditionWithContextFunc =>
					() => [true, undefined],
				errExpected: undefined,
				attemptsExpected: 1,
			},
			{
				name: "condition returns done=false on immediate attempt, context is already cancelled, no retry is attempted",
				condition:
					(_attempts: number): ConditionWithContextFunc =>
					() => [false, undefined],
				context: cancelledContext,
				errExpected: errWaitTimeout,
				attemptsExpected: 1,
			},
			{
				name: "condition returns done=false on immediate attempt, context is not cancelled, retry is attempted",
				condition:
					(attempts: number): ConditionWithContextFunc =>
					() => [attempts > 3, undefined],
				errExpected: undefined,
				attemptsExpected: 4,
			},
			{
				name: "condition always returns done=false, context gets cancelled after N attempts",
				condition:
					(_attempts: number): ConditionWithContextFunc =>
					() => [false, undefined],
				cancelContextAfterNthAttempt: 4,
				errExpected: errWaitTimeout,
				attemptsExpected: 4,
			},
		];
		for (const test of tests) {
			const contextFn = test.context ?? defaultContext;
			const [ctx, cancel] = contextFn(rootCtx);
			let attempts = 0;
			const conditionWrapper: ConditionWithContextFunc = async (ctx) => {
				attempts++;
				const c = test.condition(attempts);
				const result = await c(ctx);
				if (test.cancelContextAfterNthAttempt === attempts) {
					cancel();
				}
				return result;
			};
			const result = pollImmediateUntilWithContext(ctx, 1, conditionWrapper);

			expect(await result).toBe(test.errExpected);
			expect(attempts).toBe(test.attemptsExpected);
			cancel();
		}
	});

	// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait_test.go Test_waitForWithContext.
	it("Test_waitForWithContext", async () => {
		const fakeErr = new Error("fake error");
		const tests: Array<{
			name: string;
			context: (parent: context.Context) => [context.Context, context.CancelFunc];
			condition: ConditionWithContextFunc;
			waitFunc: () => WaitWithContextFunc;
			attemptsExpected: number;
			errExpected: Error | undefined;
		}> = [
			{
				name: "condition returns done=true on first attempt, no retry is attempted",
				context: defaultContext,
				condition: (_ctx) => [true, undefined],
				waitFunc: () => fakeTicker(2, undefined, () => {}),
				attemptsExpected: 1,
				errExpected: undefined,
			},
			{
				name: "condition always returns done=false, timeout error expected",
				context: defaultContext,
				condition: (_ctx) => [false, undefined],
				waitFunc: () => fakeTicker(2, undefined, () => {}),
				attemptsExpected: 3,
				errExpected: errWaitTimeout,
			},
			{
				name: "condition returns an error on first attempt, the error is returned",
				context: defaultContext,
				condition: (_ctx) => [false, fakeErr],
				waitFunc: () => fakeTicker(2, undefined, () => {}),
				attemptsExpected: 1,
				errExpected: fakeErr,
			},
			{
				name: "context is cancelled, context cancelled error expected",
				context: cancelledContext,
				condition: (_ctx) => [false, undefined],
				waitFunc: () => {
					return (_ctx) => {
						const ch = new Channel<void>();
						return ch.readOnly();
					};
				},
				attemptsExpected: 0,
				errExpected: errWaitTimeout,
			},
		];

		for (const test of tests) {
			let attempts = 0;
			const conditionWrapper: ConditionWithContextFunc = async (ctx) => {
				attempts++;
				return await test.condition(ctx);
			};

			const ticker = test.waitFunc();
			const err = await (async () => {
				const contextFn = test.context ?? defaultContext;
				const [ctx, cancel] = contextFn(rootCtx);
				try {
					return await waitForWithContext(ctx, ticker, conditionWrapper);
				} finally {
					cancel();
				}
			})();

			if (test.errExpected !== err) {
				throw new Error(`Expected error: ${test.errExpected?.message}, but got: ${err?.message}`);
			}
			if (test.attemptsExpected !== attempts) {
				throw new Error(`Expected ${test.attemptsExpected} invocations, got ${attempts}`);
			}
		}
	});

	// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait_test.go Test_poll.
	it("Test_poll", async () => {
		const fakeErr = new Error("fake error");
		const tests: Array<{
			name: string;
			context?: (parent: context.Context) => [context.Context, context.CancelFunc];
			immediate: boolean;
			waitFunc?: () => WaitWithContextFunc;
			condition: ConditionWithContextFunc;
			cancelContextAfter?: number;
			attemptsExpected: number;
			errExpected: Error | undefined;
		}> = [
			{
				name: "immediate is true, condition returns an error",
				immediate: true,
				condition: (_ctx) => [false, fakeErr],
				attemptsExpected: 1,
				errExpected: fakeErr,
			},
			{
				name: "immediate is true, condition returns true",
				immediate: true,
				condition: (_ctx) => [true, undefined],
				attemptsExpected: 1,
				errExpected: undefined,
			},
			{
				name: "immediate is true, context is cancelled, condition return false",
				context: cancelledContext,
				immediate: true,
				condition: (_ctx) => [false, undefined],
				attemptsExpected: 1,
				errExpected: errWaitTimeout,
			},
			{
				name: "immediate is false, context is cancelled",
				context: cancelledContext,
				immediate: false,
				condition: (_ctx) => [false, undefined],
				attemptsExpected: 0,
				errExpected: errWaitTimeout,
			},
			{
				name: "immediate is false, condition returns an error",
				immediate: false,
				condition: (_ctx) => [false, fakeErr],
				waitFunc: () => fakeTicker(5, undefined, () => {}),
				attemptsExpected: 1,
				errExpected: fakeErr,
			},
			{
				name: "immediate is false, condition returns true",
				immediate: false,
				condition: (_ctx) => [true, undefined],
				waitFunc: () => fakeTicker(5, undefined, () => {}),
				attemptsExpected: 1,
				errExpected: undefined,
			},
			{
				name: "immediate is false, ticker channel is closed, condition returns true",
				immediate: false,
				condition: (_ctx) => [true, undefined],
				waitFunc: () => {
					return (_ctx) => {
						const ch = new Channel<void>();
						ch.close();
						return ch.readOnly();
					};
				},
				attemptsExpected: 1,
				errExpected: undefined,
			},
			{
				name: "immediate is false, ticker channel is closed, condition returns error",
				immediate: false,
				condition: (_ctx) => [false, fakeErr],
				waitFunc: () => {
					return (_ctx) => {
						const ch = new Channel<void>();
						ch.close();
						return ch.readOnly();
					};
				},
				attemptsExpected: 1,
				errExpected: fakeErr,
			},
			{
				name: "immediate is false, ticker channel is closed, condition returns false",
				immediate: false,
				condition: (_ctx) => [false, undefined],
				waitFunc: () => {
					return (_ctx) => {
						const ch = new Channel<void>();
						ch.close();
						return ch.readOnly();
					};
				},
				attemptsExpected: 1,
				errExpected: errWaitTimeout,
			},
			{
				name: "condition always returns false, timeout error expected",
				immediate: false,
				condition: (_ctx) => [false, undefined],
				waitFunc: () => fakeTicker(2, undefined, () => {}),
				attemptsExpected: 3,
				errExpected: errWaitTimeout,
			},
			{
				name: "context is cancelled after N attempts, timeout error expected",
				immediate: false,
				condition: (_ctx) => [false, undefined],
				waitFunc: () => {
					return (_ctx) => {
						const ch = new Channel<void>();
						void (async () => {
							await ch.send(undefined);
							await ch.send(undefined);
						})();
						return ch.readOnly();
					};
				},
				cancelContextAfter: 2,
				attemptsExpected: 2,
				errExpected: errWaitTimeout,
			},
			{
				name: "context is cancelled after N attempts, context error not expected (legacy behavior)",
				immediate: false,
				condition: (_ctx) => [false, undefined],
				waitFunc: () => {
					return (_ctx) => {
						const ch = new Channel<void>();
						void (async () => {
							await ch.send(undefined);
							await ch.send(undefined);
						})();
						return ch.readOnly();
					};
				},
				cancelContextAfter: 2,
				attemptsExpected: 2,
				errExpected: errWaitTimeout,
			},
		];

		for (const test of tests) {
			let attempts = 0;
			let ticker: WaitWithContextFunc = () => undefined;
			if (test.waitFunc) {
				ticker = test.waitFunc();
			}
			const err = await (async () => {
				const contextFn = test.context ?? defaultContext;
				const [ctx, cancel] = contextFn(rootCtx);
				try {
					const conditionWrapper: ConditionWithContextFunc = async (ctx) => {
						attempts++;
						try {
							return await test.condition(ctx);
						} finally {
							if (test.cancelContextAfter === attempts) {
								cancel();
							}
						}
					};

					return await pollInternal(ctx, test.immediate, ticker, conditionWrapper);
				} finally {
					cancel();
				}
			})();

			if (test.errExpected !== err) {
				throw new Error(`Expected error: ${test.errExpected?.message}, but got: ${err?.message}`);
			}
			if (test.attemptsExpected !== attempts) {
				throw new Error(`Expected ${test.attemptsExpected} invocations, got ${attempts}`);
			}
		}
	});
});

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait_test.go fakePoller.
class FakePoller {
	used = 0;
	readonly wg = new WaitGroup();

	constructor(private readonly max: number) {}

	getWaitFunc(): WaitWithContextFunc {
		this.wg.add(1);
		return fakeTicker(
			this.max,
			() => {
				this.used++;
			},
			() => {
				this.wg.done();
			},
		);
	}
}

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait_test.go fakeTicker.
function fakeTicker(max: number, onTick?: () => void, onDone?: () => void): WaitWithContextFunc {
	return (ctx) => {
		const ticks = new Channel<void>();
		void (async () => {
			try {
				for (let i = 0; i < max; i++) {
					if (ctx.err()) {
						return;
					}
					const selected = await select()
						.send(ticks, undefined, () => "tick" as const)
						.case(ctx.done(), () => "done" as const);
					if (selected === "done") {
						return;
					}
					onTick?.();
				}
			} finally {
				onDone?.();
				ticks.close();
			}
		})();
		return ticks.readOnly();
	};
}

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait_test.go defaultContext.
function defaultContext(parent: context.Context): [context.Context, context.CancelFunc] {
	return context.withCancel(parent);
}

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/wait_test.go cancelledContext.
function cancelledContext(parent: context.Context): [context.Context, context.CancelFunc] {
	const [ctx, cancel] = context.withCancel(parent);
	cancel();
	return [ctx, cancel];
}
