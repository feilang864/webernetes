import type { RNG } from "./rng.js";
import * as context from "./go/context.js";

const key = Symbol("rng");

export function withRng(ctx: context.Context, rng: RNG): context.Context {
	return context.withValue(ctx, key, rng);
}

export function getRng(ctx: context.Context): RNG {
	const rng = ctx.value(key);
	if (isRng(rng)) {
		return rng;
	}
	throw new Error("context has no RNG");
}

function isRng(value: unknown): value is RNG {
	return (
		typeof value === "object" &&
		value !== null &&
		"random" in value &&
		typeof value.random === "function"
	);
}
