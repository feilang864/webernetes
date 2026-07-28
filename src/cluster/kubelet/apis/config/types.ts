/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
// Models kubernetes/pkg/kubelet/apis/config/types.go KubeletConfiguration.
export interface KubeletConfiguration {
	syncFrequencyMs: number;
	clusterDNS: string[];
	clusterDomain: string;
	registryPullQPS: number;
	registryBurst: number;
	serializeImagePulls: boolean;
	maxParallelImagePulls: number | undefined;
	minimumGCAgeMs: number;
	maxPerPodContainerCount: number;
	maxContainerCount: number;
	nodeStatusMaxImages: number;
	crashLoopBackOff: CrashLoopBackOffConfig;
}

// Models kubernetes/pkg/kubelet/apis/config/types.go CrashLoopBackOffConfig.
export interface CrashLoopBackOffConfig {
	/**
	 * Maximum delay between restart attempts for containers in CrashLoopBackOff.
	 *
	 * Kubernetes accepts values from one second through five minutes. Webernetes
	 * additionally accepts zero to disable restart delay.
	 */
	maxContainerRestartPeriodMs?: number;
}
