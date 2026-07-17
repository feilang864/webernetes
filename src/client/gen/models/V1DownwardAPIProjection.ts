/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { V1DownwardAPIVolumeFile } from "./V1DownwardAPIVolumeFile.js";
export interface V1DownwardAPIProjection {
	items?: Array<V1DownwardAPIVolumeFile>;
}
