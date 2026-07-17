import { expect, it, vi } from "vitest";

import { both } from "../describe.js";
import { retryOperation } from "./operation-retry.js";

both.describe("retryOperation", () => {
	it("retries a failed operation twice before succeeding", async () => {
		const error = new Error("transient failure");
		const operation = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(error)
			.mockRejectedValueOnce(error)
			.mockResolvedValue("ok");
		const onRetry = vi.fn<() => Promise<void>>().mockResolvedValue();

		await expect(
			retryOperation(operation, {
				retries: 2,
				onRetry,
			}),
		).resolves.toBe("ok");
		expect(operation).toHaveBeenCalledTimes(3);
		expect(onRetry).toHaveBeenNthCalledWith(1, error, 1);
		expect(onRetry).toHaveBeenNthCalledWith(2, error, 2);
	});

	it("throws the last error after exhausting retries", async () => {
		const operation = vi
			.fn<() => Promise<void>>()
			.mockRejectedValueOnce(new Error("first failure"))
			.mockRejectedValueOnce(new Error("second failure"))
			.mockRejectedValueOnce(new Error("final failure"));

		await expect(retryOperation(operation, { retries: 2 })).rejects.toThrow("final failure");
		expect(operation).toHaveBeenCalledTimes(3);
	});
});
