---
"@ngrok/webernetes": minor
---

Change simulated HTTP connection establishment to occur when a request reaches
its already-selected destination, after configured request latency, rather than
when `ClusterNetwork.fetch()` sends the request. This is a public behavioral
change for users of `ClusterNetwork` and its `"request"` / `"response"` events.

Previously, Webernetes checked whether the destination HTTP listener was bound
immediately after route selection. A request sent at simulated time `T0` to an
unbound endpoint therefore failed with `ECONNREFUSED` immediately, even when a
non-zero request latency meant that the request would not reach the endpoint
until a later simulated time. The emitted request event carried the refusal and
there was no corresponding response event.

For example, with 100 ms of request latency, this sequence previously failed:

```text
T0:   send HTTP request; destination has no listener
T0:   request event contains ECONNREFUSED
T50:  destination binds its HTTP listener
T100: fetch rejects with ECONNREFUSED
```

Now the request event means that the request departed and is in transit. After
request latency elapses, Webernetes looks up the listener and dispatches the
request. The same sequence now succeeds:

```text
T0:   send HTTP request; request event has no error
T50:  destination binds its HTTP listener
T100: request arrives; handler is invoked and a successful response event is emitted
T100 + response latency: fetch resolves
```

The inverse is also now modeled accurately. If a listener exists when the
request is sent but closes before the request arrives, the request is refused
at arrival time. The request event still has no error, and the response event
contains the Node-style `ECONNREFUSED` cause:

```text
T0:   send HTTP request; listener is bound; request event has no error
T50:  listener closes
T100: request arrives; response event contains ECONNREFUSED; fetch rejects
```

This changes the event lifecycle for listener failures from a request-only
failure to `request event -> request latency -> errored response event ->
response latency`. Existing public `fetch()` rejection mapping remains the
same: a refused connection still rejects with `TypeError("fetch failed")` whose
cause identifies `ECONNREFUSED`. With zero request latency, listener-present
and listener-absent requests retain their immediate success/failure behavior;
no extra scheduling turn is introduced.

Route selection is intentionally unchanged. Service endpoint selection and
other routing decisions still occur before request latency; only availability
of the already-selected destination HTTP listener is evaluated at arrival.
