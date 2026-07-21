---
"@ngrok/webernetes": patch
---

Fix crash-loop retry-deadline annotation publishing so `webernetes.ngrok.com/crash-loop-backoff` is present while a regular container is in `CrashLoopBackOff`. The annotation now uses the runtime's precise retry deadline and is removed when the container restarts.
