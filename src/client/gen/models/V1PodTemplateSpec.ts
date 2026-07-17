/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { V1ObjectMeta } from "./V1ObjectMeta.js";
import { V1PodSpec } from "./V1PodSpec.js";

export interface V1PodTemplateSpec {
	metadata?: V1ObjectMeta;
	spec?: V1PodSpec;
}
