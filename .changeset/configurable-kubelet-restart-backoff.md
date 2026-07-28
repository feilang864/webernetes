---
"@ngrok/webernetes": patch
---

Expose kubelet configuration through `ClusterOptions.kubeletConfiguration`.
Configure `crashLoopBackOff.maxContainerRestartPeriodMs` to control the maximum
container restart delay. Webernetes additionally accepts `0` to restart
crashing containers immediately, without entering CrashLoopBackOff or publishing
a crash-loop retry annotation. This differs from real Kubernetes, which allows
a minimum delay of 1 second.
