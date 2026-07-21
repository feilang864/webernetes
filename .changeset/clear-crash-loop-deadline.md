---
"@ngrok/webernetes": patch
---

Publish the Webernetes-specific `webernetes.ngrok.com/crash-loop-backoff` Pod annotation while regular containers are held in CrashLoopBackOff. Its JSON value maps each backing-off container name to its scheduled RFC3339 restart time, and is cleared as soon as no container remains in crash-loop backoff. For example:

```yaml
metadata:
  annotations:
    webernetes.ngrok.com/crash-loop-backoff: >-
      {"api":"2026-07-21T10:20:30.000Z","worker":"2026-07-21T10:20:45.000Z"}
```
