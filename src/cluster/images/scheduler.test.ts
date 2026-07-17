import { expect, it } from "vitest";

import { both } from "../../test/describe.js";
import { waitFor } from "../../test/wait.js";
import { Cluster } from "../cluster.js";

function podCountsByNode(pods: Array<{ spec?: { nodeName?: string } }>): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const pod of pods) {
		const nodeName = pod.spec?.nodeName;
		if (!nodeName) {
			continue;
		}
		counts[nodeName] = (counts[nodeName] ?? 0) + 1;
	}
	return counts;
}

both.describe("Scheduler", () => {
	it("binds pending pods to the node with the fewest non-system pods", async () => {
		const cluster = new Cluster();
		await cluster.init();
		try {
			await cluster.api.corev1.createNamespacedPod({
				namespace: "default",
				body: {
					metadata: { name: "warmup-workload" },
					spec: {
						containers: [{ name: "pause", image: "registry.k8s.io/pause:3.10" }],
					},
				},
			});
			await waitFor(async () => {
				const pod = await cluster.api.corev1.readNamespacedPod({
					namespace: "default",
					name: "warmup-workload",
				});
				expect(pod.spec?.nodeName).toBe("node-1");
			});

			await cluster.api.corev1.createNamespacedPod({
				namespace: "default",
				body: {
					metadata: { name: "existing-workload" },
					spec: {
						nodeName: "node-2",
						containers: [{ name: "pause", image: "registry.k8s.io/pause:3.10" }],
					},
				},
			});

			await cluster.api.corev1.createNamespacedPod({
				namespace: "default",
				body: {
					metadata: { name: "pending-workload" },
					spec: {
						containers: [{ name: "pause", image: "registry.k8s.io/pause:3.10" }],
					},
				},
			});

			await waitFor(async () => {
				const pod = await cluster.api.corev1.readNamespacedPod({
					namespace: "default",
					name: "pending-workload",
				});
				expect(pod.spec?.nodeName).toBe("node-3");
			});
		} finally {
			await cluster.close();
		}
	});

	it("spreads a burst of pending workload pods evenly across nodes", async () => {
		const cluster = new Cluster();
		await cluster.init();
		try {
			await Promise.all(
				Array.from({ length: 9 }, async (_, index) => {
					await cluster.api.corev1.createNamespacedPod({
						namespace: "default",
						body: {
							metadata: { name: `burst-workload-${index}` },
							spec: {
								containers: [{ name: "pause", image: "registry.k8s.io/pause:3.10" }],
							},
						},
					});
				}),
			);

			await waitFor(async () => {
				const pods = await cluster.api.corev1.listNamespacedPod({ namespace: "default" });
				const workloads = pods.items.filter((pod) =>
					pod.metadata?.name?.startsWith("burst-workload-"),
				);
				expect(workloads.every((pod) => !!pod.spec?.nodeName)).toBe(true);
				expect(podCountsByNode(workloads)).toEqual({
					"node-1": 3,
					"node-2": 3,
					"node-3": 3,
				});
			});
		} finally {
			await cluster.close();
		}
	});

	it("schedules a large burst across all configured nodes", async () => {
		const cluster = new Cluster({ nodes: 10 });
		await cluster.init();
		try {
			await Promise.all(
				Array.from({ length: 100 }, async (_, index) => {
					await cluster.api.corev1.createNamespacedPod({
						namespace: "default",
						body: {
							metadata: { name: `large-burst-workload-${index}` },
							spec: {
								containers: [{ name: "pause", image: "registry.k8s.io/pause:3.10" }],
							},
						},
					});
				}),
			);

			await waitFor(async () => {
				const pods = await cluster.api.corev1.listNamespacedPod({ namespace: "default" });
				const workloads = pods.items.filter((pod) =>
					pod.metadata?.name?.startsWith("large-burst-workload-"),
				);
				const counts = podCountsByNode(workloads);

				expect(workloads).toHaveLength(100);
				expect(workloads.every((pod) => !!pod.spec?.nodeName)).toBe(true);
				for (const server of cluster.servers) {
					expect(counts[server.name]).toBeGreaterThan(0);
				}
			});
		} finally {
			await cluster.close();
		}
	});

	it("does not count terminating workload pods when choosing a node", async () => {
		const cluster = new Cluster();
		await cluster.init();
		try {
			await cluster.api.corev1.createNamespacedPod({
				namespace: "default",
				body: {
					metadata: { name: "terminating-workload" },
					spec: {
						nodeName: "node-1",
						containers: [{ name: "pause", image: "registry.k8s.io/pause:3.10" }],
						terminationGracePeriodSeconds: 30,
					},
				},
			});
			await cluster.api.corev1.deleteNamespacedPod({
				namespace: "default",
				name: "terminating-workload",
			});
			await waitFor(async () => {
				const pod = await cluster.api.corev1.readNamespacedPod({
					namespace: "default",
					name: "terminating-workload",
				});
				expect(pod.metadata?.deletionTimestamp).toBeDefined();
			});

			await Promise.all(
				["node-2", "node-3"].map(async (nodeName) => {
					await cluster.api.corev1.createNamespacedPod({
						namespace: "default",
						body: {
							metadata: { name: `existing-${nodeName}` },
							spec: {
								nodeName,
								containers: [{ name: "pause", image: "registry.k8s.io/pause:3.10" }],
							},
						},
					});
				}),
			);

			await cluster.api.corev1.createNamespacedPod({
				namespace: "default",
				body: {
					metadata: { name: "pending-after-terminating" },
					spec: {
						containers: [{ name: "pause", image: "registry.k8s.io/pause:3.10" }],
					},
				},
			});

			await waitFor(async () => {
				const pod = await cluster.api.corev1.readNamespacedPod({
					namespace: "default",
					name: "pending-after-terminating",
				});
				expect(pod.spec?.nodeName).toBe("node-1");
			});
		} finally {
			await cluster.close();
		}
	});
});
