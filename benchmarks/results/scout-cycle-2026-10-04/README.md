# Stop spending scouting attempts on the same short loop

Known development world 1276821265 alternated between approximately (-11.5,73,-49.35) and(-11.5,74.02,-45.5). Historical failed 6/8-block sweeps clamped subsequent travel to 4 blocks. Each successful but non-novel hop reopened the same fallback, eventually consuming all 24 scouts without new materials.

Scouting now records actual completed endpoints. At an unchanged local origin, a direction/distance target that was unverified or completed without novel coverage is spent for this search. Such targets are removed before alternatives are handed to the executor. When a preferred length has no unspent choice, the selector tries other bounded lengths within the existing schedule. No untried local target means a truthful block. Material gain or verified terrain clearance can reopen targets; ordinary walking cannot. The 24-scout cap, time limit, job area, 64-block leg cap and route-certification budget are unchanged.

This patch also completes goal-aware tree discovery: gating uses freshly observed table positions and reachability, including a remembered table that disappeared. Safety and drop observations remain active.

All 342 automated checks passed. Five targeted regressions fail against the preceding f6eb96e source and pass here, including the A/B loop, remembered-table disappearance, material/terrain reset and actual non-novel endpoint memory. This is implementation evidence, not a new live benchmark score. Selected live validation remains pending.
