/**
 * Returns a deep copy of a Kubernetes resource graph.
 *
 * This is a drop-in replacement for `structuredClone` on the shapes resources actually hold: plain
 * objects, arrays, dates, and primitives. Anything else falls through to `structuredClone` so the
 * copy semantics stay identical for maps, sets, typed arrays, and class instances.
 *
 * Why it exists: `structuredClone` runs the full HTML structured-clone algorithm, which handles
 * transferables and cycles that resource graphs never contain. Profiling the browser simulator put
 * `structuredClone` at 23% of all script time, almost entirely from store reads.
 *
 * Dates become plain `Date` instances, matching `structuredClone`. That intentionally drops the
 * back reference a `MockedDate` carries to its `Clock`.
 */
export function deepClone<T>(value: T): T {
	if (value === null || typeof value !== "object") {
		return value;
	}
	if (Array.isArray(value)) {
		const length = value.length;
		const copy: unknown[] = new Array(length);
		for (let index = 0; index < length; index += 1) {
			copy[index] = deepClone(value[index]);
		}
		return copy as T;
	}
	if (value instanceof Date) {
		return new Date(value.getTime()) as T;
	}
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		return structuredClone(value);
	}
	const copy: Record<string, unknown> = {};
	for (const key of Object.keys(value)) {
		copy[key] = deepClone((value as Record<string, unknown>)[key]);
	}
	return copy as T;
}
