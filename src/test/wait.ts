import { vi } from "vitest";
import { currentTestEnvironment } from "./describe.js";

const WAIT_FOR_OPTIONS =
	currentTestEnvironment === "browser"
		? { timeout: 5_000, interval: 50 }
		: { timeout: 180_000, interval: 500 };

export async function waitFor(
	assertion: () => unknown | Promise<unknown>,
	options: { timeout: number; interval: number } = WAIT_FOR_OPTIONS,
): Promise<void> {
	await vi.waitFor(assertion, options);
}
