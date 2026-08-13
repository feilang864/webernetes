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
	/**
	 * Webernetes-specific control for syncing pods when annotations are the only
	 * meaningful fields changed. Defaults to true to preserve Kubernetes behavior.
	 */
	syncOnAnnotationOnlyChanges: boolean;
	/**
	 * Webernetes-specific control for immediate readiness probes during pod
	 * reconciliation. Defaults to true to preserve Kubernetes behavior.
	 */
	manuallyTriggerReadinessProbeOnPodReconcile: boolean;
	/**
	 * Webernetes-specific control for probe worker timing after a kubelet
	 * restart. When undefined, Kubernetes' randomized delay within the probe
	 * period is used. Set a value to make restartable demonstrations predictable
	 * instead of making users wait an arbitrary time for their first probe.
	 */
	probeInitialDelayOnKubeletRestartMs?: number;
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
