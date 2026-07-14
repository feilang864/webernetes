---
"@ngrok/webernetes": patch
---

Ensure every network request event without an initial error is followed by
exactly one correlated response event. Requests canceled during simulated
request latency now emit a response with a socket-closed error instead of
leaving event consumers waiting indefinitely.
