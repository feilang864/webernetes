const dateKeys = new Set(["creationTimestamp", "eventTime", "firstTimestamp", "lastTimestamp"]);

export function parseStoredObject<T>(value: string): T {
	return JSON.parse(value, (key, parsed) => {
		if (dateKeys.has(key) && typeof parsed === "string") {
			return new Date(parsed);
		}
		return parsed;
	}) as T;
}
