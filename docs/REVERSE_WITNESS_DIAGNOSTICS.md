# Reverse witness diagnostics

Returnable walking planning can try a bounded, fresh reverse-edge witness after
forward planning. A null witness still falls back to the existing reverse A*
search, subject to the same caller cancellation and planning deadline checks.
Fixed-endpoint pickup planning stays reverse-first and does not try this witness.

Each attempted witness can deliver one optional `onDiagnostic` callback after its
existing cleanup. Callback errors are ignored. The helper still returns only
`null` or `{ path }`; pre-existing preflight or cleanup exceptions still propagate.
The record never includes positions, paths, raw errors, or planner objects.

| Field | Meaning |
| --- | --- |
| `status` | `success` or `declined` |
| `reason` | An allowlisted outcome below |
| `forward_nodes` | Observed forward-path length, bounded to 0–64; omitted if the original guard short-circuited before reading the length |
| `forward_nodes_capped` | Present and `true` only when the observed length exceeded 64 |
| `validated_edges` | Number of fresh edges accepted after the existing validation and unchanged-context check, 0–64 |

Success reasons are `initial_endpoint`, `retained_corridor`, and `final_edge`.
They distinguish accepting the initial reverse node, reaching home along retained
forward nodes, and proving the one permitted fresh final edge to home.

Decline reasons are `policy`, `input`, `cap`, `cancelled`, `local_deadline`,
`planning_deadline`, `deadline`, `event`, `context`, `corridor_unverified`,
`final_edge_unverified`, and `exception`. `local_deadline` identifies expiry of the
witness's at-most-12ms slice; `planning_deadline` identifies expiry of the caller's
shared planning window. `deadline` is a conservative fallback when the existing
clock comparison fails with a non-comparable value, such as NaN. Invalid optional
node/time caps also use `cap`. The recorded reason follows existing short-circuit
order; it does not perform another check to discover simultaneous conditions.

A shared own-data-property normalizer reads only allowlisted status/reason values,
bounded integer counts, and the capped flag. Accessors and inherited properties
are ignored. Malformed values, unknown fields, and arbitrary data are excluded.

For a non-fixed attempt, successful planning returns sanitized `reverse_witness`
metadata even when the witness declined and reverse A* succeeded. A failed reverse
attempt carries the same metadata inside `route_failure.reverse_witness` through
existing failure aggregations and their entry caps. Forward failures and fixed
routes carry no witness record. Each planning call owns its own record.

After its existing context and endpoint checks, `returnableGoal` emits one
best-effort structured journal entry when witness metadata exists:

- Type: `route`
- Message: `Returnable walking route verified`
- Data: `{ reverse_witness: <normalized record> }`

This is planning evidence, not proof of physical arrival or action completion.
`declined` with a successful planning log means ordinary reverse A* supplied the
certificate. Counts describe accepted witness edges, not all generated neighbors
or search work. The instrumentation adds no planner or validator calls, clock
samples, retries, budgets, or changes to safety and returnability decisions.
Offline tests verify these contracts; no live-game performance or success-rate
claim follows from those tests.
