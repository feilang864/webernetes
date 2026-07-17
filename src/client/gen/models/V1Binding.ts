/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { V1ObjectMeta } from "./V1ObjectMeta.js";
import { V1ObjectReference } from "./V1ObjectReference.js";

export interface V1Binding {
	apiVersion?: string;
	kind?: string;
	metadata?: V1ObjectMeta;
	target: V1ObjectReference;
}
