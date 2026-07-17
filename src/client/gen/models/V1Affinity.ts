/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { V1NodeAffinity } from "./V1NodeAffinity.js";
import { V1PodAffinity } from "./V1PodAffinity.js";
import { V1PodAntiAffinity } from "./V1PodAntiAffinity.js";
export interface V1Affinity {
	nodeAffinity?: V1NodeAffinity;
	podAffinity?: V1PodAffinity;
	podAntiAffinity?: V1PodAntiAffinity;
}
