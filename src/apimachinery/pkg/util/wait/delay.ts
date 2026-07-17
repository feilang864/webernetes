/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import * as context from "../../../../go/context.js";
import type { MaybePromise } from "../../../../promise.js";
import { loopConditionUntilContext } from "./loop.js";
import { realTimer, type Timer, VariableTimer } from "./timer.js";

export type ConditionWithContextFunc = (
	ctx: context.Context,
) => MaybePromise<[done: boolean, err: Error | undefined]>;

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/delay.go DelayFunc.
export class DelayFunc {
	constructor(
		private readonly ctx: context.Context,
		private readonly fn: () => number,
	) {}

	next(): number {
		return this.fn();
	}

	// Models staging/src/k8s.io/apimachinery/pkg/util/wait/delay.go DelayFunc.Timer.
	timer(): Timer {
		return new VariableTimer(this, realTimer(this.ctx));
	}

	// Models staging/src/k8s.io/apimachinery/pkg/util/wait/delay.go DelayFunc.Until.
	async until(
		ctx: context.Context,
		immediate: boolean,
		sliding: boolean,
		condition: ConditionWithContextFunc,
	): Promise<Error | undefined> {
		return await loopConditionUntilContext(ctx, this.timer(), immediate, sliding, condition);
	}

	// Models staging/src/k8s.io/apimachinery/pkg/util/wait/delay.go DelayFunc.Concurrent.
	concurrent(): DelayFunc {
		return new DelayFunc(this.ctx, () => this.next());
	}
}
