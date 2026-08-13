import { MathRNG, type RNG, Xoshiro128StarStar } from "../rng.js";

/**
 * Creates the RNG used by test contexts. Set SEED to run tests with a
 * repeatable random sequence.
 */
export function newTestRng(): RNG {
	const seed = testSeed();
	return seed === undefined ? new MathRNG() : new Xoshiro128StarStar(seed);
}

export function testSeed(): number | undefined {
	const seed =
		typeof process === "undefined"
			? (import.meta as ImportMeta & { env: { SEED?: string } }).env.SEED
			: process.env.SEED;
	if (seed === undefined) {
		return undefined;
	}
	const value = Number(seed);
	if (!Number.isSafeInteger(value)) {
		throw new Error(`SEED must be a safe integer, got ${JSON.stringify(seed)}`);
	}
	return value;
}
