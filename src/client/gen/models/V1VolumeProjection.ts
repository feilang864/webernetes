/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { V1ClusterTrustBundleProjection } from "./V1ClusterTrustBundleProjection.js";
import { V1ConfigMapProjection } from "./V1ConfigMapProjection.js";
import { V1DownwardAPIProjection } from "./V1DownwardAPIProjection.js";
import { V1PodCertificateProjection } from "./V1PodCertificateProjection.js";
import { V1SecretProjection } from "./V1SecretProjection.js";
import { V1ServiceAccountTokenProjection } from "./V1ServiceAccountTokenProjection.js";
export interface V1VolumeProjection {
	clusterTrustBundle?: V1ClusterTrustBundleProjection;
	configMap?: V1ConfigMapProjection;
	downwardAPI?: V1DownwardAPIProjection;
	podCertificate?: V1PodCertificateProjection;
	secret?: V1SecretProjection;
	serviceAccountToken?: V1ServiceAccountTokenProjection;
}
