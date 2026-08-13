/** A non-cryptographic source of uniformly distributed values in [0, 1). */
export interface RNG {
	random(): number;
}

/** RNG adapter used when callers do not request deterministic simulation. */
export class MathRNG implements RNG {
	random(): number {
		return Math.random();
	}
}

/**
 * Fast, seedable xoshiro128** pseudo-random number generator.
 *
 * This is suitable for simulation but is not cryptographically secure. Its
 * 32-bit state is initialized with splitmix32 so nearby seeds produce distinct
 * initial states.
 */
export class Xoshiro128StarStar implements RNG {
	private a: number;
	private b: number;
	private c: number;
	private d: number;

	constructor(seed: number) {
		if (!Number.isSafeInteger(seed)) {
			throw new RangeError("RNG seed must be a safe integer");
		}
		let state = seed >>> 0;
		const nextSeed = (): number => {
			state = (state + 0x9e3779b9) >>> 0;
			let value = state;
			value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
			value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
			return (value ^ (value >>> 15)) >>> 0;
		};
		this.a = nextSeed();
		this.b = nextSeed();
		this.c = nextSeed();
		this.d = nextSeed();
	}

	random(): number {
		const result = Math.imul(rotateLeft(Math.imul(this.b, 5), 7), 9) >>> 0;
		const temporary = (this.b << 9) >>> 0;
		this.c ^= this.a;
		this.d ^= this.b;
		this.b ^= this.c;
		this.a ^= this.d;
		this.c ^= temporary;
		this.d = rotateLeft(this.d, 11);
		return result / 0x1_0000_0000;
	}
}

function rotateLeft(value: number, shift: number): number {
	return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}
