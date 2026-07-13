---
"@ngrok/webernetes": minor
---

Pass the simulation context to latency provider callbacks and expose `getCluster` for resolving the owning cluster. This changes the `LatencyProvider` callback signatures and will break existing implementations.

Update each callback to accept `ctx` as its first argument:

```ts
// Before
newLatencyProvider({
	clusterNetworkRequestLatency: (event) => event.chain.length * 10,
});

// After
newLatencyProvider({
	clusterNetworkRequestLatency: (ctx, event) => {
		const cluster = getCluster(ctx);
		return event.chain.length * 10;
	},
});
```

Callbacks that do not need cluster state should still accept the new argument, conventionally as `_ctx`.
