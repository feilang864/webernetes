/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { V1EndpointConditions } from "./V1EndpointConditions.js";
import { V1EndpointHints } from "./V1EndpointHints.js";
import { V1ObjectReference } from "./V1ObjectReference.js";

export interface V1Endpoint {
	addresses: Array<string>;
	conditions?: V1EndpointConditions;
	deprecatedTopology?: {
		[key: string]: string;
	};
	hints?: V1EndpointHints;
	hostname?: string;
	nodeName?: string;
	targetRef?: V1ObjectReference;
	zone?: string;
}
