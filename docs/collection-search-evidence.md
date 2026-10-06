# Ordinary collection search diagnostics

Collection results now include an `ordinary_search` snapshot. It is diagnostic
evidence, not permission to excavate or a reusable action capability. No private
soil operation is selected by these fields.

The paged block cursor distinguishes actual traversal completion from a candidate
count cap, time budget, or matching-cell budget. It retains unknown-column and
unknown-cell counts across pages. Finishing the iterator over unloaded terrain is
not complete observed coverage. Native `findBlocks` and cached-candidate paths
never claim verified complete coverage.

`complete_empty` requires a cursor-backed completed traversal with no unknown
terrain, no accepted candidates, no skipped positions, no mining failures, no
search/ranking limit, and a stable observed context. Pose changes are latched,
including moving away and back. The existing traversal, candidate selection,
movement, mining, budgets and continuation policy are unchanged.

The filter is specifically `exposed_environment_safe_in_bounds`: zero accepted
candidates does not mean zero stone, exhausted route alternatives, or an absence
of buried resources. A result also does not prove that drops are settled, scouts
are exhausted, a pickaxe is carried, health is adequate, or the same context still
exists after return. Observation IDs identify snapshots; they are not ownership
leases. A future automatic recovery consumer needs fresh lifecycle and admission
checks, explicit scout evidence, durable one-attempt persistence and proper
partial-result handling before any terrain action.

Candidate-failure, pickup, planning and count limits remain visible separately.
Old skipped coordinates prevent an empty-scan claim rather than silently erasing
unresolved candidates. This change is independent of the private stone collector.

`collection_loop_stop` describes only the mining loop. A subsequent pickup pass
can still be planning-limited, pickup-limited or unsettled; use the existing
operation-wide pickup/planning fields for that final outcome. Missing-column and
cell counts cover the widened traversal envelope, so coverage can conservatively
remain incomplete even when the narrower requested sphere is loaded.
