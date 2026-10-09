# Rejection-only mining stance support

The pinned terrain-preserving walking planner does not generate unsupported air cells as ordinary successor destinations. Previously the mining goal-space preflight treated any clear, visible two-cell air column as a possible stance. An unsupported shaft could therefore defeat an otherwise valid empty-goal-space rejection and trigger an expensive unsuccessful path search.

For noninitial candidate stances, the preflight now requires a full-cube support below clear feet and head. Partial, missing and climbable support remain unknown observations; permitted liquid-foot stances defer to normal planning. Scaffolding must explicitly be disabled with an empty list, since disabling towers alone does not prohibit every placement successor. Both original initial-node probes remain exempt from the added support requirement, preserving the pathfinder's initial-node semantics and raised fractional starts.

The check remains rejection-only. It does not prove that a supported stance is reachable, certify a route, or authorize mining. All existing time, enumeration, cancellation and conservative geometry handling remain active. The enumeration cap also accounts for the possible extra support row.

## Mining-specific endpoints

Generic block visibility can accept standing directly above its target. The live mining guard already refuses any target below the bot's floored feet in the same x/z column. Mining approaches now use MiningFaceGoal, which excludes exactly those endpoints before visibility checks. Generic placement/workstation BlockFaceGoal and InteractionGoal are unchanged. The live footprint, underfoot, protected-anchor and environmental guards remain authoritative.

Already-visible direct underfoot digs still fail without traveling. No adjacent integer cell is rejected by the new goal merely because a real off-center body could overlap it; actual footprint overlap is checked live. The inherited heuristic remains a lower bound to the narrower goal set.

## Evidence limits

Deterministic fixtures contrast an unsupported visible air shaft with a supported positive control, and a self-support-only target shaft with an adjacent valid mining stance. Partial/unloaded/climbable/liquid and initial-node controls preserve conservative fallback behavior. An actual action fixture verifies mining-goal selection and unchanged direct underfoot refusal.

These fix independently demonstrated source-level false-positive stance classifications. Earlier natural-world logs did not record every preflight classification or forward/reverse failure phase, so these defects are not established as the cause of any historical failed seed. No higher success rate, larger work budget, enabled private excavation or stable release is implied.
