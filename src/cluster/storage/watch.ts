import { EventEmitter } from "events";
import { keyValueObject, Watcher as EtcdWatcher, type KeyValue } from "../etcd.js";
import { deepClone } from "../../deep-clone.js";
import { parseStoredObject } from "./serialization.js";

export type EventType = "ADDED" | "MODIFIED" | "DELETED";

function toError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}

// Based off of kubernetes/staging/src/k8s.io/apimachinery/pkg/watch/watch.go.
// TODO(samwho): rewrite this to use Channel instead of EventEmitter.
export class Watcher<T> extends EventEmitter {
	public constructor(private readonly watcher: EtcdWatcher) {
		super();

		this.watcher.on("put", (event, prev) => {
			const value = decodeWatchedValue<T>(event);
			this.withResourceVersion(value, event.mod_revision);
			if (prev) {
				this.emit("event", "MODIFIED", value);
			} else {
				this.emit("event", "ADDED", value);
			}
		});

		this.watcher.on("delete", (event) => {
			const value = decodeWatchedValue<T>(event);
			this.withResourceVersion(value, event.mod_revision);
			this.emit("event", "DELETED", value);
		});

		this.watcher.on("error", (error) => {
			this.emit("error", toError(error));
		});

		this.watcher.on("end", () => {
			this.emit("end");
		});
	}

	public override on(event: "event", handler: (event: EventType, value: T) => void): this;
	public override on(event: "error", handler: (error: Error) => void): this;
	public override on(event: "end", handler: () => void): this;
	public override on(
		event: string,
		handler: ((event: EventType, value: T) => void) | ((error: Error) => void) | (() => void),
	): this {
		return super.on(event, handler);
	}

	public async cancel(): Promise<void> {
		await this.watcher.cancel();
	}

	private withResourceVersion(value: T, resourceVersion: string): void {
		const object = value as { metadata?: { resourceVersion?: string } };
		object.metadata ??= {};
		object.metadata.resourceVersion = resourceVersion;
	}
}

/**
 * Decodes one watched key/value into an object this watcher owns.
 *
 * `Etcd.publish` hands the same key/value to every watcher, so decoding from bytes here parsed
 * identical JSON once per watcher. Copying the stored object instead keeps each watcher's value
 * independent without re-parsing.
 */
function decodeWatchedValue<T>(event: KeyValue): T {
	const stored = keyValueObject(event);
	if (stored !== undefined) {
		return deepClone(stored) as T;
	}
	return parseStoredObject<T>(event.value.toString());
}
