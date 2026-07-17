import { both } from "../describe.js";
import type { SuiteOptions } from "../describe.js";
import { Etcd } from "../../cluster/etcd.js";
import type { EtcdSuiteFactory, EtcdTestContext } from "./etcd.js";

const testContext: Omit<EtcdTestContext, "ctx" | "createEtcd"> = {
	target: "fake",
	name: "fake etcd",
};

export function defineSuite(name: string, factory: EtcdSuiteFactory): void;
export function defineSuite(name: string, options: SuiteOptions, factory: EtcdSuiteFactory): void;
export function defineSuite(
	name: string,
	maybeOptions: SuiteOptions | EtcdSuiteFactory,
	maybeFactory?: EtcdSuiteFactory,
): void {
	const factory = typeof maybeOptions === "function" ? maybeOptions : maybeFactory;
	if (!factory) {
		throw new Error(`Missing fake etcd suite callback for ${name}`);
	}

	const suite = ({ ctx }: Pick<EtcdTestContext, "ctx">) => {
		factory({
			...testContext,
			ctx,
			async createEtcd() {
				return new Etcd(ctx);
			},
		});
	};

	if (typeof maybeOptions === "function") {
		both.describe(name, suite);
		return;
	}
	both.describe(name, maybeOptions, suite);
}
