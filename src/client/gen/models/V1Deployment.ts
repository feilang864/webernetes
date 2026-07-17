/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { V1DeploymentSpec } from "./V1DeploymentSpec.js";
import { V1DeploymentStatus } from "./V1DeploymentStatus.js";
import { V1ObjectMeta } from "./V1ObjectMeta.js";

export interface V1Deployment {
	apiVersion?: string;
	kind?: string;
	metadata?: V1ObjectMeta;
	spec?: V1DeploymentSpec;
	status?: V1DeploymentStatus;
}
