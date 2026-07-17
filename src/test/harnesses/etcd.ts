import { browser, currentTestEnvironment, node } from "../describe.js";
import type { SuiteOptions } from "../describe.js";
import type { Etcd3 } from "etcd3";

import type { Etcd } from "../../cluster/etcd.js";
import type * as context from "../../go/context.js";

export type EtcdTestTarget = "fake" | "real";

export interface EtcdTestContext {
	ctx: context.Context;
	target: EtcdTestTarget;
	name: string;
	createEtcd: () => Promise<Etcd | Etcd3>;
}

export type EtcdSuiteFactory = (context: EtcdTestContext) => void;

interface EtcdDescribe {
	describe: EtcdDescribeFn;
}

interface EtcdDescribeFn {
	(name: string, factory: EtcdSuiteFactory): void;
	(name: string, options: SuiteOptions, factory: EtcdSuiteFactory): void;
}

interface EtcdRuntime {
	defineSuite(name: string, factory: EtcdSuiteFactory): void;
	defineSuite(name: string, options: SuiteOptions, factory: EtcdSuiteFactory): void;
}

const realRuntime = currentTestEnvironment === "node" ? await import("./etcd-real.js") : undefined;

const fakeRuntime = await import("./etcd-fake.js");

export const realEtcd: EtcdDescribe = {
	describe: createTargetDescribe("real", realRuntime),
};

export const fakeEtcd: EtcdDescribe = {
	describe: createTargetDescribe("fake", fakeRuntime),
};

export const etcd: EtcdDescribe = {
	describe(name: string, ...args: [EtcdSuiteFactory] | [SuiteOptions, EtcdSuiteFactory]) {
		defineTargetSuite(realEtcd, name, args);
		defineTargetSuite(fakeEtcd, name, args);
	},
};

function createTargetDescribe(
	target: EtcdTestTarget,
	runtime: EtcdRuntime | undefined,
): EtcdDescribeFn {
	return (name: string, ...args: [EtcdSuiteFactory] | [SuiteOptions, EtcdSuiteFactory]) => {
		const [maybeOptions, maybeFactory] = args;
		const factory = typeof maybeOptions === "function" ? maybeOptions : maybeFactory;
		if (!factory) {
			throw new Error(`Missing etcd suite callback for ${name}`);
		}

		if (runtime) {
			if (typeof maybeOptions === "function") {
				runtime.defineSuite(name, factory);
				return;
			}
			runtime.defineSuite(name, maybeOptions, factory);
			return;
		}

		const environmentDescribe = target === "real" ? node.describe : browser.describe;
		if (typeof maybeOptions === "function") {
			environmentDescribe(name, () => undefined);
			return;
		}
		environmentDescribe(name, maybeOptions, () => undefined);
	};
}

function defineTargetSuite(
	target: EtcdDescribe,
	name: string,
	args: [EtcdSuiteFactory] | [SuiteOptions, EtcdSuiteFactory],
): void {
	const [maybeOptions, maybeFactory] = args;
	if (typeof maybeOptions === "function") {
		target.describe(name, maybeOptions);
		return;
	}
	if (!maybeFactory) {
		throw new Error(`Missing etcd suite callback for ${name}`);
	}
	target.describe(name, maybeOptions, maybeFactory);
}
