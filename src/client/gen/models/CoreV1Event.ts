/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */
import { CoreV1EventSeries } from "./CoreV1EventSeries.js";
import { V1EventSource } from "./V1EventSource.js";
import type { V1MicroTime } from "../../types.js";
import { V1ObjectMeta } from "./V1ObjectMeta.js";
import { V1ObjectReference } from "./V1ObjectReference.js";

export interface CoreV1Event {
	action?: string;
	apiVersion?: string;
	count?: number;
	eventTime?: V1MicroTime;
	firstTimestamp?: Date;
	involvedObject: V1ObjectReference;
	kind?: string;
	lastTimestamp?: Date;
	message?: string;
	metadata: V1ObjectMeta;
	reason?: string;
	related?: V1ObjectReference;
	reportingComponent?: string;
	reportingInstance?: string;
	series?: CoreV1EventSeries;
	source?: V1EventSource;
	type?: string;
}
