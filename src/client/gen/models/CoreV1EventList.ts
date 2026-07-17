/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { CoreV1Event } from "./CoreV1Event.js";
import { V1ListMeta } from "./V1ListMeta.js";

export interface CoreV1EventList {
	apiVersion?: string;
	items: CoreV1Event[];
	kind?: string;
	metadata?: V1ListMeta;
}
