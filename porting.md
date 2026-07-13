# Porting Kubernetes Go To TypeScript

Read this before porting, mirroring, transliterating, auditing, or comparing
Kubernetes Go code. Ported code is reviewed side by side with upstream. A
reviewer must be able to follow both files line by line without reconstructing
a new local design.

## Source, Scope, And Mapping

- Kubernetes 1.36 at `ecf6decece6a6de25a57aad9ba90b6ce580f6f78` is the
  specification. The checkout is `~/Developer/github.com/kubernetes/kubernetes`.
- Read the upstream declaration, nearby helpers and callers, and its tests.
  Port the relevant unit, not only the branch that fixes a local symptom.
- Keep local placement consistent with the established subsystem layout. `src/`
  commonly mirrors Kubernetes `pkg/`; cluster code may belong under
  `src/cluster/`. The `// Models` comment is the authoritative upstream path.
- Add `// Models <upstream path> <name>` before every mirrored declaration,
  test, helper, and table. This includes vendored/forked Go. Do not copy
  upstream prose comments.
- For `src/go` standard-library compatibility primitives, use the established
  exact Go package/source or documentation citation when a Kubernetes-path
  `// Models` breadcrumb is not applicable.
- Generated `src/client/gen/` SDK compatibility is not a direct Go port. Follow
  its child `AGENTS.md` files and the installed client-node declarations instead.

## Reviewability Is The Constraint

- Preserve declaration order, control flow, local names, statement order,
  helper boundaries, literals, table fields, case names, and assertions.
- Do not improve names, merge branches, extract a helper, replace a fixture, or
  substitute a Promise-based design. Keep names such as `w`, `ch`, `fp`, `f`,
  and `errc` where TypeScript permits.
- Differ only for a real TypeScript or repository constraint and document that
  constraint beside the differing declaration. Equivalent but differently
  structured code is not an acceptable port.
- Preserve channel closure, cancellation, cleanup, error identity, copy/alias
  behavior, and whether work happens before, after, or during a tick.

## Go Compatibility Layer

Use these local primitives. Do not hand-roll equivalents with global timers,
`Promise.race`, arrays, flags, or unstructured callbacks. A narrow exception
must have a mapped local reason when no channel-backed equivalent exists.

### Channels And Select

Import from `src/go/channel.ts`.

```ts
const ch = new Channel<Value>(); // make(chan Value)
const buffered = new Channel<Value>(1); // make(chan Value, 1)

await ch.send(value); // ch <- value: blocking
ch.trySend(value); // non-blocking send
const result = await ch.receive(); // value, open := <-ch
const ready = ch.tryReceive(); // non-blocking comma-ok receive
ch.close(); // close(ch)
```

- Use `ReadOnlyChannel<T>`/`WriteOnlyChannel<T>` for `<-chan T`/`chan<- T`.
- `tryReceive()` returns `undefined` when not ready and `{ ok: false }` after
  closure. Translate `for value := range ch` to `for await (const value of ch)`
  after preserving producer completion and close order.
- Translate nil Go channels to `undefined`. Keep their case in `select`; the
  helper disables it, matching Go. Do not conditionally rebuild the select.
- Preserve capacity and send behavior exactly. Capacity `1` is significant for
  timer/ticker buffering and dropped ticks.
- Translate every Go `select` with `select()`, preserving receive, send, and
  default cases in source order. Use `.case(...)` or `.receive(...)` for a
  receive, and `select().send(ch, value, handler)` for a send.

```ts
const selected = await select()
	.case(ch, (result) => ({ type: "value" as const, open: result.ok, value: result.value }))
	.case(ctx.done(), () => ({ type: "done" as const }))
	.default(() => ({ type: "default" as const }));
```

- Call `.default(...)` only for a Go `default` case. Without it, awaiting the
  builder blocks. Translate `case <-time.After(d)` with `time.after(ctx, d)`.
- Do not flatten a Go `select` into `receive()`, `send()`, `Promise.race`, or a
  conditional. Conversely, use a direct `await ch.receive()` when upstream has
  a direct receive rather than a select.

### Context, Clock, And Time

Import `* as context` from `src/go/context.ts` and `* as time` from
`src/go/time.ts`.

```ts
const [ctx, cancel] = context.withCancel(parent);
try {
	const timer = new time.Timer(ctx, delayMs);
	const ticker = new time.Ticker(ctx, intervalMs);
	const timeout = time.after(ctx, timeoutMs);
	// timer.C and ticker.C are receive channels
} finally {
	cancel();
}
```

- Put `ctx` first in a translated function/constructor and name it `ctx`.
  Translate `ctx.Done()`/`ctx.Err()` to `ctx.done()`/`ctx.err()`.
- Use `withCancel`, `withCancelCause`, `withTimeout`, and `withValue` rather
  than custom cancellation state.
- Durations are `number` milliseconds and Go `time.Time` is `Date`. Read time
  from `getClock(ctx).now()`/`nowMs()` or an injected local Clock, never
  `Date.now()` or `new Date()` in simulator code.
- `after` sends once without closing. Stopping a `Timer` or `Ticker` does not
  close `C`; preserve stop/reset and pending-tick behavior. Use `time.tick` only
  for Go `time.Tick`, and `new time.Ticker` when upstream holds/stops/resets it.

### Sync And Goroutines

Use `src/go/sync/`: `WaitGroup`, `Mutex`, `RWMutex`, `Once`, and `Cond`.

- Call `wg.add` before launching a worker, put `wg.done()` in its `finally`, and
  `await wg.wait()` before closing/draining results.
- Translate `Lock(); defer Unlock()` visibly as
  `await lock.lock(); try { ... } finally { lock.unlock(); }`. Use `withLock`
  only when it keeps the upstream critical section equally obvious.
- Enter `Cond.wait()` with its lock held. Keep Go's predicate `for` loop, not
  an `if`; `wait()` releases and reacquires the lock.
- Translate `go func() { ... }()` to `void (async () => { ... })()` and preserve
  body order, cleanup, channels, and error observation. Retain a Promise only
  for simulator teardown/joining, with a local simulator-only explanation.
- For a goroutine that must enter the deterministic scheduler, use the context
  Clock's `queueMicrotask`, not the global microtask API.

## Values, Collections, Types, And Errors

- Translate `map[K]V` to `Map<K, V>` and `map[T]struct{}` to `Set<T>`. Use
  `Record<string, V>` only for an established JSON-shaped string map. Use
  `.has()` with `.get()` for `value, ok := map[key]`; do not use truthiness or
  `??` when presence differs from a stored zero/undefined value.
- Go map order is unspecified. Preserve upstream sorting, or use `SortedMap`/
  an explicit comparator when range order is semantic. Do not rely on JS Map
  insertion order. Use a canonical key for Go value-keyed structs; JS object
  identity is appropriate only for Go pointer-keyed maps.
- Represent pointers/nil as `T | undefined`. Preserve nil versus empty maps,
  slices, and pointers; use `??`, not `||`, so `0`, `false`, and `""` survive.
  Allocate optional nested objects with `??=` only at the matching Go
  nil-check-and-allocate statement.
- JavaScript objects alias where Go structs often copy. Preserve the exact copy
  boundary: `{ ...value }` for a shallow value copy and `structuredClone` only
  for a mapped deep copy/ownership boundary. Audit Go range loops over structs:
  TypeScript loop values alias objects.
- Translate data-only structs to interfaces; use a class for methods, identity,
  or mutation semantics. Translate interface assertions with a narrow type
  guard/`instanceof`, not an unchecked `as` cast. Preserve Go value-return
  behavior with fresh instances where needed.
- Keep sync-or-async callback boundaries as `MaybePromise<T>` when the local API
  uses it. Prefix intentionally unused parameters with `_`.
- Return ordinary Go errors through tuples. Catch only at a local throwing
  boundary, normalize to `Error`, and return through that same path. Throw only
  for upstream panics/`OrDie` or an explicit local boundary.
- Preserve sentinel error identity, wrapped causes (`new Error(message, { cause: err })`),
  typed `Error` subclasses, and aggregate errors via `newAggregate`.

## Existing Semantic Ports

Prefer existing helpers over superficially similar JavaScript APIs:

- `src/go/container/heap`: retain `heap.Interface` and
  `init`/`push`/`pop`/`remove`/`fix`, not a sorted array or npm queue.
- `src/go/sort` and `src/go/strconv`: use them for the corresponding Go
  operations rather than assuming JavaScript built-ins match.
- Kubernetes string sets and `src/apimachinery/pkg/util/errors`: preserve their
  operations, sorting, aggregation, filtering, and error text.
- Preserve mapped byte, rune, JSON, formatting, and regexp adapters. Go regexp
  and JavaScript `RegExp` are not interchangeable; do not add `g`/`y` flags
  unless the mapped behavior requires them.
- Translate functional options as option functions plus an options value and the
  same application loop/order, not a new object-options API.

## Tests And Completion

- Port upstream tests with their tables, helpers, channels, labels, assertions,
  and case names intact. Do not use a different fixture model or broaden an
  assertion to fit local behavior.
- Use `browser.describe`, `kubernetes.describe`, `etcd.describe`, or
  `fakeEtcd.describe` as appropriate. Use the simulator Clock only when needed
  for a deterministic translation, and explain that minimal adaptation locally.
- When upstream uses client-go workqueues, caches, indexers, informers, or
  conflict retry, use the local ports and preserve event/worker lifecycle. In a
  queue worker, retain `[item, quit] = await queue.get()`, the quit branch, and
  exactly one `queue.done(item)` in the matching `finally`.
- If upstream depends on unsupported simulator scope, state it and preserve the
  closest explicit shape or ask before omitting it.
- Before finishing, audit implementation and tests line by line against
  upstream. Report every intentional deviation and its concrete reason. Passing
  tests alone do not establish parity.
