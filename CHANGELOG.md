# @ngrok/webernetes

## 0.1.3

### Patch Changes

- [`c355517`](https://github.com/ngrok/webernetes/commit/c355517ef5baf65eb6673a3792ec7b275789119d) Thanks [@samwho](https://github.com/samwho)! - Temporarily schedule new workload Pods onto the node with the fewest active non-system Pods, ignoring kube-system control-plane components until the simulator has a proper scheduler implementation.

## 0.1.2

### Patch Changes

- [`b03b8d2`](https://github.com/ngrok/webernetes/commit/b03b8d26e832fbb7b6e60c9e3d1b3c66c061896a) Thanks [@samwho](https://github.com/samwho)! - Preserve service targets when re-registering an existing Service so endpoint reconciliation cannot briefly or permanently leave routable Services without ready targets.

## 0.1.1

### Patch Changes

- [`607b4e7`](https://github.com/ngrok/webernetes/commit/607b4e77b7349689031dc50bb6953b1eb0b11a9a) Thanks [@samwho](https://github.com/samwho)! - Publish the built `dist` artifacts so package exports resolve correctly for consumers.
