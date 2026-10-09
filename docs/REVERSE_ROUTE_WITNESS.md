# Fresh reverse-edge witness

Selected route-phase diagnostics showed mostly reverse/partial planning exhaustion. That is inconclusive search, not proof that a return route is impossible. This change attempts a small directed-edge certificate before falling back to the same reverse A*.

## Proof, not coordinate reversal

After an ordinary forward route passes existing validation, the helper considers its retained nodes in reverse order. For each step it calls the pinned `Movements.getNeighbors` afresh and selects an actually generated matching neighbor. The generated Move, including remaining scaffolding and movement metadata, becomes the next source. No forward jump, drop or diagonal is assumed reversible.

The certificate succeeds only when the supplied origin goal accepts a node. The forward path omits its initial node; no floored or raised start is guessed or appended. If no retained node satisfies the origin, the normal reverse search still runs. Initial endpoint acceptance follows A*'s existing initial-node exception.

## Conservative gates

- Real pinned Movements instance, digging/towers/parkour/free motion disabled, empty scaffolding, default unlimited search radius.
- At most 64 retained forward nodes; integer coordinates and no break/place/parkour metadata.
- Every fresh reverse edge has finite nonnegative cost, no terrain edit and passes the caller's node validator.
- Entity collision index refresh matches the reverse planner.
- No awaits or certificate reuse. World, entity, connection, planner and dimension identity must remain unchanged. Observed terrain/chunk/session/entity events invalidate the proof. All temporary observers are removed.
- A cooperative 12ms local allowance is charged against the existing shared planning deadline. Individual synchronous library calls can overrun until the next check; it is not a hard CPU-time limit.
- Cancellation and the global deadline are rechecked immediately afterward. Failure is inconclusive and falls back to reverse A* with only the remaining budget. It is never labeled noPath by the helper.

Fixed-endpoint pickup keeps its original reverse-first A* flow. Existing final session, endpoint, route and movement checks remain in place. No mining permission, safety rule, scout/action allowance or total planning budget is relaxed.

## Verification intent

Real-Movements fixtures cover supported flat walking, unreversible drops, missing home evidence, changed support, blocked diagonals, entity avoidance, terrain events, unsafe-node/placement metadata, malformed caps and cancellation/deadline handling. Integration tests require one planner call only for a valid witness, ordinary reverse failure on fallback, and unchanged fixed-endpoint ordering.

This can avoid redundant graph expansion when a fresh reverse route exists on the forward corridor. It is not a claim that every path reverses, that partial failures are impossible routes, or that natural survival completion improves. Those outcomes require separate frozen-source trials.
