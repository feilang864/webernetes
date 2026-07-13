# @ngrok/webernetes

## 0.2.1

### Patch Changes

- [`85ab76c`](https://github.com/ngrok/webernetes/commit/85ab76c9cb2cd1140f6159d0f9795f1bc5873b17) Thanks [@samwho](https://github.com/samwho)! - Expose the `Context` type.

## 0.2.0

### Minor Changes

- [#22](https://github.com/ngrok/webernetes/pull/22) [`4e8682d`](https://github.com/ngrok/webernetes/commit/4e8682ddc200bf108a1cf2d7150f95d859f744e1) Thanks [@samwho](https://github.com/samwho)! - Pass the simulation context to latency provider callbacks and expose `getCluster` for resolving the owning cluster. This changes the `LatencyProvider` callback signatures and will break existing implementations.

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

## 0.1.6

### Patch Changes

- [`e446c95`](https://github.com/ngrok/webernetes/commit/e446c95908f24c09b74e40db9d5c5526cff17082) Thanks [@samwho](https://github.com/samwho)! - Assign each simulated cluster a unique, read-only ID within the current page.

## 0.1.5

### Patch Changes

- [`56791d2`](https://github.com/ngrok/webernetes/commit/56791d281e9b62e99d730e3842fc1686c49c9080) Thanks [@samwho](https://github.com/samwho)! - Allow clusters to be created with a configurable number of initial nodes while keeping the default cluster size at three nodes.

## 0.1.4

### Patch Changes

- [`49733e2`](https://github.com/ngrok/webernetes/commit/49733e2b6cc2fba1424ed5024b3f58d8e30e7cc8) Thanks [@samwho](https://github.com/samwho)! - Keep temporary workload scheduling balanced during bursts by serializing node selection with in-flight reservations, and ignore terminating Pods when counting node workload.

## 0.1.3

### Patch Changes

- [`c355517`](https://github.com/ngrok/webernetes/commit/c355517ef5baf65eb6673a3792ec7b275789119d) Thanks [@samwho](https://github.com/samwho)! - Temporarily schedule new workload Pods onto the node with the fewest active non-system Pods, ignoring kube-system control-plane components until the simulator has a proper scheduler implementation.

## 0.1.2

### Patch Changes

- [`b03b8d2`](https://github.com/ngrok/webernetes/commit/b03b8d26e832fbb7b6e60c9e3d1b3c66c061896a) Thanks [@samwho](https://github.com/samwho)! - Preserve service targets when re-registering an existing Service so endpoint reconciliation cannot briefly or permanently leave routable Services without ready targets.

## 0.1.1

### Patch Changes

- [`607b4e7`](https://github.com/ngrok/webernetes/commit/607b4e77b7349689031dc50bb6953b1eb0b11a9a) Thanks [@samwho](https://github.com/samwho)! - Publish the built `dist` artifacts so package exports resolve correctly for consumers.
