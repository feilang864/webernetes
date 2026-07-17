/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { V1ExecAction } from "./V1ExecAction.js";
import { V1HTTPGetAction } from "./V1HTTPGetAction.js";
import { V1SleepAction } from "./V1SleepAction.js";
import { V1TCPSocketAction } from "./V1TCPSocketAction.js";
export interface V1LifecycleHandler {
	exec?: V1ExecAction;
	httpGet?: V1HTTPGetAction;
	sleep?: V1SleepAction;
	tcpSocket?: V1TCPSocketAction;
}
