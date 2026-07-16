---
"@ngrok/webernetes": patch
---

Match Kubernetes event timestamp behavior by using `eventTime` for scheduler events with null legacy timestamps and preserving event timestamps as `Date` values through storage reads.
