import { expect, it } from "vitest";

import { browser } from "../../test/describe";
import { waitFor } from "../../test/wait";
import { Cluster } from "../cluster";

browser.describe("Scheduler", () => {
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
});
