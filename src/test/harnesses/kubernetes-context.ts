import { Clock } from "../../clock.js";
import { withClock } from "../../clock-context.js";
import type { K8s, KubeConfig } from "../../client/types.js";
import type { ClusterApplyResource, ClusterApplyResult } from "../../cluster/apply.js";
import * as context from "../../go/context.js";
import { withLatencyProvider } from "../../latency.js";
import { MathRNG } from "../../rng.js";
import { newTestRng } from "../rng.js";
import { withRng } from "../../rng-context.js";
import { createKubernetesHelpers } from "./helpers.js";
import type { KubernetesTestContext, KubernetesTestTarget, FetchNodePort } from "./kubernetes.js";

export interface KubernetesRuntimeContext extends KubernetesTestContext {
	initialize(): Promise<void>;
	disposeTest(): Promise<void>;
	dispose(): Promise<void>;
}

export function createKubernetesRuntimeContext({
	k8s,
	kubeConfig,
	target,
	fetchNodePort,
	apply,
}: {
	k8s: K8s;
	kubeConfig: KubeConfig;
	target: KubernetesTestTarget;
	fetchNodePort: FetchNodePort;
	apply<const T extends readonly ClusterApplyResource[]>(
		resources: T,
	): Promise<ClusterApplyResult<T>>;
}): KubernetesRuntimeContext {
	const rng = target === "simulator" ? newTestRng() : new MathRNG();
	const ctx = withLatencyProvider(withRng(withClock(context.background(), new Clock()), rng));
	const apps = lazyApiClient(() => kubeConfig.makeApiClient(k8s.AppsV1Api));
	const core = lazyApiClient(() => kubeConfig.makeApiClient(k8s.CoreV1Api));
	const discovery = lazyApiClient(() => kubeConfig.makeApiClient(k8s.DiscoveryV1Api));
	const helpers = createKubernetesHelpers({
		ctx,
		k8s,
		kubeConfig,
		core,
		target,
		fetchNodePort,
		apply,
	});

	const runtimeContext: KubernetesRuntimeContext = {
		ctx,
		k8s,
		kubeConfig,
		target,
		apps,
		core,
		discovery,
		helpers,
		async initialize() {},
		async disposeTest() {
			await helpers.disposeTest();
		},
		async dispose() {
			await helpers.dispose();
		},
	};

	return runtimeContext;
}

function lazyApiClient<T extends object>(factory: () => T): T {
	let target: T | undefined;
	return new Proxy({} as T, {
		get(_object, property, receiver) {
			target ??= factory();
			const value = Reflect.get(target, property, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}
