import { expect } from "vitest";
import type { KubernetesObject } from "../types";

const recentTimestampToleranceMs = 1000;

export function expectRecentCreationTimestamp(resource: KubernetesObject): void {
	const creationTimestamp = resource.metadata?.creationTimestamp;
	const now = Date.now();

	expect(creationTimestamp).toBeInstanceOf(Date);
	expect(creationTimestamp?.getTime()).toBeGreaterThanOrEqual(now - recentTimestampToleranceMs);
	expect(creationTimestamp?.getTime()).toBeLessThanOrEqual(now + recentTimestampToleranceMs);
}

export function expectResourceUid(resource: KubernetesObject): void {
	const uid = resource.metadata?.uid;

	expect(uid).toEqual(expect.any(String));
	expect(uid?.length).toBeGreaterThan(0);
}
