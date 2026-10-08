# Retry after an unchanged failed scout

A stationary failed exploration probe can leave gathering conditions unchanged. The starter already tries another bounded approach in that case, but the runtime's global terrain revision previously cancelled that decision even for unrelated distant block updates. The controller then paid for the same empty stone search again.

The new transient hint applies only when an actual owned collection invocation reports a complete, stable, empty cursor traversal: no candidates, skipped positions, unloaded columns or unknown cells. A watcher starts before that scan. It covers the search sphere and immediate block neighbors used by the exposed-resource predicate. No candidate, path, mining stance or return-route decision is cached.

The hint stays usable for at most 30 seconds and only under the same parent operation, entity, connection, world, registry, position and movement boundary. Relevant or malformed block/column events, movement away and back, losing grounded state, session changes, cancellation, other mutating actions and expiry invalidate it. Changes during scanning prevent the hint from being created. Native, partial, skipped or candidate-bearing searches use the existing global invalidation behavior.

For collect recovery only, a valid opaque hint permits excluding the global terrain revision from the otherwise unchanged observation comparison. Inventory, resource, local terrain, hazard and other observation changes still cancel the continuation. The next scout must pass all ordinary fresh route checks. Step, time, movement and digging limits are unchanged; private excavation is not activated.

## Verification scope

The controller regression reproduces a distant-revision-only change turning `collect, collect, explore, explore` into repeated collection. Helper tests cover receipt matching, event boundaries, malformed data, replacement sessions, parent cancellation, query changes, movement and expiry. An actual ActionRunner/actions test checks that completed-empty hints survive normal cleanup, inspection and a stationary refused scout, while local updates, native fallback and Stop reject reuse.

This is a scheduling optimization. It does not establish that previously failing natural worlds now pass, and it does not replace the frozen full-cohort results.
