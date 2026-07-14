---
"@ngrok/webernetes": patch
---

Model network event errors after the corresponding Node.js network failures. Request events for
targets unavailable before dispatch carry Node-style connection-refused errors, for example
`Error("connect ECONNREFUSED <service-ip>:80")` with code `ECONNREFUSED` when a Service has no
ready targets, or `Error("connect ECONNREFUSED <pod-ip>:8080")` when a selected pod has not
bound its target port. Those failures have no response event.

For example, a request event for an unavailable Service target has this shape:

```ts
{
  error: Object.assign(new Error("connect ECONNREFUSED 10.96.0.10:80"), {
    address: "10.96.0.10",
    code: "ECONNREFUSED",
    errno: -61,
    port: 80,
    syscall: "connect",
  }),
}
```

The corresponding `fetch()` rejection wraps the same Node-style cause:

```ts
new TypeError("fetch failed", {
	cause: Object.assign(new Error("connect ECONNREFUSED 10.96.0.10:80"), {
		address: "10.96.0.10",
		code: "ECONNREFUSED",
		errno: -61,
		port: 80,
		syscall: "connect",
	}),
});
```

Model pod removal during an in-flight HTTP request as Node's `SocketError` with code
`UND_ERR_SOCKET` and message `other side closed`. Because the request was already dispatched,
that failure is attached to the response event rather than the request event:

```ts
{
  error: Object.assign(new Error("other side closed"), {
    name: "SocketError",
    code: "UND_ERR_SOCKET",
  }),
}
```
