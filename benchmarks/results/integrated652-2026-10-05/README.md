# Integrated session, mining and scouting safeguards

Frozen application `f466593ab23a3a0b5ca8a6ffe324486fcfb2591d`, October 5, 2026 UTC.

**652 automated checks, all 17 prepared phases, and two custom real-server checks passed.** The manifest records the exact tested source files and raw result hashes. Independent review verified the custom results, source hashes and saved-server shutdown records.

## Changes

- Physical actions are tied to the entity, client and dimension that admitted them. Respawn/spawn/end invalidates old actions; they stop controls and drain before releasing their lock. Multi-step plans cannot retry an old construction site in a replacement world. Explicit portal entry keeps its intentional transition behavior and parent cancellation still wins. Retired operations do not close replacement-world inventory windows or release replacement held items.
- Starter mining skips a target only when a fully observed local goal-space check proves no possible interaction stance. Partial geometry, unsupported policies, unknown/read failures and time limits fall back to ordinary route certification. The 20 ms preflight is charged to existing 1,600 ms leg and 7,000 ms action limits. Typed exclusions prevent repeating the proved-empty target. Three recorded stone pockets and conservative fallback cases are covered by regression tests.
- Foodless automatic returnable scouting suppresses sprinting. It uses the same supported-food list as the controller, snapshots inventory per action, and restores normal eligibility for direct commands, other starter actions and emergency retreat.

## Physical proof

`action-sessions.json`: an ordinary placement succeeded. Holding a subsequent placement aim across a real Overworld/Nether transition cancelled the old action without a later placement packet. Holding the completion of a real walk across another transition rejected stale arrival. Runner ownership drained and movement controls cleared.

`scout-rations.json`: empty-inventory starter exploration covered 30.8 blocks with no sprint across 145 client samples and no start-sprinting packet. A server predicate confirmed sprint off while moving. Direct movement and a later bread-carrying scout retained server-confirmed sprint; final controls and sprint flag returned off.

`normal17.json`: the normal prepared integration suite passed all 17 phases on the same frozen source.

## Limits and pending work

These are console-prepared peaceful arenas, with artificial promise holds, teleportation, supplied saturation and bread. Food stayed 20 in the sprint-policy fixture. The results prove the tested control behavior, not measured hunger savings, general reconnect safety, rollback of already-sent native packets or autonomous game completion.

A fixed five-world selected diagnostic cohort on this source is running separately. It does not replace a full benchmark score. The preceding 625-check source run is retained separately as 9 known passes, 10 failures and 1 infrastructure-interrupted unknown, plus 3/3 originals. The older complete 13/20 + 3/3 result belongs only to its 454-check source. The public download remains unchanged.
