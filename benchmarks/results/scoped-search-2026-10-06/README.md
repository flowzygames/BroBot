# Collection-local cursor invalidation

## Observed defect

An attribution-only 120-second diagnostic on source `b59fa557503c0458913024b357c9db9747c45aa2` recorded three pending collection cursors cleared directly by block updates. There were no recorded snapshot/identity changes, aborted signals or expiry. The updates were at least 87.664, 121.033 and 123.794 blocks from any possible fixed query origin in the recorded starting section. All are outside even the maximum legal collection dependency radius of 65 blocks.

The diagnostic produced 29 numbered records plus a header, below its 2,000-record limit. Its timing was affected by instrumentation and it reached the 120-second time budget. This is not a normal benchmark score, nor proof of the cause in older uninstrumented runs.

`before-trace.tar.gz` preserves the declaration, trace, raw result, console/server logs and per-file manifest. SHA-256: `ada79a9907d8e18c4dceb9f7f3386f89bef86b4107f9559d0a30f296b59042e5`.

## Narrow correction

Only collection supplies a terrain dependency: the fixed floored search origin and search radius plus one block. The collection predicate reads a target within radius and its immediate face neighbors; all those terrain dependencies are inside this sphere.

- Ignore a block update only if both old and new positions are valid and strictly outside the sphere
- Invalidate on sphere boundaries, malformed/missing coordinates and relevant local changes
- For chunk events, intersect the complete column's horizontal rectangle with the dependency disk; include tangencies and all heights
- Copy and freeze the scope; changed scope forces a fresh cursor
- Preserve global invalidation when no scope is supplied
- Preserve every existing exact pose, session, parent/action signal, TTL and query guard
- Recheck routes and mining safety after candidate discovery; no prior safety verdict is retained

The generic cursor does not infer locality for arbitrary predicates. Distant matching-state changes can alter scan timing, but cannot make a previously rejected local target eligible without a relevant target/neighbor change, which still invalidates.

## Verification so far

58 focused lifecycle/trace checks passed. Four full action/controller integrations passed: normal and distant-event five-page scans, plus block-update and chunk-reload insertion into an already skipped palette section. Newly inserted targets are rediscovered and still refused by the fresh digging guard; no digging occurs in these modeled fixtures. The final aggregate and post-change physical diagnostic are pending.
