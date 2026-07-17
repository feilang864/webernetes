/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { V1EndpointSlice } from "./V1EndpointSlice.js";
import { V1ListMeta } from "./V1ListMeta.js";

export interface V1EndpointSliceList {
	apiVersion?: string;
	items: Array<V1EndpointSlice>;
	kind?: string;
	metadata?: V1ListMeta;
}
