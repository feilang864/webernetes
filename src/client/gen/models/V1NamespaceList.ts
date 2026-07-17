/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { V1ListMeta } from "./V1ListMeta.js";
import { V1Namespace } from "./V1Namespace.js";

export interface V1NamespaceList {
	apiVersion?: string;
	items: Array<V1Namespace>;
	kind?: string;
	metadata?: V1ListMeta;
}
