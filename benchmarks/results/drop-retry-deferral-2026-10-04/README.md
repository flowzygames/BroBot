# Bounded starter drop retries

The frozen 383-check evaluation of seed 454806089 timed out at 300.004 seconds, health 20, with nine cobblestone and no completed kit. Its journal recorded 185 pickup events: 87 return-planning-budget failures, 45 no-path failures, 37 no-standing-space failures, eight collected outcomes and eight arrived outcomes. Drop 337 was attempted 39 times and drop 686 30 times. This is a recorded cost problem; it does not prove every changed world outcome has this cause.

The separate within-action correction gives all pickup passes in one collection action a shared three-attempt allowance. Its regression demonstrated nine probes before and three after, while a fresh direct pickup action can retry.

This additional change carries failed-target evidence between automatic starter actions, including implicit pickups inside collection and clearance. It does not affect direct user or ordinary AI actions. After three failures, an unchanged target is deferred for at most 30 seconds. The cache is bounded to 128 entries and resets on job/play-session changes. New entity identity, meaningful item/bot displacement, changed observed nearby terrain, or verified arrival releases a deferral. Original observation anchors are preserved during small movements; unrelated inventory gain alone does not reset them.

Deferred items remain in remaining_drops and are separately listed in deferred_drops. They are never silently treated as collected. Landing, return-path, cancellation and time-budget checks are unchanged.

The local halo is not a complete global route proof. Remote changes may not immediately invalidate it, hence the bounded expiry. A route that succeeds but does not collect its target is outside this failed-navigation cache. The controller may still schedule a cheap deferred-only pickup action; this patch removes repeated planning expense rather than eliminating all recovery scheduling.

395 automated checks passed. Physical prepared verification and selected fresh replays are pending after the unchanged 383-check cohort ends. No world-success improvement claimed.
