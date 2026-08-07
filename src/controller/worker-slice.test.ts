import { expect, it } from "vitest";

import { Clock } from "../clock.js";
import { both } from "../test/describe.js";
import { newWorkerSlice, workerSliceBudgetMs } from "./worker-slice.js";

/**
 * Resolves once a real task boundary passes.
 *
 * A microtask cannot observe this, so awaiting it proves the event loop ran. The controller worker
 * loops otherwise await only settled promises, which never returns control to the browser.
 */
function taskBoundaryPassed(): { passed: () => boolean } {
	let passed = false;
	setTimeout(() => {
		passed = true;
	}, 0);
	return { passed: () => passed };
}

both.describe("newWorkerSlice", () => {
	it("does not yield while the slice is within its budget", async () => {
		using clock = new Clock();
		const yieldSlice = newWorkerSlice(clock, 60_000);
		const boundary = taskBoundaryPassed();

		await yieldSlice();

		expect(boundary.passed()).toBe(false);
	});

	it("yields to the event loop once the slice exhausts its budget", async () => {
		using clock = new Clock();
		const yieldSlice = newWorkerSlice(clock, 0);
		const boundary = taskBoundaryPassed();

		await yieldSlice();

		expect(boundary.passed()).toBe(true);
	});

	it("starts a fresh budget after each yield", async () => {
		using clock = new Clock();
		const yieldSlice = newWorkerSlice(clock, 20);
		const firstBoundary = taskBoundaryPassed();

		// Well past a 20ms budget, so the next call must yield.
		clock.step(50);
		await yieldSlice();
		expect(firstBoundary.passed()).toBe(true);

		// The budget restarted, so an immediate second call must not yield again.
		const secondBoundary = taskBoundaryPassed();
		await yieldSlice();

		expect(secondBoundary.passed()).toBe(false);
	});

	it("does not yield while the clock is paused, so a paused cluster cannot strand the worker", async () => {
		using clock = new Clock();
		const yieldSlice = newWorkerSlice(clock, 0);
		clock.pause();
		const boundary = taskBoundaryPassed();

		await yieldSlice();

		expect(boundary.passed()).toBe(false);
	});

	it("budgets a slice below one 60Hz frame", () => {
		expect(workerSliceBudgetMs).toBeLessThan(16);
	});
});
