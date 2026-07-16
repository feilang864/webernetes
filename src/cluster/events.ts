import * as k8s from "../client";
import { isNotFoundError } from "../client/errors";
import type { V1ObjectReference } from "../client";
import type { EventObject, EventRecorder } from "../client-go/tools/record/event";
import { getClock } from "../clock-context";
import type * as context from "../go/context";

export interface EventRecorderOptions {
	ctx: context.Context;
	api: k8s.KubeClient["corev1"];
	component: string;
	host?: string;
	timestampFormat?: "eventTime" | "legacy";
}

export class EventRecorderImpl implements EventRecorder {
	constructor(private readonly options: EventRecorderOptions) {}

	async event(object: EventObject, type: string, reason: string, message: string): Promise<void> {
		await this.record(object, undefined, type, reason, message);
	}

	async eventf(
		object: EventObject,
		type: string,
		reason: string,
		messageFmt: string,
		...args: unknown[]
	): Promise<void> {
		await this.record(object, undefined, type, reason, sprintf(messageFmt, args));
	}

	async annotatedEventf(
		object: EventObject,
		annotations: Record<string, string>,
		type: string,
		reason: string,
		messageFmt: string,
		...args: unknown[]
	): Promise<void> {
		await this.record(object, annotations, type, reason, sprintf(messageFmt, args));
	}

	private async record(
		object: EventObject,
		annotations: Record<string, string> | undefined,
		type: string,
		reason: string,
		message: string,
	): Promise<void> {
		const ref = objectReference(object);
		const namespace = ref.namespace ?? "default";
		const name = ref.name;
		if (!name) {
			return;
		}

		const now = getClock(this.options.ctx).now();
		const body: k8s.CoreV1Event = {
			metadata: {
				generateName: `${name}.`,
				namespace,
				annotations,
			},
			involvedObject: ref,
			count: 1,
			message,
			reason,
			reportingComponent: this.options.component,
			reportingInstance: this.options.host ?? this.options.component,
			source: {
				component: this.options.component,
				host: this.options.host,
			},
			type,
		};
		if (this.options.timestampFormat === "eventTime") {
			body.eventTime = now;
			// Kubernetes returns explicit nulls even though the generated client type omits null.
			Object.assign(body, { firstTimestamp: null, lastTimestamp: null });
		} else {
			body.firstTimestamp = now;
			body.lastTimestamp = now;
		}
		try {
			await this.options.api.createNamespacedEvent({
				namespace,
				body,
			});
		} catch (error) {
			if (!isNotFoundError(error)) {
				throw error;
			}
		}
	}
}

function objectReference(object: EventObject): V1ObjectReference {
	if ("metadata" in object) {
		return {
			apiVersion: object.apiVersion,
			kind: object.kind,
			name: object.metadata?.name,
			namespace: object.metadata?.namespace ?? "default",
			resourceVersion: object.metadata?.resourceVersion,
			uid: object.metadata?.uid,
		};
	}
	return object;
}

function sprintf(messageFmt: string, args: unknown[]): string {
	let index = 0;
	return messageFmt.replace(/%[sdvq]/g, (verb) => {
		const value = args[index++] ?? "";
		if (verb === "%q") {
			return JSON.stringify(String(value));
		}
		return String(value);
	});
}
