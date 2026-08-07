import type { Clock } from "../clock.js";

/**
 * Work budget for one controller worker slice, in milliseconds.
 *
 * Sized just under a 60Hz frame so a burst of reconciles cannot hold the main thread long enough to
 * drop a frame.
 */
export const workerSliceBudgetMs = 8;

/**
 * Returns a function that yields to the clock once the current worker slice exhausts its budget.
 *
 * Kubernetes runs each controller worker as a goroutine, and the Go scheduler preempts it. The
 * browser has no preemption, and a worker loop only awaits already resolved promises while its queue
 * has items, so the loop drains an entire rollout inside one task. Profiling the browser simulator
 * measured 6,300 microtasks and 149ms in a single task, which drops roughly seven frames.
 *
 * The yield goes through the cluster `Clock`, so a paused cluster does not reconcile and `step`
 * stays deterministic.
 *
 * A paused clock never yields. The clock does not schedule timers while paused, so a yield taken
 * then would not resolve until resume, and a cluster closed while paused would strand the worker.
 * A paused clock also holds `nowMs` still, so the budget cannot expire while paused anyway.
 *
 * @example
 * const yieldSlice = newWorkerSlice(this.clock);
 * while (await this.processNextWorkItem(ctx)) {
 * 	await yieldSlice();
 * }
 */
export function newWorkerSlice(
	clock: Clock,
	budgetMs: number = workerSliceBudgetMs,
): () => Promise<void> {
	let startedAtMs = clock.nowMs();
	return async () => {
		if (clock.isPaused() || clock.nowMs() - startedAtMs < budgetMs) {
			return;
		}
		await clock.wait(0);
		startedAtMs = clock.nowMs();
	};
}
