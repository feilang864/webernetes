/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { V1ListMeta } from "./V1ListMeta.js";
import { V1Node } from "./V1Node.js";

export interface V1NodeList {
	apiVersion?: string;
	items: Array<V1Node>;
	kind?: string;
	metadata?: V1ListMeta;
}
