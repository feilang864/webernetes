/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { V1AWSElasticBlockStoreVolumeSource } from "./V1AWSElasticBlockStoreVolumeSource.js";
import { V1AzureDiskVolumeSource } from "./V1AzureDiskVolumeSource.js";
import { V1AzureFileVolumeSource } from "./V1AzureFileVolumeSource.js";
import { V1CSIVolumeSource } from "./V1CSIVolumeSource.js";
import { V1CephFSVolumeSource } from "./V1CephFSVolumeSource.js";
import { V1CinderVolumeSource } from "./V1CinderVolumeSource.js";
import { V1ConfigMapVolumeSource } from "./V1ConfigMapVolumeSource.js";
import { V1DownwardAPIVolumeSource } from "./V1DownwardAPIVolumeSource.js";
import { V1EmptyDirVolumeSource } from "./V1EmptyDirVolumeSource.js";
import { V1EphemeralVolumeSource } from "./V1EphemeralVolumeSource.js";
import { V1FCVolumeSource } from "./V1FCVolumeSource.js";
import { V1FlexVolumeSource } from "./V1FlexVolumeSource.js";
import { V1FlockerVolumeSource } from "./V1FlockerVolumeSource.js";
import { V1GCEPersistentDiskVolumeSource } from "./V1GCEPersistentDiskVolumeSource.js";
import { V1GitRepoVolumeSource } from "./V1GitRepoVolumeSource.js";
import { V1GlusterfsVolumeSource } from "./V1GlusterfsVolumeSource.js";
import { V1HostPathVolumeSource } from "./V1HostPathVolumeSource.js";
import { V1ISCSIVolumeSource } from "./V1ISCSIVolumeSource.js";
import { V1ImageVolumeSource } from "./V1ImageVolumeSource.js";
import { V1NFSVolumeSource } from "./V1NFSVolumeSource.js";
import { V1PersistentVolumeClaimVolumeSource } from "./V1PersistentVolumeClaimVolumeSource.js";
import { V1PhotonPersistentDiskVolumeSource } from "./V1PhotonPersistentDiskVolumeSource.js";
import { V1PortworxVolumeSource } from "./V1PortworxVolumeSource.js";
import { V1ProjectedVolumeSource } from "./V1ProjectedVolumeSource.js";
import { V1QuobyteVolumeSource } from "./V1QuobyteVolumeSource.js";
import { V1RBDVolumeSource } from "./V1RBDVolumeSource.js";
import { V1ScaleIOVolumeSource } from "./V1ScaleIOVolumeSource.js";
import { V1SecretVolumeSource } from "./V1SecretVolumeSource.js";
import { V1StorageOSVolumeSource } from "./V1StorageOSVolumeSource.js";
import { V1VsphereVirtualDiskVolumeSource } from "./V1VsphereVirtualDiskVolumeSource.js";
export interface V1Volume {
	awsElasticBlockStore?: V1AWSElasticBlockStoreVolumeSource;
	azureDisk?: V1AzureDiskVolumeSource;
	azureFile?: V1AzureFileVolumeSource;
	cephfs?: V1CephFSVolumeSource;
	cinder?: V1CinderVolumeSource;
	configMap?: V1ConfigMapVolumeSource;
	csi?: V1CSIVolumeSource;
	downwardAPI?: V1DownwardAPIVolumeSource;
	emptyDir?: V1EmptyDirVolumeSource;
	ephemeral?: V1EphemeralVolumeSource;
	fc?: V1FCVolumeSource;
	flexVolume?: V1FlexVolumeSource;
	flocker?: V1FlockerVolumeSource;
	gcePersistentDisk?: V1GCEPersistentDiskVolumeSource;
	gitRepo?: V1GitRepoVolumeSource;
	glusterfs?: V1GlusterfsVolumeSource;
	hostPath?: V1HostPathVolumeSource;
	image?: V1ImageVolumeSource;
	iscsi?: V1ISCSIVolumeSource;
	name: string;
	nfs?: V1NFSVolumeSource;
	persistentVolumeClaim?: V1PersistentVolumeClaimVolumeSource;
	photonPersistentDisk?: V1PhotonPersistentDiskVolumeSource;
	portworxVolume?: V1PortworxVolumeSource;
	projected?: V1ProjectedVolumeSource;
	quobyte?: V1QuobyteVolumeSource;
	rbd?: V1RBDVolumeSource;
	scaleIO?: V1ScaleIOVolumeSource;
	secret?: V1SecretVolumeSource;
	storageos?: V1StorageOSVolumeSource;
	vsphereVolume?: V1VsphereVirtualDiskVolumeSource;
}
