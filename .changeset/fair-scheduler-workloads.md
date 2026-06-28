---
"@ngrok/webernetes": patch
---

Temporarily schedule new workload Pods onto the node with the fewest active non-system Pods, ignoring kube-system control-plane components until the simulator has a proper scheduler implementation.
