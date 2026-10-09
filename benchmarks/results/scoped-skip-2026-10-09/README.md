# Query-scoped skip evidence: verified scheduling correction

Published application [`a57272a422b574948ff8c9ebf50717508bdc81de`](https://github.com/flowzygames/BroBot/commit/a57272a422b574948ff8c9ebf50717508bdc81de), tree `c2332575af23e118447e99848a6e06db4fb1e01a`. Completed October 9, 2026, Eastern Time. Automated and prepared tests ran on local `21601e76f1ff4ed2756cf18729441ea711de6385`; runtime and tests are identical, while later integrated documentation differs. The prepared result format itself does not certify a commit.

## Change and checks

Historical skipped targets outside the current collection sphere cannot suppress a candidate in that query. Their total count previously prevented a fully empty search from publishing a transient scheduling hint. The new explicit `query_skipped_positions` counts the complete validated history inside the same inclusive sphere and floored origin as target filtering. Total history, deduplication, candidate exclusion and continuation identity remain intact. [Contract](../../../docs/SCOPED_EMPTY_SKIP_EVIDENCE.md).

- **1,096/1,096 automated checks passed.** Six real-runner scope regressions failed before the fix and passed afterward. Additional dense-page tests verify that history from earlier pages is retained and even a distant skip-set change invalidates continuation identity.
- **17/17 prepared Minecraft phases passed.** Later phases use supplied materials; this is not natural-world completion evidence.
- Independent code review found no blocker. Exact source and merge-candidate CI both passed all six jobs: [source](https://github.com/flowzygames/BroBot/actions/runs/37921528323), [merge candidate](https://github.com/flowzygames/BroBot/actions/runs/37921558483).
- Missing or malformed scoped receipts remain ineligible. The radius-plus-one exposure dependency halo, local terrain invalidation, lifecycle/cancellation checks, route certification, mining checks and all work limits remain unchanged.

## Selected natural world still fails

Seed `1276821265` on clean published source failed in **188.182 seconds**, at **84 actions and 24 scouts**, with no cobblestone. Final health and food were 20/20, terrain trust remained true, and the wooden pickaxe was unused. No completed outcome was rerun or replaced for this candidate.

The journal contains 50 collection actions, 24 explorations, six crafts, three direct digs and one pickup, plus 108 inspections. Eleven scouts completed; 12 hit planning-budget limits and one found no path. These are different failure categories, not proof that every budget-limited route is impassable.

The changed receipt classification was observed directly: at 11:08:33.804 and 11:08:34.461 UTC, origin `(-14,76,-45)`, radius 32, total skips were nine but query skips were zero, and `complete_empty:true`. The nearest skipped coordinate was 36.633 blocks away. After movement near `(-14,76,-60)`, those same nine coordinates were inside the sphere and completed searches correctly reported `complete_empty:false`. All 22 retained geometric receipts matched independently recomputed skip counts. Time-limited, native and cached observations did not falsely establish complete-empty evidence.

The journal does not expose every retry-key creation, consumption or watcher invalidation. It verifies scoped receipt behavior, not every scheduling transition. Distinct prior runs took 183.202 and 192.515 seconds and also failed; timing differences do not establish a speed or reliability improvement.

## Evidence and limits

`scoped-skip-evidence.tar.gz`: 99,248 bytes; SHA-256 `30b328bb9da17b42e65f3f8519208b510ad0e13e2b8daeac0d602fdc716e5486`. The 15 members retain the complete selected result/journal/saved bot job state/server log, prepared result/log, pre-fix and passing test logs, harness details and 168 source-file hashes. `manifest.json` records every member checksum.

The full known-world cohort has **not** been repeated on this candidate. The latest complete score remains **13/20 known worlds and 2/3 separate originals on older `a2bdfd00`**, below its earlier 14/20 and 3/3 baseline. Do not transfer that score to this patch. No private excavation, increased budget, new packaged download, rendered Windows/Bedrock gameplay, paid-model result or stable 1.0 is claimed.
