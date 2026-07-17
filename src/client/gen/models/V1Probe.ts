/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { V1ExecAction } from "./V1ExecAction.js";
import { V1GRPCAction } from "./V1GRPCAction.js";
import { V1HTTPGetAction } from "./V1HTTPGetAction.js";
import { V1TCPSocketAction } from "./V1TCPSocketAction.js";
export interface V1Probe {
	exec?: V1ExecAction;
	failureThreshold?: number;
	grpc?: V1GRPCAction;
	httpGet?: V1HTTPGetAction;
	initialDelaySeconds?: number;
	periodSeconds?: number;
	successThreshold?: number;
	tcpSocket?: V1TCPSocketAction;
	terminationGracePeriodSeconds?: number;
	timeoutSeconds?: number;
}
