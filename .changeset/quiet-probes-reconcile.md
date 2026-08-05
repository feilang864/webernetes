---
"@ngrok/webernetes": patch
---

Add the `manuallyTriggerReadinessProbeOnPodReconcile` kubelet configuration option. It defaults to `true` to preserve Kubernetes behavior and can be disabled to keep pod reconciliation from triggering immediate readiness probes.
