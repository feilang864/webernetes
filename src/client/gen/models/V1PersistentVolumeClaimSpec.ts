/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { V1LabelSelector } from "./V1LabelSelector.js";
import { V1TypedLocalObjectReference } from "./V1TypedLocalObjectReference.js";
import { V1TypedObjectReference } from "./V1TypedObjectReference.js";
import { V1VolumeResourceRequirements } from "./V1VolumeResourceRequirements.js";
export interface V1PersistentVolumeClaimSpec {
	accessModes?: Array<string>;
	dataSource?: V1TypedLocalObjectReference;
	dataSourceRef?: V1TypedObjectReference;
	resources?: V1VolumeResourceRequirements;
	selector?: V1LabelSelector;
	storageClassName?: string;
	volumeAttributesClassName?: string;
	volumeMode?: string;
	volumeName?: string;
}
