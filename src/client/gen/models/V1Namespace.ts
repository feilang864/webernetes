/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { V1NamespaceSpec } from "./V1NamespaceSpec.js";
import { V1NamespaceStatus } from "./V1NamespaceStatus.js";
import { V1ObjectMeta } from "./V1ObjectMeta.js";

export interface V1Namespace {
	apiVersion?: string;
	kind?: string;
	metadata?: V1ObjectMeta;
	spec?: V1NamespaceSpec;
	status?: V1NamespaceStatus;
}
