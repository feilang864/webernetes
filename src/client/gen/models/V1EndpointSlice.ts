/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { DiscoveryV1EndpointPort } from "./DiscoveryV1EndpointPort.js";
import { V1Endpoint } from "./V1Endpoint.js";
import { V1ObjectMeta } from "./V1ObjectMeta.js";

export interface V1EndpointSlice {
	addressType: string;
	apiVersion?: string;
	endpoints: Array<V1Endpoint>;
	kind?: string;
	metadata?: V1ObjectMeta;
	ports?: Array<DiscoveryV1EndpointPort>;
}
