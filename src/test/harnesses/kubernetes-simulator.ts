import { afterAll, afterEach, beforeAll } from "vitest";

import { both } from "../describe.js";
import type { SuiteOptions } from "../describe.js";
import { Cluster } from "../../cluster/index.js";
import * as http from "../../cluster/cni/http.js";
import * as fakeK8s from "../../client/index.js";
import { createKubernetesRuntimeContext } from "./kubernetes-context.js";
import { testSeed } from "../rng.js";
import type { KubernetesSuiteFactory, NodePortRequest, NodePortResponse } from "./kubernetes.js";
import type { K8s } from "../../client/types.js";

const cluster = new Cluster({ seed: testSeed() });
let setupPromise: Promise<void> | undefined;

const k8s: K8s = fakeK8s;

afterAll(async () => {
	await cluster.close();
});

export function defineSuite(name: string, factory: KubernetesSuiteFactory): void;
export function defineSuite(
	name: string,
	options: SuiteOptions,
	factory: KubernetesSuiteFactory,
): void;
export function defineSuite(
	name: string,
	maybeOptions: SuiteOptions | KubernetesSuiteFactory,
	maybeFactory?: KubernetesSuiteFactory,
): void {
	const factory = typeof maybeOptions === "function" ? maybeOptions : maybeFactory;
	if (!factory) {
		throw new Error(`Missing simulator suite callback for ${name}`);
	}

	const suite = () => {
		const context = createKubernetesRuntimeContext({
			k8s,
			kubeConfig: cluster.kubeConfig,
			target: "simulator",
			fetchNodePort,
			apply: async (resources) => await cluster.apply(resources),
		});
		context.helpers.advanceTime = async (ms: number): Promise<void> => {
			cluster.clock.step(ms);
		};

		beforeAll(async () => {
			await setupSimulator();
			await context.initialize();
		});
		afterAll(async () => {
			await context.dispose();
		});
		afterEach(async () => {
			await context.disposeTest();
		});
		factory(context);
	};

	if (typeof maybeOptions === "function") {
		both.describe(`${name} (simulator)`, suite);
		return;
	}
	both.describe(`${name} (simulator)`, maybeOptions, suite);
}

async function setupSimulator(): Promise<void> {
	setupPromise ??= (async () => {
		await cluster.init();
	})();
	await setupPromise;
}

async function fetchNodePort(
	nodePort: number,
	request?: NodePortRequest,
): Promise<NodePortResponse> {
	const path = request?.path ?? "/";
	const pathname = path.startsWith("/") ? path : `/${path}`;
	const url = new URL(`http://node-1:${nodePort}${pathname}`);
	const response = await cluster.fetch(url.toString(), toHTTPRequest(request));
	return {
		status: response.status,
		body: response.body,
		headers: toNodePortHeaders(response.header),
	};
}

function toHTTPRequest(request?: NodePortRequest): http.FetchInit {
	return {
		method: request?.method ?? "GET",
		headers: request?.headers,
		body: request?.body,
	};
}

function toNodePortHeaders(header: http.Header | undefined): Record<string, string> | undefined {
	if (!header) {
		return undefined;
	}
	return Object.fromEntries(
		Object.entries(header).map(([name, values]) => [name, values.join(", ")]),
	);
}
