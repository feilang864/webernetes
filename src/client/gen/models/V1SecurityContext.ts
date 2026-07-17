/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { V1AppArmorProfile } from "./V1AppArmorProfile.js";
import { V1Capabilities } from "./V1Capabilities.js";
import { V1SELinuxOptions } from "./V1SELinuxOptions.js";
import { V1SeccompProfile } from "./V1SeccompProfile.js";
import { V1WindowsSecurityContextOptions } from "./V1WindowsSecurityContextOptions.js";
export interface V1SecurityContext {
	allowPrivilegeEscalation?: boolean;
	appArmorProfile?: V1AppArmorProfile;
	capabilities?: V1Capabilities;
	privileged?: boolean;
	procMount?: string;
	readOnlyRootFilesystem?: boolean;
	runAsGroup?: number;
	runAsNonRoot?: boolean;
	runAsUser?: number;
	seLinuxOptions?: V1SELinuxOptions;
	seccompProfile?: V1SeccompProfile;
	windowsOptions?: V1WindowsSecurityContextOptions;
}
