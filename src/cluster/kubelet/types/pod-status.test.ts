/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { expect, it } from "vitest";
import { both } from "../../../test/describe.js";
import { podConditionByKubelet, podConditionSharedByKubelet } from "./pod-status.js";

// Models kubernetes/pkg/kubelet/types/pod_status_test.go TestPodConditionByKubelet.
both.describe("podConditionByKubelet", () => {
	const trueCases = [
		"PodScheduled",
		"Ready",
		"Initialized",
		"ContainersReady",
		"PodReadyToStartContainers",
	];

	for (const tc of trueCases) {
		it(`treats ${tc} as owned by kubelet`, () => {
			expect(podConditionByKubelet(tc)).toBe(true);
		});
	}

	const falseCases = ["abcd", "Unschedulable"];

	for (const tc of falseCases) {
		it(`does not treat ${tc} as owned by kubelet`, () => {
			expect(podConditionByKubelet(tc)).toBe(false);
		});
	}
});

// Upstream pod_status_test.go does not include this 1.36-default feature-gated
// case. The simulator has no feature gates, so it follows the default-enabled
// behavior.
both.describe("podConditionByKubelet local extra coverage", () => {
	it("treats AllContainersRestarting as owned by kubelet", () => {
		expect(podConditionByKubelet("AllContainersRestarting")).toBe(true);
	});
});

// Models kubernetes/pkg/kubelet/types/pod_status_test.go TestPodConditionSharedByKubelet.
both.describe("podConditionSharedByKubelet", () => {
	const trueCases = ["DisruptionTarget"];

	for (const tc of trueCases) {
		it(`treats ${tc} as shared by kubelet`, () => {
			expect(podConditionSharedByKubelet(tc)).toBe(true);
		});
	}

	const falseCases = ["abcd", "Unschedulable"];

	for (const tc of falseCases) {
		it(`does not treat ${tc} as shared by kubelet`, () => {
			expect(podConditionSharedByKubelet(tc)).toBe(false);
		});
	}
});
