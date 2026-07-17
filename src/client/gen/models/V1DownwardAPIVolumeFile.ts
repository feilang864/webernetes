/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { V1ObjectFieldSelector } from "./V1ObjectFieldSelector.js";
import { V1ResourceFieldSelector } from "./V1ResourceFieldSelector.js";
export interface V1DownwardAPIVolumeFile {
	fieldRef?: V1ObjectFieldSelector;
	mode?: number;
	path: string;
	resourceFieldRef?: V1ResourceFieldSelector;
}
