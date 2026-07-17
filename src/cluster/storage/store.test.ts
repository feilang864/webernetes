import { afterEach, beforeEach, expect, it } from "vitest";

import { getClock } from "../../clock-context";
import { fakeEtcd } from "../../test/harnesses/etcd";
import type * as context from "../../go/context";
import type { Etcd } from "../etcd";
import { createBarrier } from "./helpers";
import { Store, type Storable } from "./store";
import type { Watcher } from "./watch";

interface TestObject extends Storable {
	metadata: {
		name?: string;
		generateName?: string;
		deletionGracePeriodSeconds?: number;
		deletionTimestamp?: Date;
		finalizers?: string[];
		resourceVersion?: string;
		uid?: string;
		creationTimestamp?: Date;
	};
	value?: string;
}

type StoreEvent = {
	phase: "ADDED" | "MODIFIED" | "DELETED";
	object: TestObject;
};

fakeEtcd.describe("Store resourceVersion", ({ ctx, createEtcd }) => {
	let etcd: Etcd;
	let store: Store<TestObject>;

	beforeEach(async () => {
		etcd = (await createEtcd()) as Etcd;
		await etcd.delete().all().exec();
		store = new Store<TestObject>(ctx, etcd, {
			defaultQualifiedResource: "tests",
			singularQualifiedResource: "test",
			apiVersion: "test.k8s.io/v1",
			kind: "Test",
		});
	});

	afterEach(() => {
		etcd.close();
	});

	it("sets and persists the creation timestamp from the cluster clock", async () => {
		const clock = getClock(ctx);
		clock.pause();
		const now = clock.now();

		const created = await store.create({ metadata: { name: "timestamped" } });
		const stored = await store.get("timestamped");

		expect(created.metadata.creationTimestamp).toBeInstanceOf(Date);
		expect(created.metadata.creationTimestamp?.getTime()).toBe(now.getTime());
		expect(stored?.metadata.creationTimestamp).toBeInstanceOf(Date);
		expect(stored?.metadata.creationTimestamp?.getTime()).toBe(now.getTime());
	});

	it("assigns a non-empty UID when creating an object", async () => {
		const created = await store.create({ metadata: { name: "identified" } });

		expect(created.metadata.uid).toEqual(expect.any(String));
		expect(created.metadata.uid?.length).toBeGreaterThan(0);
		expect((await store.get("identified"))?.metadata.uid).toBe(created.metadata.uid);
	});

	it("preserves an existing UID when an update omits it", async () => {
		const created = await store.create({ metadata: { name: "preserved" }, value: "initial" });
		const watcher = store.watch(undefined, Number(created.metadata.resourceVersion) + 1);
		const event = nextStoreEvent(watcher);

		const updated = await store.update("preserved", {
			metadata: { name: "preserved", resourceVersion: created.metadata.resourceVersion },
			value: "updated",
		});

		expect(updated.metadata.uid).toBe(created.metadata.uid);
		expect((await store.get("preserved"))?.metadata.uid).toBe(created.metadata.uid);
		expect(
			(await store.list()).find((item) => item.metadata.name === "preserved")?.metadata.uid,
		).toBe(created.metadata.uid);
		await expect(event).resolves.toEqual({
			phase: "MODIFIED",
			object: expect.objectContaining({
				metadata: expect.objectContaining({ uid: created.metadata.uid }),
			}),
		});
		await watcher.cancel();
	});

	it("accepts an update containing the existing UID", async () => {
		const created = await store.create({ metadata: { name: "matching" }, value: "initial" });

		const updated = await store.update("matching", {
			metadata: {
				name: "matching",
				resourceVersion: created.metadata.resourceVersion,
				uid: created.metadata.uid,
			},
			value: "updated",
		});

		expect(updated.metadata.uid).toBe(created.metadata.uid);
	});

	it("rejects an update containing a different UID", async () => {
		const created = await store.create({ metadata: { name: "immutable" }, value: "initial" });

		await expect(
			store.update("immutable", {
				metadata: {
					name: "immutable",
					resourceVersion: created.metadata.resourceVersion,
					uid: "different-uid",
				},
				value: "updated",
			}),
		).rejects.toThrow(
			`Operation cannot be fulfilled on tests "immutable": StorageError: invalid object, Code: 4, Key: /registry/tests/immutable, ResourceVersion: 0, AdditionalErrorMsg: Precondition failed: UID in precondition: different-uid, UID in object meta: ${created.metadata.uid}`,
		);
		expect((await store.get("immutable"))?.metadata.uid).toBe(created.metadata.uid);
		expect((await store.get("immutable"))?.value).toBe("initial");
	});

	it("assigns a new UID after an object is deleted and recreated", async () => {
		const created = await store.create({ metadata: { name: "recreated" } });
		await store.delete("recreated");

		const recreated = await store.create({ metadata: { name: "recreated" } });

		expect(recreated.metadata.uid).toEqual(expect.any(String));
		expect(recreated.metadata.uid).not.toBe(created.metadata.uid);
	});

	it("returns a list resourceVersion at least as new as every listed item", async () => {
		const first = await store.create({ metadata: { name: "first" }, value: "one" });
		const second = await store.create({ metadata: { name: "second" }, value: "two" });

		const list = await store.listWithResourceVersion();

		expect(list.items).toHaveLength(2);
		expect(Number(list.resourceVersion)).toBeGreaterThanOrEqual(
			Number(first.metadata.resourceVersion),
		);
		expect(Number(list.resourceVersion)).toBeGreaterThanOrEqual(
			Number(second.metadata.resourceVersion),
		);
		expect(list.items.map((item) => item.metadata.resourceVersion)).toEqual([
			first.metadata.resourceVersion,
			second.metadata.resourceVersion,
		]);
	});

	it("starts watches from the revision after the supplied list resourceVersion", async () => {
		await store.create({ metadata: { name: "watched" }, value: "initial" });
		const list = await store.listWithResourceVersion();

		const watcher = store.watch(undefined, Number(list.resourceVersion) + 1);
		const event = nextStoreEvent(watcher);
		const updated = await store.update("watched", {
			metadata: { name: "watched" },
			value: "updated",
		});

		await expect(event).resolves.toEqual({
			phase: "MODIFIED",
			object: expect.objectContaining({
				metadata: expect.objectContaining({
					name: "watched",
					resourceVersion: updated.metadata.resourceVersion,
				}),
				value: "updated",
			}),
		});
		await watcher.cancel();
	});

	it("stamps watch events with the event revision instead of the stored object revision", async () => {
		const created = await store.create({ metadata: { name: "stamped" }, value: "initial" });
		const list = await store.listWithResourceVersion();
		const staleObjectRevision = created.metadata.resourceVersion;

		const watcher = store.watch(undefined, Number(list.resourceVersion) + 1);
		const event = nextStoreEvent(watcher);
		const updated = await store.update("stamped", {
			metadata: { name: "stamped", resourceVersion: staleObjectRevision },
			value: "updated",
		});

		await expect(event).resolves.toEqual({
			phase: "MODIFIED",
			object: expect.objectContaining({
				metadata: expect.objectContaining({
					name: "stamped",
					resourceVersion: updated.metadata.resourceVersion,
				}),
				value: "updated",
			}),
		});
		expect(updated.metadata.resourceVersion).not.toBe(staleObjectRevision);
		await watcher.cancel();
	});

	it("allows only one concurrent create for the same key", async () => {
		const contendedStore = new ContendedCreateStore(ctx, etcd, createBarrier(2));

		const results = await Promise.allSettled([
			contendedStore.create({ metadata: { name: "singleton" }, value: "first" }),
			contendedStore.create({ metadata: { name: "singleton" }, value: "second" }),
		]);

		const fulfilled = results.filter(
			(result): result is PromiseFulfilledResult<TestObject> => result.status === "fulfilled",
		);
		const rejected = results.filter(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		);

		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expect((await contendedStore.get("singleton"))?.value).toBe(fulfilled[0]?.value.value);
	});

	it("appends generated name suffixes directly to the supplied prefix", async () => {
		const created = await store.create({
			metadata: {
				generateName: "worker-",
			},
		});

		expect(created.metadata.name).toMatch(/^worker-[a-z0-9]+$/);
		expect(created.metadata.name).not.toContain("--");
	});

	it("deletes a pending-deletion object when its finalizers are cleared", async () => {
		await store.create({
			metadata: {
				name: "finalized",
				deletionTimestamp: new Date(1_000),
				finalizers: ["example.com/hold"],
			},
		});

		await store.update("finalized", {
			metadata: {
				name: "finalized",
				deletionTimestamp: new Date(1_000),
			},
		});

		await expect(store.get("finalized")).resolves.toBeUndefined();
	});

	it("does not delete an object that changes after delete preparation", async () => {
		const contendedStore = new ContendedDeleteStore(ctx, etcd, createBarrier(1));
		await contendedStore.create({ metadata: { name: "protected" }, value: "allowed" });

		const deletion = contendedStore.delete("protected");
		await contendedStore.waitUntilDeletePrepared();

		await contendedStore.update("protected", {
			metadata: { name: "protected" },
			value: "blocked",
		});
		contendedStore.releaseDelete();

		await expect(deletion).rejects.toThrow("blocked");
		expect((await contendedStore.get("protected"))?.value).toBe("blocked");
	});
});

function nextStoreEvent(watcher: Watcher<TestObject>) {
	return new Promise<StoreEvent>((resolve) => {
		watcher.once("event", (phase, object) => resolve({ phase, object }));
	});
}

// Store variant for create race tests.
//
// `validateCreate` runs after Store.create has done its preflight existence
// check and after resource-specific prepare logic, but before the final etcd
// write. Pass a barrier as `waitAtCreate` to hold multiple create calls at that
// point so they all believe the key is free before any one of them commits.
// This lets tests assert that the storage write itself, not the earlier read,
// is responsible for serializing same-key creates.
class ContendedCreateStore extends Store<TestObject> {
	constructor(
		ctx: context.Context,
		etcd: Etcd,
		private readonly waitAtCreate: () => Promise<void>,
	) {
		super(ctx, etcd, {
			defaultQualifiedResource: "contended-tests",
			singularQualifiedResource: "contended-test",
			apiVersion: "test.k8s.io/v1",
			kind: "Test",
		});
	}

	protected override async validateCreate(): Promise<void> {
		await this.waitAtCreate();
	}
}

// Store variant for delete race tests.
//
// `prepareDelete` runs after Store.delete has read the object but before it
// deletes the key from etcd. Tests start a delete, wait for
// `waitUntilDeletePrepared()` to prove the stale object has been inspected, then
// modify the object and call `releaseDelete()` to let deletion continue. The
// hook rejects objects whose latest value is "blocked", so a correct optimistic
// delete implementation must re-read/retry after a conflict and preserve the
// updated object instead of deleting based on the stale prepared value.
class ContendedDeleteStore extends Store<TestObject> {
	private prepared = false;
	private resolvePrepared: () => void = () => undefined;
	private releasePrepared: () => void = () => undefined;
	private readonly preparedPromise = new Promise<void>((resolve) => {
		this.resolvePrepared = resolve;
	});
	private readonly releasePromise = new Promise<void>((resolve) => {
		this.releasePrepared = resolve;
	});

	constructor(
		ctx: context.Context,
		etcd: Etcd,
		private readonly waitAtDelete: () => Promise<void>,
	) {
		super(ctx, etcd, {
			defaultQualifiedResource: "contended-delete-tests",
			singularQualifiedResource: "contended-delete-test",
			apiVersion: "test.k8s.io/v1",
			kind: "Test",
		});
	}

	protected override async prepareDelete(obj: TestObject): Promise<void> {
		if (obj.value === "blocked") {
			throw new Error("blocked");
		}
		this.prepared = true;
		this.resolvePrepared();
		await this.waitAtDelete();
		await this.releasePromise;
	}

	async waitUntilDeletePrepared(): Promise<void> {
		if (this.prepared) {
			return;
		}
		await this.preparedPromise;
	}

	releaseDelete(): void {
		this.releasePrepared();
	}
}
