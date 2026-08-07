import { bench, describe } from "vitest";
import { deepClone } from "./deep-clone.js";

function samplePod(index: number): Record<string, unknown> {
	return {
		apiVersion: "v1",
		kind: "Pod",
		metadata: {
			name: `probe-control-${index}`,
			namespace: "default",
			uid: `11111111-2222-3333-4444-${String(index).padStart(12, "0")}`,
			resourceVersion: String(1000 + index),
			creationTimestamp: new Date("2026-07-07T00:00:00.000Z"),
			labels: {
				app: "probe-control",
				demo: "probe-playground",
				pod: "a",
				"pod-template-hash": "5d4f8b7c9",
			},
			annotations: {
				"blog.ngrok.com/pod-display-name": `v${index}`,
				"blog.ngrok.com/pod-not-listening": "true",
			},
			ownerReferences: [
				{
					apiVersion: "apps/v1",
					kind: "ReplicaSet",
					name: "deployment-a-5d4f8b7c9",
					uid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
					controller: true,
					blockOwnerDeletion: true,
				},
			],
		},
		spec: {
			terminationGracePeriodSeconds: 2,
			nodeName: "node-1",
			containers: [
				{
					name: "probe-control",
					image: "probe-control:1.0.0",
					ports: [{ containerPort: 8080, name: "http", protocol: "TCP" }],
					env: [
						{ name: "LAME_DUCK_SECONDS", value: "1" },
						{ name: "CRASH_AFTER_REQUESTS_PER_SECOND", value: "4" },
						{ name: "STARTUP_DELAY_MS", value: "2000" },
					],
					readinessProbe: {
						httpGet: { path: "/readyz", port: "http" },
						periodSeconds: 5,
						failureThreshold: 1,
						successThreshold: 1,
						initialDelaySeconds: 0,
						timeoutSeconds: 5,
					},
				},
			],
		},
		status: {
			phase: "Running",
			podIP: "10.0.0.5",
			startTime: new Date("2026-07-07T00:00:01.000Z"),
			conditions: [
				{
					type: "Ready",
					status: "True",
					lastTransitionTime: new Date("2026-07-07T00:00:02.000Z"),
				},
				{
					type: "ContainersReady",
					status: "True",
					lastTransitionTime: new Date("2026-07-07T00:00:02.000Z"),
				},
			],
			containerStatuses: [
				{
					name: "probe-control",
					ready: true,
					restartCount: 0,
					image: "probe-control:1.0.0",
					state: { running: { startedAt: new Date("2026-07-07T00:00:01.000Z") } },
				},
			],
		},
	};
}

const onePod = samplePod(1);
const sixPods = Array.from({ length: 6 }, (_unused, index) => samplePod(index));

describe("deep copy of one pod", () => {
	bench("structuredClone", () => {
		structuredClone(onePod);
	});

	bench("deepClone", () => {
		deepClone(onePod);
	});
});

// Models the informer read shape that dominates the profile: a lister returning every pod in a
// namespace, copied once per item, on every controller sync.
describe("deep copy of a six pod list", () => {
	bench("structuredClone", () => {
		sixPods.map((pod) => structuredClone(pod));
	});

	bench("deepClone", () => {
		sixPods.map((pod) => deepClone(pod));
	});
});
