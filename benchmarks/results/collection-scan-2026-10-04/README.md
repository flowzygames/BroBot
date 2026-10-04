# Reuse unchanged collection candidates

Observed problem: selected 407-check seed 386690312 spent 111.463 seconds in its first twelve stone-collection actions without mining any stone. The retained history reports 62 target failures. The previous implementation repeated the broad block search before each failed target. This exposes 50 possible repeated-search opportunities, not a measured saving: candidate queues and individual scan times were not recorded in that run.

The new action-local queue retains the same effort-ranked top 128 choices used for selection. It refreshes on movement, dimension/boundary changes, block/chunk events, successful mining or queue exhaustion. Each cached candidate is freshly checked for identity, loaded exposure, radius, boundary and mining environment. Approach, return-path, harvest, pickup, landing and cancellation checks retain their existing budgets. A shared planning-budget failure is still not a permanent target blacklist.

A deterministic eight-target no-path fixture makes the same eight attempts in both versions: frozen 413 source performs eight scans; this candidate performs one scan and seven reuses. Raw counts are in scan-counts.jsonl. This is a scan-count regression test, not an in-game speed or world-success benchmark.

Review caught a provisional raw-prefix caching bug before publication: more than 512 callback candidates could discard a better-ranked alternative. The added regression failed with target order [8,20], then passed with [8,10] after caching ranked choices. Separate regressions cover invalidation, mining refresh, cancellation cleanup and a newly liquid-adjacent target.

418 automated checks pass on application commit 07d292a. Read-only review found no remaining concrete blocker. Physical evaluation is queued after the unchanged integrated 413 cohort; there is no claimed new Minecraft score or updated public release.
