import { Cluster } from "./cluster.js";
import type { ClusterNetwork } from "./cni/index.js";
import {
	InProcessRuntimeService,
	type DnsConfig,
	type ImageManagerService,
	type RuntimeDiagnostics,
	type RuntimeService,
} from "./cri/index.js";
import { EventRecorderImpl } from "./events.js";
import { Kubelet, newMainKubelet, NoopPodStartupSLIObserver } from "./kubelet/index.js";
import type { Runtime as KubeletRuntime } from "./kubelet/container/index.js";
import type { KubeletConfiguration } from "./kubelet/apis/config/index.js";
import * as context from "../go/context.js";
import type { V1Node } from "../client/index.js";

export interface ServerOptions {
	name: string;
	podCIDR: string;
	ipAddresses: string[];
	kubeletConfiguration: KubeletConfiguration;
	dnsConfig: DnsConfig;
}

export class Server {
	name: string;
	podCIDR: string;
	ipAddresses: string[];
	dnsConfig: DnsConfig;
	cluster: Cluster;
	node: V1Node;
	kubelet: Kubelet;
	runtime: InProcessRuntimeService;
	runtimeService: RuntimeService;
	imageService: ImageManagerService;
	containerRuntime!: KubeletRuntime;
	runtimeDiagnostics: RuntimeDiagnostics;
	network: ClusterNetwork;
	private ctx: context.Context | undefined;
	private cancelContext: context.CancelFunc | undefined;
	private closePromise: Promise<void> | undefined;

	public constructor(cluster: Cluster, options: ServerOptions) {
		this.name = options.name;
		this.podCIDR = options.podCIDR;
		this.ipAddresses = [...options.ipAddresses];
		this.dnsConfig = {
			servers: [...options.dnsConfig.servers],
			searches: [...options.dnsConfig.searches],
			options: [...options.dnsConfig.options],
		};
		this.cluster = cluster;
		const now = cluster.clock.now();
		this.node = {
			metadata: { name: this.name },
			spec: {
				podCIDR: this.podCIDR,
			},
			status: {
				addresses: [
					...this.ipAddresses.map((address) => ({ type: "InternalIP", address })),
					{ type: "Hostname", address: this.name },
				],
				// TODO(samwho): Implement proper node readiness reporting.
				conditions: [
					{
						type: "Ready",
						status: "True",
						reason: "KubeletReady",
						message: "kubelet is posting ready status",
						lastHeartbeatTime: now,
						lastTransitionTime: now,
					},
				],
			},
		};
		this.runtime = new InProcessRuntimeService({
			ctx: cluster.ctx,
			kubeConfig: cluster.kubeConfig,
			network: cluster.network,
			podCIDR: this.podCIDR,
			imageRegistry: cluster.imageRegistry,
			idPrefix: `${this.name}-`,
		});
		this.runtimeService = this.runtime;
		this.imageService = this.runtime;
		this.runtimeDiagnostics = this.runtime;
		this.network = cluster.network;
		this.kubelet = newMainKubelet(
			cluster.ctx,
			options.kubeletConfiguration,
			{
				kubeClient: cluster.api,
				recorder: new EventRecorderImpl({
					ctx: cluster.ctx,
					api: cluster.api.corev1,
					component: "kubelet",
					host: this.name,
				}),
				podStartupLatencyTracker: new NoopPodStartupSLIObserver(),
				remoteRuntimeService: this.runtimeService,
				remoteImageService: this.imageService,
				network: this.network,
				node: this.node,
				hostDNSConfig: this.dnsConfig,
			},
			this.name,
			this.name,
			this.ipAddresses,
		);
		this.kubelet.runtimeState.setNetworkState(undefined);
		this.containerRuntime = this.kubelet.containerRuntime;
	}

	async boot(ctx: context.Context) {
		[this.ctx, this.cancelContext] = context.withCancel(ctx);
		await this.kubelet.run();
		this.kubelet.startGarbageCollection(this.ctx);
	}

	close(): Promise<void> {
		if (!this.closePromise) {
			this.cancelContext?.();
			this.closePromise = (async () => {
				await this.kubelet.close();
				await this.runtime.close();
			})();
		}
		return this.closePromise;
	}
}
