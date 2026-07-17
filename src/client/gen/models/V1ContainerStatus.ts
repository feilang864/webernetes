/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { deepMerge } from "../../../deep-merge.js";
import type { DeepPartial } from "../../../utility-types.js";
import { V1ContainerState } from "./V1ContainerState.js";
import { V1ContainerUser } from "./V1ContainerUser.js";
import { V1ResourceRequirements } from "./V1ResourceRequirements.js";
import { V1ResourceStatus } from "./V1ResourceStatus.js";
import { V1VolumeMountStatus } from "./V1VolumeMountStatus.js";
export interface V1ContainerStatus {
	allocatedResources?: {
		[key: string]: string;
	};
	allocatedResourcesStatus?: Array<V1ResourceStatus>;
	containerID?: string;
	image: string;
	imageID: string;
	// This is called LastTerminationState in the Kubernetes type, but the JSON is
	// lastState. The types for the JS SDK dictate this needs to match the JSON
	// field name.
	lastState?: V1ContainerState;
	name: string;
	ready: boolean;
	resources?: V1ResourceRequirements;
	restartCount: number;
	started?: boolean;
	state?: V1ContainerState;
	stopSignal?: string;
	user?: V1ContainerUser;
	volumeMounts?: Array<V1VolumeMountStatus>;
}

export function newContainerStatus(status: DeepPartial<V1ContainerStatus> = {}): V1ContainerStatus {
	return deepMerge<V1ContainerStatus>(
		{
			name: "",
			image: "",
			imageID: "",
			ready: false,
			restartCount: 0,
		},
		status,
	);
}
