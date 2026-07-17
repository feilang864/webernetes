/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { V1ListMeta } from "./V1ListMeta.js";
import { V1Service } from "./V1Service.js";

export interface V1ServiceList {
	apiVersion?: string;
	items: Array<V1Service>;
	kind?: string;
	metadata?: V1ListMeta;
}
