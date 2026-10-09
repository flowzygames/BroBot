# Route phase diagnostics: reverse certification dominates these selected failures

Frozen natural-run source [`2557a63c466c0b80bae027b971101fe994ccf51c`](https://github.com/flowzygames/BroBot/commit/2557a63c466c0b80bae027b971101fe994ccf51c), tree `839b6321480335f26f2e71d47199af28917b2e8a`. Automated/prepared local source `94c0bf8960ddf98942ab073e5ddb91743032b895` has identical application, scripts and tests; the whole trees differ only by three PR94 evidence files. Prepared receipts do not independently certify a source commit. Completed October 9, 2026, Eastern Time.

## Verified scope

This patch labels failures inside forward/reverse planner legs and preserves bounded per-candidate records in journals. It does not alter route selection, budgets, safety rules or return requirements. Annotation is best-effort, avoids invoking result getters, and preserves confirmed progress through cancellation and frozen errors. [Detailed contract](../../../docs/ROUTE_FAILURE_DIAGNOSTICS.md).

- **1,133/1,133 local automated checks passed.** Twenty-two new tests cover phase assignment, reverse-first pickup, cancellation, frozen errors/accessors, bounded projection and real collection/pickup/unsafe-settlement integration.
- **17/17 prepared Minecraft phases passed**, including later supplied-material phases.
- Independent review identified and the implementation corrected a getter-invocation robustness issue before publication; final review found no blocker.
- All six jobs passed in both [exact-source CI](https://github.com/flowzygames/BroBot/actions/runs/37983749496) and [merge-candidate CI](https://github.com/flowzygames/BroBot/actions/runs/37983767591). Ubuntu passed 1,133 tests; Windows passed 1,132 with one intentional POSIX-mode skip. All checked-out commits and test totals were audited.

## Two selected natural failures

The predeclared order was canopy `1276821265`, then wood-planning `1744809425`. Both used the clean published source, fresh natural normal-survival worlds, empty starting inventory, no prepared terrain or supplied items, and no paid model. Existing limits remained 300 seconds, 96 actions and 24 scouts. Pre-connection spawn-radius setup remains disclosed in receipts.

| Seed | Result | Seconds | Actions | Scouts | Stop |
| --- | --- | --- | --- | --- | --- |
| 1276821265 | Failed | 176.787 | 83 | 24 | Exploration budget exhausted after repeated collection failure |
| 1744809425 | Failed | 300.021 | 43 | 9 | Starter job time budget reached |

Both ended at health and food 20/20 without cobblestone. Canopy retained an unused wooden pickaxe, two sticks, three spruce planks and one spruce log. Wood retained only a crafting table. Both saved and stopped normally; no interrupted trial or replacement of a completed result occurred. The wood run's final collection was interrupted by its normal overall deadline and its partial receipt was retained.

## Full-journal phase evidence

Counts distinguish whole actions, candidate/alternative attempts, and individual pickup probes. Pickup summaries are not counted again.

| Observation | Canopy | Wood |
| --- | --- | --- |
| Scout actions | 13 successful, 11 failed | 4 successful, 5 failed |
| Scout alternatives | 72 total: 13 verified, 54 reverse/partial, 4 forward/partial, 1 reverse/noPath | 29 total: 4 verified, 23 reverse/partial, 2 forward/partial |
| Collection actions | 3 successful, 48 failed | 2 successful, 25 failed |
| Retained route-candidate failures | 6: 4 reverse/noPath, 1 reverse/partial, 1 forward/partial | 123, all reverse/partial |
| Failed pickup probes | 37: 31 reverse/noPath, 6 reverse/partial | 12: 3 reverse/noPath, 9 reverse/partial |

The final interrupted wood collection separately retained reverse/partial in its error journal and interrupted-action receipt; it is not included in the 123 candidate count. No projection omission counters appeared. Non-route failures filtered from rejected-action journal projections are not a complete candidate census.

For canopy scouts, **58 of 59 rejected alternatives** were partial, budget-limited searches. For wood scouts, **all 25 rejected alternatives** were partial. Partial means unknown, not evidence that no route exists. Reverse certification is the dominant observed limitation; three-block corridor exhaustion from an older run must not be substituted for these trajectories. Thirteen canopy arrivals, including longer legs, still did not produce stone.

The diagnostics-only patch does not establish why trajectories changed, nor a survival improvement. This is not a full-cohort score: the latest full development cohort remains **13/20 known worlds and 2/3 separate originals on older `a2bdfd00`**.

## Retained evidence and release limits

`route-phase-evidence.tar.gz`: **126,671 bytes**, SHA-256 `19273c80cdc33ef305beb77308c80cffd0ba1c1465af19cfd31976d13f4d78f2`. All 19 members were read back byte-for-byte: complete natural receipts, journals and saved job state, server/harness logs, prepared result/log, test logs, predeclared plan, Java wrapper and hashes of 174 tested source files. `manifest.json` lists member checksums.

Public Core 0.2 ZIP is unchanged. No new stable release, rendered Windows/Bedrock verification or paid-model planning is claimed.
