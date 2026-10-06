# Private staircase: verified final mining stage

The earlier prepared copied-world executor exposed stone, but its actual second
landing at x=132.69999997 overlapped the target under the unchanged conservative
0.31-footprint guard. A separate ordinary `dig_at` correctly refused to remove it.
The failed replay is retained alongside the new result.

The new private planner certifies a final climb to the preceding landing in the
post-excavation world, including route dependencies and returnability. Execution
checks those dependencies before and after walking, waits for a grounded stage,
and verifies actual-position visibility and current support separation. The
private operation still performs exactly five soil edits and leaves stone unmined.

Frozen local source `1afb5ed2b5b75a5b0a3cd7f0b568667c909efaac` passed the new
prepared Java 1.21.8 replay and all 894 automated checks:
- Five soil receipts, one modeled thin-snow clearance and two sampled descents
- Final grounded mining stage approximately (131.5,62,81.5)
- A separately requested ordinary `dig_at` removed stone at (133,60,81)
- Raw stone-air receipt and observed cobblestone inventory increase from 0 to 1
- Actual return home, health 20/food 20, terrain trusted, no server corrections
- Original/home supports independently checked by the server console
- Source hashes unchanged, no cleanup errors and owned server stopped

The terrain is a copy of known failed seed 1542908414. The harness fixes the start,
supplies a pickaxe, removes entities, uses peaceful mode and disables random ticks.
There are no terrain fills in saved-world mode. These are two development replays,
not independent benchmark worlds. Hashes and complete logs are in the manifest
and archive. No public tool, automatic starter activation or release is added.

The guarded return demonstrates current returnability in this prepared case.
It does not prove that later stone removal preserves every historical actual
landing footprint: the prior lower arrival overlapped that stone under the
conservative support model. Automatic integration needs a separately justified
post-removal route and retained-support policy; it remains disabled.
