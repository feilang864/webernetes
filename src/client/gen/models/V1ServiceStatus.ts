/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { V1Condition } from "./V1Condition.js";
import { V1LoadBalancerStatus } from "./V1LoadBalancerStatus.js";

export interface V1ServiceStatus {
	conditions?: Array<V1Condition>;
	loadBalancer?: V1LoadBalancerStatus;
}
