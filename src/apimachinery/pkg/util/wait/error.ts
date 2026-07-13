/*!
 * SPDX-License-Identifier: Apache-2.0
 * Derived from Kubernetes, translated and modified for Webernetes.
 */

// Models staging/src/k8s.io/apimachinery/pkg/util/wait/error.go ErrWaitTimeout.
export const errWaitTimeout = new Error("timed out waiting for the condition");
