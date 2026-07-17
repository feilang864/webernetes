---
"@ngrok/webernetes": patch
---

Preserve Kubernetes resource UIDs across full-object updates and reject attempts to change an existing UID. EndpointSlice reconciliation now retains generated slice UIDs in replace responses, lists, and watch events.
