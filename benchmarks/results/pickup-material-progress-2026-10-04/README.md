# Separate grounded arrival from pickup progress

During the frozen 454-check evaluation, seed 1146093953 passed in 180.924 seconds but logged 137 failed pickup probes across 16 target IDs. Most retries were route rejections, and some followed legitimate nearby terrain changes. This does not establish an elapsed-time regression.

A narrower defect was reproducible: the pickup retry cache was cleared whenever navigation ended on verified ground, even if the same item remained and inventory did not change. IDs 505 and 560 show repeated two-failure/arrived cycles from unchanged observed poses. In the retained source journal, lines 110–117, 173–180 and 212–219 have identical before/after inventory, position and observed local blocks. A standalone frozen-context cache replay repeated the reset without reaching the existing deferral threshold.

The fix preserves navigation landing evidence independently. After the existing bounded settlement grace, target disappearance or own-player target collection clears retry history. A short-lived listener includes collection during that grace and is removed on every exit. An unchanged live target with a verified arrival and no inventory gain instead receives a no-collection-progress retry record. Unrelated gains do not clear the target's history. No false unsafe-landing error is thrown.

The existing three-failure threshold, 30-second expiry, movement/terrain/identity invalidations, bounded budgets and direct unscoped retry remain unchanged. Disappearance does not invent inventory gains. Ambiguous gains can permit occasional additional attempts, still bounded by the action budget.

463 automated checks pass. The repeated-arrival regression failed before the change (six walks instead of three) and now passes. Additional tests cover mixed failed/arrived probes, late target disappearance, target collection during grace, unrelated gains and cancellation cleanup. Independent read-only review found no correctness blocker and separately checked late partial target collection with an existing failure record and another player's collection event.

This patch is not in the frozen 454-check cohort or the separate 457-check placement candidate. Physical verification of this source is pending. No new world score, public release or claim that every failed pickup is avoidable is made.
