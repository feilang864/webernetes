---
"@ngrok/webernetes": patch
---

Match kubelet probe behavior when `ChangeContainerStatusOnKubeletRestart` is disabled. Preserve probe results only for containers that predate the kubelet start, while replacement containers receive the normal initial readiness, liveness, and startup probe states.
