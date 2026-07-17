/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { V1Affinity } from "./V1Affinity.js";
import { V1Container } from "./V1Container.js";
import { V1EphemeralContainer } from "./V1EphemeralContainer.js";
import { V1HostAlias } from "./V1HostAlias.js";
import { V1LocalObjectReference } from "./V1LocalObjectReference.js";
import { V1PodDNSConfig } from "./V1PodDNSConfig.js";
import { V1PodOS } from "./V1PodOS.js";
import { V1PodReadinessGate } from "./V1PodReadinessGate.js";
import { V1PodResourceClaim } from "./V1PodResourceClaim.js";
import { V1PodSchedulingGate } from "./V1PodSchedulingGate.js";
import { V1PodSecurityContext } from "./V1PodSecurityContext.js";
import { V1ResourceRequirements } from "./V1ResourceRequirements.js";
import { V1Toleration } from "./V1Toleration.js";
import { V1TopologySpreadConstraint } from "./V1TopologySpreadConstraint.js";
import { V1Volume } from "./V1Volume.js";
export interface V1PodSpec {
	activeDeadlineSeconds?: number;
	affinity?: V1Affinity;
	automountServiceAccountToken?: boolean;
	containers: Array<V1Container>;
	dnsConfig?: V1PodDNSConfig;
	dnsPolicy?: string;
	enableServiceLinks?: boolean;
	ephemeralContainers?: Array<V1EphemeralContainer>;
	hostAliases?: Array<V1HostAlias>;
	hostIPC?: boolean;
	hostNetwork?: boolean;
	hostPID?: boolean;
	hostUsers?: boolean;
	hostname?: string;
	hostnameOverride?: string;
	imagePullSecrets?: Array<V1LocalObjectReference>;
	initContainers?: Array<V1Container>;
	nodeName?: string;
	nodeSelector?: {
		[key: string]: string;
	};
	os?: V1PodOS;
	overhead?: {
		[key: string]: string;
	};
	preemptionPolicy?: string;
	priority?: number;
	priorityClassName?: string;
	readinessGates?: Array<V1PodReadinessGate>;
	resourceClaims?: Array<V1PodResourceClaim>;
	resources?: V1ResourceRequirements;
	restartPolicy?: string;
	runtimeClassName?: string;
	schedulerName?: string;
	schedulingGates?: Array<V1PodSchedulingGate>;
	securityContext?: V1PodSecurityContext;
	serviceAccount?: string;
	serviceAccountName?: string;
	setHostnameAsFQDN?: boolean;
	shareProcessNamespace?: boolean;
	subdomain?: string;
	terminationGracePeriodSeconds?: number;
	tolerations?: Array<V1Toleration>;
	topologySpreadConstraints?: Array<V1TopologySpreadConstraint>;
	volumes?: Array<V1Volume>;
}
