/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { V1ObjectMeta } from "./V1ObjectMeta.js";
import { V1ScaleSpec } from "./V1ScaleSpec.js";
import { V1ScaleStatus } from "./V1ScaleStatus.js";

export interface V1Scale {
	apiVersion?: string;
	kind?: string;
	metadata?: V1ObjectMeta;
	spec?: V1ScaleSpec;
	status?: V1ScaleStatus;
}
