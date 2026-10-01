# Pause/resume validation checkpoint

Tested clean source `526bfb82486f66602dc1fb3e2c4d9e2088985dad` passed 203 automated checks, 17 prepared live phases, 11 prepared skill cases and 20 local controls.

- Original known worlds: **2/3**
- Additional known worlds: **2/3**
- Previously first-pass worlds, now known reruns: **2/4**

Every scheduled case is retained. World 42 failed at 300.006 seconds during pickup recovery, despite an earlier 6e success. Its trajectory diverged during the first unchanged log-collection action, with no pause or reconnect before failure. There is no demonstrated causal link to the pause/resume changes. The failure exposed another existing sealed-drop-pocket planning limit; see `docs/PICKUP_PREFLIGHT.md` for the separately developed reverse-first diagnostic.

The four seeds selected before the earlier 6e run are no longer first-pass or held-out in this rerun. Do not combine successful cases from different revisions into a new score. This checkpoint is not evidence of stable 1.0 readiness.

All runs used fresh normal-survival worlds with empty inventories, no supplied items or edited terrain, and the same 300-second protocol. Identical verified server binary caches were reused to avoid duplicate storage; worlds, player data, logs and configuration stayed separate. Full local raw records were retained; these public summaries omit duplicate trace/history fields.
