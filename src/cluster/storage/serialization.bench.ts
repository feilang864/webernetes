import { Buffer } from "buffer";
import { bench, describe } from "vitest";

import { deepClone } from "../../deep-clone.js";
import { parseStoredObject } from "./serialization.js";

const storedPod = {
	apiVersion: "v1",
	kind: "Pod",
	metadata: {
		name: "probe-control-abc12",
		namespace: "default",
		uid: "11111111-2222-3333-4444-555555555555",
		resourceVersion: "1042",
		creationTimestamp: "2026-07-07T00:00:00.000Z",
		labels: { app: "probe-control", demo: "probe-playground", "pod-template-hash": "5d4f8b7c9" },
		annotations: { "blog.ngrok.com/pod-display-name": "v3" },
	},
	spec: {
		nodeName: "node-1",
		terminationGracePeriodSeconds: 2,
		containers: [
			{
				name: "probe-control",
				image: "probe-control:1.0.0",
				ports: [{ containerPort: 8080, name: "http", protocol: "TCP" }],
				env: [
					{ name: "LAME_DUCK_SECONDS", value: "1" },
					{ name: "STARTUP_DELAY_MS", value: "2000" },
				],
				readinessProbe: {
					httpGet: { path: "/readyz", port: "http" },
					periodSeconds: 5,
					failureThreshold: 1,
				},
			},
		],
	},
	status: {
		phase: "Running",
		podIP: "10.0.0.5",
		startTime: "2026-07-07T00:00:01.000Z",
		conditions: [
			{ type: "Ready", status: "True", lastTransitionTime: "2026-07-07T00:00:02.000Z" },
			{ type: "ContainersReady", status: "True", lastTransitionTime: "2026-07-07T00:00:02.000Z" },
		],
		containerStatuses: [
			{ name: "probe-control", ready: true, restartCount: 0, image: "probe-control:1.0.0" },
		],
	},
};

const storedJson = JSON.stringify(storedPod);
const storedBytes = Buffer.from(storedJson);
const parsedOnce = parseStoredObject<Record<string, unknown>>(storedJson);

// The store read path used to be `kv.value.toString()` then `parseStoredObject`, on every read.
// Resources now go into etcd as objects, so a read copies the stored object and touches no JSON.
// These benches record the size of that difference.
describe("store read path for one pod", () => {
	bench("decode bytes then parse with reviver (former read path)", () => {
		parseStoredObject(storedBytes.toString());
	});

	bench("copy the stored object (current read path)", () => {
		deepClone(parsedOnce);
	});

	bench("decode bytes then JSON.parse with no reviver", () => {
		JSON.parse(storedBytes.toString());
	});

	bench("decode bytes only", () => {
		storedBytes.toString();
	});
});

// Writes changed too: `JSON.stringify` into bytes became a defensive copy of the object.
describe("store write path for one pod", () => {
	bench("JSON.stringify to bytes (former write path)", () => {
		Buffer.from(JSON.stringify(storedPod));
	});

	bench("deepClone a snapshot (current write path)", () => {
		deepClone(storedPod);
	});
});
