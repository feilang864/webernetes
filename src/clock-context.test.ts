import { expect, it } from "vitest";

import { Clock } from "./clock.js";
import { getClock, withClock } from "./clock-context.js";
import * as context from "./go/context.js";
import { browser } from "./test/describe.js";

browser.describe("Clock context", () => {
	it("stores and retrieves a clock through context", () => {
		const clock = new Clock();
		const ctx = withClock(context.background(), clock);

		expect(getClock(ctx)).toBe(clock);

		clock.clear();
	});

	it("throws when context has no clock", () => {
		expect(() => getClock(context.background())).toThrow("context has no clock");
	});
});
