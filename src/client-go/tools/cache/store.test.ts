/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { expect, it } from "vitest";

import { both } from "../../../test/describe.js";
import { newIndexer } from "./store.js";
import { KeyError, newStore, withTransformer } from "./store.js";
import {
	doTestIndex,
	doTestStore,
	isTestStoreObject,
	testStoreIndexers,
	testStoreKeyFunc,
	type TestStoreObject,
} from "./store-test-helpers.js";

both.describe("Store", () => {
	// Models staging/src/k8s.io/client-go/tools/cache/store_test.go TestCache.
	it("implements the public store interface", async () => {
		expect.hasAssertions();
		await doTestStore(newStore(testStoreKeyFunc));
	});

	// Models staging/src/k8s.io/client-go/tools/cache/store_test.go TestCacheWithTransformer.
	it("transforms objects before storing them", async () => {
		expect.hasAssertions();
		let transformerCalled = false;
		await doTestStore(
			newStore(
				testStoreKeyFunc,
				withTransformer((i) => {
					transformerCalled = true;
					if (!isTestStoreObject(i)) {
						return [i, new Error("wrong object type")];
					}
					return [i, undefined];
				}),
			),
		);
		expect(transformerCalled).toBe(true);
	});

	// Models staging/src/k8s.io/client-go/tools/cache/store_test.go TestKeyError.
	it("wraps key function errors", () => {
		const obj: TestStoreObject = { id: "100", val: "" };
		const err = new Error("error");
		const keyErr = new KeyError(obj, err);

		expect(keyErr.err).toBe(err);

		const nestedKeyErr = new KeyError(obj, keyErr);
		expect(keyErr.err).toBe(err);
		expect(nestedKeyErr.err).toBe(keyErr);
	});

	// Models staging/src/k8s.io/client-go/tools/cache/store_test.go TestIndex.
	it("implements the public indexer interface", async () => {
		await doTestIndex(newIndexer(testStoreKeyFunc, testStoreIndexers()));
	});
});
