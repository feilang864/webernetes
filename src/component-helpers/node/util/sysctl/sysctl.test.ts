/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { expect, it } from "vitest";
import { both } from "../../../../test/describe.js";
import { normalizeName } from "./sysctl.js";

// Models staging/src/k8s.io/component-helpers/node/util/sysctl/sysctl_test.go TestConvertSysctlVariableToDotsSeparator.
both.describe("TestConvertSysctlVariableToDotsSeparator", () => {
	type TestCase = {
		in: string;
		out: string;
	};
	const valid: TestCase[] = [
		{ in: "kernel.shm_rmid_forced", out: "kernel.shm_rmid_forced" },
		{ in: "kernel/shm_rmid_forced", out: "kernel.shm_rmid_forced" },
		{ in: "net.ipv4.conf.eno2/100.rp_filter", out: "net.ipv4.conf.eno2/100.rp_filter" },
		{ in: "net/ipv4/conf/eno2.100/rp_filter", out: "net.ipv4.conf.eno2/100.rp_filter" },
		{ in: "net/ipv4/ip_local_port_range", out: "net.ipv4.ip_local_port_range" },
		{ in: "kernel/msgmax", out: "kernel.msgmax" },
		{ in: "kernel/sem", out: "kernel.sem" },
	];

	for (const test of valid) {
		it(test.in, () => {
			const convertSysctlVal = normalizeName(test.in);
			expect(convertSysctlVal).toEqual(test.out);
		});
	}
});
