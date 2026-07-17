/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { V1ConfigMapEnvSource } from "./V1ConfigMapEnvSource.js";
import { V1SecretEnvSource } from "./V1SecretEnvSource.js";
export interface V1EnvFromSource {
	configMapRef?: V1ConfigMapEnvSource;
	prefix?: string;
	secretRef?: V1SecretEnvSource;
}
