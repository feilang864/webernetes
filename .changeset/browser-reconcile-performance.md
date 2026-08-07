---
"@ngrok/webernetes": patch
---

Cut simulator CPU cost and stop a rollout from blocking the browser main thread.

Controller workers now yield to the cluster clock once a slice of work exceeds 8ms. The upstream Go
loop relies on goroutine preemption, which the browser does not have, so a rollout used to reconcile
inside a single task and drop frames.

etcd now stores the object a `json` put is given, next to the bytes. `PutBuilder.json` keeps a deep
copy of the object, and `GetBuilder.json` and the storage layer read that copy instead of decoding
bytes and running `JSON.parse` with a reviver. The bytes are built lazily, so a caller that reads
`value` still gets the same result. Measured in WebKit, the read path is 23.5x faster and the write
path is 19.0x faster.

The thread-safe store and the FIFO queue no longer copy on read or write. Upstream `threadSafeMap`
and `FIFO` hold pointers, so the copies were both a deviation and the largest cost in every informer
and lister read.

Deep copies now use a resource-shaped `deepClone` instead of `structuredClone`, which measured
12.4-13.0x faster in WebKit. `equalIgnoreHash` compares templates without copying them at all.
