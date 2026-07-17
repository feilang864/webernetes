/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { V1ConfigMapKeySelector } from "./V1ConfigMapKeySelector.js";
import { V1FileKeySelector } from "./V1FileKeySelector.js";
import { V1ObjectFieldSelector } from "./V1ObjectFieldSelector.js";
import { V1ResourceFieldSelector } from "./V1ResourceFieldSelector.js";
import { V1SecretKeySelector } from "./V1SecretKeySelector.js";
export interface V1EnvVarSource {
	configMapKeyRef?: V1ConfigMapKeySelector;
	fileKeyRef?: V1FileKeySelector;
	fieldRef?: V1ObjectFieldSelector;
	resourceFieldRef?: V1ResourceFieldSelector;
	secretKeyRef?: V1SecretKeySelector;
}
