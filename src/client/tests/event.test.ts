import { expect, it } from "vitest";
import type { CoreV1Event } from "../gen/models/index.js";
import { kubernetes } from "../../test/harnesses/kubernetes.js";
import { apiErrorCode } from "../../test/harnesses/helpers.js";
import { expectRecentCreationTimestamp, expectResourceUid } from "./assertions.js";

kubernetes.describe("Events", ({ apps, core, helpers }) => {
	const { createPod, eventsFor, getSuiteNamespace, getTestNamespace, waitFor, waitForPodReady } =
		helpers;
	async function createEvent(event: Partial<CoreV1Event>): Promise<CoreV1Event> {
		const namespace = await getSuiteNamespace();
		return await core.createNamespacedEvent({
			namespace,
			body: {
				metadata: {
					...event.metadata,
				},
				involvedObject: {
					apiVersion: "v1",
					kind: "Pod",
					namespace,
					name: "event-subject",
					...event.involvedObject,
				},
				count: 1,
				firstTimestamp: new Date(),
				lastTimestamp: new Date(),
				message: "event message",
				reason: "Testing",
				source: {
					component: "k8s-web-simulator-test",
				},
				type: "Normal",
				...event,
			},
		});
	}

	it("should set a recent creation timestamp when creating an event", async () => {
		const event = await createEvent({ metadata: { name: "creation-timestamp-event" } });

		expectRecentCreationTimestamp(event);
	});

	it("should set a UID when creating an event", async () => {
		const event = await createEvent({ metadata: { name: "uid-event" } });

		expectResourceUid(event);
	});

	it("should preserve the UID when replacing an event without one", async () => {
		const namespace = await getSuiteNamespace();
		const created = await createEvent({ metadata: { name: "replace-without-uid-event" } });
		const uid = created.metadata?.uid;
		const replacement = structuredClone(created);
		if (replacement.metadata) {
			delete replacement.metadata.uid;
		}
		replacement.message = "updated event";

		const replaced = await core.replaceNamespacedEvent({
			name: "replace-without-uid-event",
			namespace,
			body: replacement,
		});

		expect(replaced.metadata?.uid).toBe(uid);
		expect(replaced.message).toBe("updated event");
	});

	it("should set first and last timestamps on kubelet-generated events", async () => {
		const pod = await createPod({ metadata: { name: "event-timestamps" } });
		await waitForPodReady(pod);

		const events = await eventsFor(pod);
		// Scheduler events use eventTime instead of these legacy CoreV1 timestamp fields.
		const kubeletEvents = events.filter((event) => event.source?.component === "kubelet");
		expect(kubeletEvents.map((event) => event.reason)).toEqual(
			expect.arrayContaining(["Pulled", "Created", "Started"]),
		);
		for (const event of kubeletEvents) {
			expect(event.firstTimestamp).toEqual(expect.anything());
			expect(event.lastTimestamp).toEqual(expect.anything());
		}
	});

	it("should set a timestamp on events generated for different resource types", async () => {
		const namespace = await getTestNamespace();
		await apps.createNamespacedDeployment({
			namespace,
			body: {
				metadata: { name: "event-timestamps" },
				spec: {
					replicas: 1,
					selector: { matchLabels: { app: "event-timestamps" } },
					template: {
						metadata: { labels: { app: "event-timestamps" } },
						spec: {
							containers: [
								{
									name: "pause",
									image: "registry.k8s.io/pause:3.10",
								},
							],
						},
					},
				},
			},
		});

		let events: CoreV1Event[] = [];
		await waitFor(async () => {
			events = (await core.listNamespacedEvent({ namespace })).items;
			expect(events.map((event) => event.reason)).toEqual(
				expect.arrayContaining(["ScalingReplicaSet", "SuccessfulCreate", "Scheduled", "Started"]),
			);
		});

		expect(events.map((event) => event.involvedObject.kind)).toEqual(
			expect.arrayContaining(["Deployment", "ReplicaSet", "Pod"]),
		);
		const scheduledEvents = events.filter((event) => event.reason === "Scheduled");
		expect(scheduledEvents.length).toBeGreaterThan(0);
		for (const event of scheduledEvents) {
			expect(event.firstTimestamp ?? null).toBeNull();
			expect(event.lastTimestamp ?? null).toBeNull();
			expectTimestampCanBeReadAsDate(event.eventTime);
		}
		for (const event of events) {
			expectGeneratedEventTimestamp(event);
		}
	});

	it("should create, read, list, replace, and delete events", async () => {
		const namespace = await getSuiteNamespace();
		const created = await createEvent({
			metadata: {
				name: "event-crud",
				labels: { app: "event-crud" },
			},
			message: "created event",
			reason: "Created",
		});

		expect(created.metadata?.name).toBe("event-crud");
		expect(created.apiVersion).toBe("v1");
		expect(created.kind).toBe("Event");
		expect(created.metadata?.namespace).toBe(namespace);
		expect(created.involvedObject.name).toBe("event-subject");

		const read = await core.readNamespacedEvent({
			name: "event-crud",
			namespace,
		});
		expect(read.message).toBe("created event");
		expect(read.reason).toBe("Created");

		const namespaced = await core.listNamespacedEvent({
			namespace,
			labelSelector: "app=event-crud",
		});
		expect(namespaced.items.map((event) => event.metadata?.name)).toContain("event-crud");

		const all = await core.listEventForAllNamespaces({
			labelSelector: "app=event-crud",
		});
		expect(
			all.items.find(
				(event) => event.metadata?.name === "event-crud" && event.metadata?.namespace === namespace,
			),
		).toBeTruthy();

		const replaced = await core.replaceNamespacedEvent({
			name: "event-crud",
			namespace,
			body: {
				...read,
				message: "replaced event",
				reason: "Replaced",
			},
		});
		expect(replaced.message).toBe("replaced event");
		expect(replaced.reason).toBe("Replaced");

		const deleted = await core.deleteNamespacedEvent({
			name: "event-crud",
			namespace,
		});
		expect(deleted.status).toBe("Success");

		await expect(
			core.readNamespacedEvent({
				name: "event-crud",
				namespace,
			}),
		).rejects.toThrow(/NotFound|not found/);
	});

	it("should support field selectors when listing events", async () => {
		const namespace = await getSuiteNamespace();
		const selectedName = `field-selected-event-${namespace}`;
		const ignoredName = `field-ignored-event-${namespace}`;

		await createEvent({
			metadata: {
				name: selectedName,
			},
		});
		await createEvent({
			metadata: {
				name: ignoredName,
			},
		});

		const namespaced = await core.listNamespacedEvent({
			namespace,
			fieldSelector: `metadata.name=${selectedName}`,
		});
		expect(namespaced.items).toEqual([
			expect.objectContaining({
				metadata: expect.objectContaining({
					name: selectedName,
					namespace,
				}),
			}),
		]);

		const all = await core.listEventForAllNamespaces({
			fieldSelector: `metadata.name=${selectedName}`,
		});
		expect(all.items).toEqual([
			expect.objectContaining({
				metadata: expect.objectContaining({
					name: selectedName,
					namespace,
				}),
			}),
		]);
	});

	it("should list events from an exact resourceVersion snapshot", async () => {
		const namespace = await getSuiteNamespace();
		await createEvent({
			metadata: {
				name: "exact-list-before",
			},
		});
		const firstList = await core.listNamespacedEvent({ namespace });
		const snapshotResourceVersion = firstList.metadata?.resourceVersion ?? "";
		expect(Number(snapshotResourceVersion)).toBeGreaterThan(0);

		await createEvent({
			metadata: {
				name: "exact-list-after",
			},
		});

		const exactList = await core.listNamespacedEvent({
			namespace,
			resourceVersion: snapshotResourceVersion,
			resourceVersionMatch: "Exact",
		});

		expect(exactList.metadata?.resourceVersion).toBe(snapshotResourceVersion);
		expect(exactList.items.map((event) => event.metadata?.name)).toContain("exact-list-before");
		expect(exactList.items.map((event) => event.metadata?.name)).not.toContain("exact-list-after");
	});

	it("should list events not older than a resourceVersion", async () => {
		const namespace = await getSuiteNamespace();
		const firstList = await core.listNamespacedEvent({ namespace });
		const snapshotResourceVersion = firstList.metadata?.resourceVersion ?? "";
		expect(Number(snapshotResourceVersion)).toBeGreaterThan(0);

		await createEvent({
			metadata: {
				name: "not-older-than-after",
			},
		});

		const notOlderThanList = await core.listNamespacedEvent({
			namespace,
			resourceVersion: snapshotResourceVersion,
			resourceVersionMatch: "NotOlderThan",
		});

		expect(Number(notOlderThanList.metadata?.resourceVersion)).toBeGreaterThanOrEqual(
			Number(snapshotResourceVersion),
		);
		expect(notOlderThanList.items.map((event) => event.metadata?.name)).toContain(
			"not-older-than-after",
		);
	});

	it("should reject replacing an event with a stale resourceVersion", async () => {
		const namespace = await getSuiteNamespace();
		await createEvent({
			metadata: {
				name: "replace-resource-version-conflict",
			},
			message: "created",
		});
		const stale = await core.readNamespacedEvent({
			name: "replace-resource-version-conflict",
			namespace,
		});

		await core.replaceNamespacedEvent({
			name: "replace-resource-version-conflict",
			namespace,
			body: {
				...stale,
				message: "fresh",
			},
		});

		let replaceError: unknown;
		try {
			await core.replaceNamespacedEvent({
				name: "replace-resource-version-conflict",
				namespace,
				body: {
					...stale,
					message: "stale",
				},
			});
		} catch (error) {
			replaceError = error;
		}

		expect(apiErrorCode(replaceError)).toBe(409);
		const current = await core.readNamespacedEvent({
			name: "replace-resource-version-conflict",
			namespace,
		});
		expect(current.message).toBe("fresh");
	});

	it("should allow replacing an event without a resourceVersion", async () => {
		const namespace = await getSuiteNamespace();
		const event = await createEvent({
			metadata: {
				name: "replace-without-resource-version",
			},
			message: "created",
		});
		const { resourceVersion: _resourceVersion, ...metadata } = event.metadata ?? {};

		const replaced = await core.replaceNamespacedEvent({
			name: "replace-without-resource-version",
			namespace,
			body: {
				...event,
				metadata,
				message: "unconditional",
			},
		});

		expect(replaced.message).toBe("unconditional");
	});

	it("should reject deleting an event with a stale resourceVersion precondition", async () => {
		const namespace = await getSuiteNamespace();
		const event = await createEvent({
			metadata: {
				name: "delete-resource-version-precondition",
			},
			message: "created",
		});
		const staleResourceVersion = event.metadata?.resourceVersion ?? "";
		expect(Number(staleResourceVersion)).toBeGreaterThan(0);

		await core.replaceNamespacedEvent({
			name: "delete-resource-version-precondition",
			namespace,
			body: {
				...event,
				message: "updated",
			},
		});

		let deleteError: unknown;
		try {
			await core.deleteNamespacedEvent({
				name: "delete-resource-version-precondition",
				namespace,
				body: {
					preconditions: {
						resourceVersion: staleResourceVersion,
					},
				},
			});
		} catch (error) {
			deleteError = error;
		}

		expect(apiErrorCode(deleteError)).toBe(409);
		const current = await core.readNamespacedEvent({
			name: "delete-resource-version-precondition",
			namespace,
		});
		expect(current.message).toBe("updated");
	});
});

function expectGeneratedEventTimestamp(event: CoreV1Event): void {
	const firstTimestamp = event.firstTimestamp ?? null;
	const lastTimestamp = event.lastTimestamp ?? null;
	const usesEventTime = firstTimestamp === null;

	expect(firstTimestamp === null).toBe(lastTimestamp === null);
	expect(usesEventTime || firstTimestamp instanceof Date).toBe(true);
	expect(usesEventTime || lastTimestamp instanceof Date).toBe(true);
	expectTimestampCanBeReadAsDate(usesEventTime ? event.eventTime : firstTimestamp);
}

function expectTimestampCanBeReadAsDate(value: unknown): void {
	expect(value).toEqual(expect.anything());
	const date = value instanceof Date ? value : new Date(String(value));
	expect(Number.isNaN(date.getTime())).toBe(false);
}
