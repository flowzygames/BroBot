# Route failure phase evidence

Returnable walking requires independently verified forward and reverse paths. Previously both failures used the same message, making natural failures impossible to attribute to a leg from the journal alone.

Errors thrown during a planner leg now carry a small `result.route_failure` object:

- `phase`: `forward` or `reverse`.
- `planner_status`: one of `success`, `partial`, `noPath`, `timeout`, when the planner supplied that status before the failure.

The existing message, name, code, cancellation semantics, generator cleanup, route validation and planning allowance remain unchanged. A timeout is not evidence that no route exists. A successful planner status followed by rejection can mean unsafe terrain or a terrain-modifying path, not a certified route.

Fixed-endpoint pickups still test the reverse leg first. Invalid fixed endpoints, forward endpoint mismatches, post-certification callback errors and pursuit failures outside planning do not receive an invented phase. Cancellation before any yielded result can carry a phase without a status.

Ranked scouts retain per-candidate diagnostics. Collection candidate failures and pickup failure records retain the same bounded object. The runner's error journal projects only these diagnostics and associated integer positions, item IDs and cardinal directions, with at most 4 route attempts, 8 collection failures and 64 entries in each pickup/unreachable list. Omitted-entry counts refer to source entries beyond each cap. Arbitrary result fields, paths and exception objects are not copied into the journal. Existing success receipts remain unchanged.

Diagnostic annotation reads own data descriptors without evaluating getters, preserves confirmed progress, supports frozen error objects through the existing replacement-error mechanism, and returns the original failure if annotation cannot safely complete. Journal projection is best-effort.

This is observability, not a route-selection fix, a larger budget, a relaxed return/safety check, or evidence of improved survival. It prepares the next selected natural run to distinguish forward search from reverse certification failures.
