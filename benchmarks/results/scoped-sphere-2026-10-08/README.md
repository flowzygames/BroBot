# Scoped collection search: verification and remaining limits

Frozen published application: [`acdf602ccf7c6c000744e67505ff2a164ceeb5d0`](https://github.com/flowzygames/BroBot/commit/acdf602ccf7c6c000744e67505ff2a164ceeb5d0), tree `fc54a2ebe1879eb88bc99354ec6d429f756e119d`. The initial local test commit `3b2b32f` has the identical tree. Completed October 8, 2026, Eastern Time.

Collection keeps the widened section iterator needed for diagonal completeness, but now skips sections and cells outside the actual resource sphere before reading targets or counting matches. Mining predicates, route certification, continuation invalidation and all work limits are unchanged. [Algorithm and contract](../../../docs/SCOPED_COLLECTION_SEARCH.md).

## Checks

- 1,068/1,068 automated checks passed on an unchanged sequential recheck.
- The initial check, run alongside server work, passed 1,067/1,068. A saved-world private soil-stair planning fixture returned no plan against its two-second wall-clock budget. The isolated 40-test suite and unchanged aggregate rerun then passed. The first failed log is retained; this is not silently presented as a first-attempt pass.
- Prepared real Minecraft integration passed all 17 phases. Some phases use supplied materials or prepared terrain; this is not natural-world survival evidence.
- Independent source review found no blocking issue. Geometry fixtures compare exact visited sets with an independent integer-sphere oracle. Actual runner tests verify three-page dense completion, discovery on a continued page, fresh route rejection and exposure-neighbor reads beyond the sphere boundary.
- Source CI passed on both the [exact head](https://github.com/flowzygames/BroBot/actions/runs/37876369649) and [PR merge candidate](https://github.com/flowzygames/BroBot/actions/runs/37876376459), including Windows/Ubuntu checks and extracted-artifact gates. CI does not establish rendered Windows/Bedrock gameplay.

## Selected natural world still fails

Seed `1276821265`, fresh natural terrain, empty survival inventory, normal difficulty, no supplied items or terrain edits, no paid model, unchanged 300-second/96-step/24-scout limits:

| Outcome | Result |
| --- | --- |
| Starter task | Failed; exploration budget exhausted |
| Recorded gameplay time | 140.199 seconds |
| Job actions | 77 |
| Scouts | 24 |
| Bounded search-page responses | 9 |
| Final health / food | 20 / 20 |
| Final inventory | One unused wooden pickaxe, three spruce planks, two sticks; no cobblestone |

The complete event journal records 43 collection actions, 24 exploration actions, six crafts, three direct digs and one pickup. There are 98 additional inspections. All 18 completed scouts were recorded as non-novel; five other scouts hit return-path planning limits and one found no path. Repeated short movements around canopy corridors remain a bottleneck.

The prior frozen `5a15225` run failed at 166.438 seconds, 96 steps and 13 scouts, with 59 bounded search-page responses. The new run's nine such responses and 24 scouts are consistent with less search-budget waste, but are not a controlled estimate of speed or reliability. Neither run completed the starter task. The 14/20 full-cohort score remains attached to older `fb69b493`; the new source has not repeated that cohort.

## Interrupted attempt and retained evidence

The first attempt at 02:42 UTC was interrupted by an execution-environment restart during gameplay. No final result was written. Its partial journal, saved job state, server log and harness output remain separate. It is not counted as a completed run and no success is inferred. The later fresh attempt is explicitly labeled as recovery after that interruption; no completed gameplay outcome was replaced.

The first Java version probe also created an untracked cache directory before the initial run recorded source status. No tracked application file changed. The wrapper was corrected before the recovery attempt, whose result records `dirty:false` and the published source commit.

`scoped-sphere-evidence.tar.gz` contains the complete failed recovery result and journal, partial interrupted attempt, prepared result/log, initial and rechecked automated logs, harness details and 168 source-file hashes. All 18 archive members were read back and compared byte-for-byte. `manifest.json` records member and archive checksums. Completed server runs saved and stopped normally.

This update neither enables private excavation nor raises work budgets. Public Core 0.2's packaged ZIP remains unchanged. Actual graphical Windows/Bedrock gameplay and live paid-model planning remain unverified; no stable 1.0 claim is made.
