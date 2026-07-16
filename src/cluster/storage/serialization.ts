export function parseStoredObject<T>(value: string): T {
	return JSON.parse(value, (key, parsed) => {
		if (key === "creationTimestamp" && typeof parsed === "string") {
			return new Date(parsed);
		}
		return parsed;
	}) as T;
}
