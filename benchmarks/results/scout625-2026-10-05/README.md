# Qualified 625-check-source world evaluation

Frozen application: `2b5345bb38cdf809497b6b335f0c21695488f8c4`. October 5, 2026 UTC.

- Known worlds: **9 passed, 10 failed, 1 infrastructure-interrupted with unknown outcome** across the fixed 20-world plan.
- Separate original worlds: **3/3 passed** (718224, 42, 20260930).
- Prepared integration gate: **17/17 passed** on this source before the cohort.
- Budget: one fresh 300-second attempt per scheduled world. No failed model run was retried or replaced.

This is not a complete 20-world score. Seed 1244186709 stopped mid-exploration without a result or shutdown marker when execution became unavailable. Its logs and interrupted record remain retained; it was not labeled a model failure or silently substituted. A prior driver interruption after seed 355620996 left a complete result and saved-server shutdown, which was reconciled without rerunning it; its OS exit status remains explicitly unknown.

## What this exposed

The adjacent scouting landing worked in natural seed 924242050, but that world still exhausted its scouting budget without stone. Several other worlds spent their time on failed stone routes; two obtained eleven cobblestone but timed out before crafting. Food depletion also stopped foodless scouting, and one run built the kit but could not finish returning home before low food. One powder-snow spawn was refused before work began. The last wood attempt on 1744809425 was refused before mining because insufficient time remained, preserving trusted terrain.

Compared with the older complete 454-check cohort, these are mixed outcomes, including lost successes. They do not establish that a particular change caused an improvement or regression: several changes and fresh runtime conditions differ. The older 13/20 + 3/3 remains historical evidence for its own frozen source, not a score for this candidate.

## Artifact

`candidate625-qualified.tar.gz` contains the plan, source manifest, prepared result, complete raw game results/events and retained interruption logs/records. These are generated local Minecraft benchmark states, not assistant memory. The external manifest records every member hash and the verified archive hash. Original world folders remain unchanged locally.

The subsequent integrated 652-check changes are evaluated separately. Public download content is unchanged by this evidence record.
