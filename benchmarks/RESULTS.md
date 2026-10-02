# Standing-cell recovery checkpoint — October 1, 2026

Frozen application `a3e22428c7dbb873518a7720ccf58a1f3f54a3ae` passes **254 automated checks, 17/17 prepared live phases, 11/11 prepared skills and 20/20 local controls**. Its complete same-20 known-world cohort completed **10/20**, with exactly the same pass/fail set as the previously published `682bf46` cohort. The intermediate `6b26ad5` experiment completed **8/20**; its two losses and all remaining outcomes remain visible.

A separate targeted run of seed 454806089 completed in 107.416 seconds and is not substituted into the cohort. It recorded actual obstruction removal and inventory gains. The paired successes alone do not establish causality. Seed 454806089 recorded two pickup-clearance digs, including a five-cobblestone inventory gain; the zero foliage-clearings counter is a different measure. Seed 1382194916 recorded no pickup-clearance counter. Timing, mobs and drops can vary, and these records do not identify which clearance helper caused a suggestion.

One attempt at seed 355620996 was interrupted during server remapping, before world creation or bot gameplay. Its startup log is retained; the same frozen source/settings were restarted and completed. No gameplay failure was replaced. All twenty seeds have a completed gameplay outcome.

[Every current record, selection plan, startup interruption and tested-code manifest](results/pocket-standing-2026-10-01/). These are known development cases, not held-out reliability. Ten failures remain. Stable 1.0 and live paid-planner/client-platform validation remain unproved.

---

# Transit recovery checkpoint — October 1, 2026

Clean application `682bf46b3d77691ba5e4d8e357819f90ad14e775` passes **219 automated checks, 17/17 prepared live phases, 11/11 prepared skill cases and 20/20 local controls**. The three original development worlds passed: 42 in 159.168s, 718224 in 94.701s and 20260930 in 91.327s. A targeted replay of previously failing world 1542908414 completed in 242.380s.

A bounded read-only terrain probe now checks whether removing one visible natural obstruction could open both the pickup route and its return route. Normal mining rechecks safety before any edit. Aquatic adjacency checks and thin-snow pickup handling were also tightened. [Implementation and limits](../docs/PICKUP_TRANSIT.md).

In a separately prepared saved-world diagnostic, ordinary pickup initially acquired nothing. Removing the verified dirt obstruction recovered ten existing cobblestone, and the bot returned with that inventory and no deaths or respawns. Two other unreachable stacks remained; this is mechanism evidence, not complete collection or fresh survival. The targeted natural replay also used the dirt-clearance recovery, then completed the starter kit and return. Its earlier path differed, so one pass does not isolate the cause or prove broad reliability.

[Current source manifest and complete available records](results/transit-2026-10-01/) preserve those results. The same-protocol rerun of all twenty wider seeds completed **10/20 (50%)** on frozen 682 source, compared with the earlier **8/20 (40%)** first-pass result. All eight prior successes completed again; worlds 454806089 and 1542908414 also completed. The remaining ten failed. Every run stays in its denominator, and the earlier targeted 1542908414 replay is separate from the paired run rather than substituted for it.

These are now known cases, and one run per build can vary with mob/item timing. The difference is observed coverage, not an isolated causal effect or a broad reliability guarantee. [The paired summary](results/transit-2026-10-01/paired-summary.json), individual records and original selection remain available. **Stable 1.0 is not verified.**

---

# Twenty-world first-pass coverage — October 1, 2026

**8/20 completed (40%).** On frozen application `1e7ab1f96656cabcdfd28c4f077ce49699e0234a`, twenty preselected new worlds were each tested once under the same 300-second normal-survival protocol. The objective required both a stone pickaxe and furnace, being alive, and returning to the starting point. No materials or terrain were supplied and no paid model was used.

This is the wider readiness result, separate from the better scores on known development worlds below. **Twelve runs did not complete. BroBot is not ready to claim reliable autonomous survival or stable 1.0.**

| Seed | Outcome | Seconds | Recorded reason |
|---|---|---:|---|
| 454806089 | Fail | 54.615 | A hostile mob is too close for unarmored starter gathering. |
| 1542908414 | Fail | 300.005 | Starter job time budget reached. |
| 761598570 | Pass | 77.559 | Observed a stone pickaxe and furnace in inventory, alive and back at the start. |
| 1587439118 | Pass | 111.019 | Observed a stone pickaxe and furnace in inventory, alive and back at the start. |
| 924242050 | Fail | 69.349 | Exploration budget exhausted: Repeated collect failure. Look for a different approach. |
| 113919219 | Fail | 81.358 | No bounded exploration target remains inside the job area. |
| 474859294 | Pass | 66.607 | Observed a stone pickaxe and furnace in inventory, alive and back at the start. |
| 1576696577 | Pass | 76.876 | Observed a stone pickaxe and furnace in inventory, alive and back at the start. |
| 1382194916 | Pass | 268.456 | Observed a stone pickaxe and furnace in inventory, alive and back at the start. |
| 386690312 | Fail | 240.929 | Exploration budget exhausted: Repeated collect failure. Look for a different approach. |
| 1744809425 | Fail | 300.004 | Starter job time budget reached. |
| 61544722 | Fail | 39.682 | Exploration budget exhausted: No supported tree logs are visible nearby. |
| 1041160109 | Fail | 52.441 | Exploration budget exhausted: No supported tree logs are visible nearby. |
| 1888406977 | Pass | 94.592 | Observed a stone pickaxe and furnace in inventory, alive and back at the start. |
| 1547703085 | Fail | 50.049 | Exploration budget exhausted: No supported tree logs are visible nearby. |
| 1146093953 | Pass | 121.782 | Observed a stone pickaxe and furnace in inventory, alive and back at the start. |
| 1014875191 | Fail | 182.430 | Exploration budget exhausted: Repeated collect failure. Look for a different approach. |
| 355620996 | Pass | 230.148 | Observed a stone pickaxe and furnace in inventory, alive and back at the start. |
| 1276821265 | Fail | 300.021 | Starter job time budget reached. |
| 1244186709 | Fail | 67.099 | Exploration budget exhausted: No supported tree logs are visible nearby. |

Seeds were selected before world inspection using a recorded deterministic random selection. All twenty scheduled cases finished and every failure remains in the denominator, including resource-poor spawns, hostile interruptions and terrain failures. The application remained unchanged throughout the run queue. These worlds may inform subsequent fixes; future runs on them are known-case reruns, not new first-pass evidence.

[Preselection, validated summary and every individual record](results/wide-first-pass-2026-10-01/) retain source, conditions and initial/final evidence. Original full records are retained, with SHA-256 identities in the published summaries. This small sample is not an overall intelligence score.

---

## Pickup and pause-recovery checkpoint — October 1, 2026

Tested clean application `1e7ab1f96656cabcdfd28c4f077ce49699e0234a`: **208 automated checks**, **17/17 prepared live regression phases**, **11/11 prepared skill cases**, and **20/20 local controls**. All ten known-world reruns used this same frozen source. The source manifest verifies the tested application bytes in a documentation/evidence package.

| Cohort / world | Complete starter and return | Elapsed |
|---|---:|---:|
| 718224 | Pass | 100.478s |
| 42 | Pass | 158.151s |
| 20260930 | Pass | 76.891s |
| **Original development worlds** | **3/3** | |
| 314159 | Pass | 86.129s |
| 271828 | Pass | 99.866s |
| 8675309 | Fail | 300.021s |
| **Additional development worlds** | **2/3** | |
| 256004205 | Pass | 93.812s |
| 345250156 | Fail | 67.300s |
| 387394791 | Pass | 99.725s |
| 904314939 | Fail | 193.955s |
| **Wider known development worlds** | **2/4** | |

All ten are now known development worlds. The four wider seeds were new first-pass cases only in the earlier 6e checkpoint; these reruns must not be called held-out or new. Every failed case remains in its denominator. The separate twenty-world first-pass evaluation above completed 8/20 on this unchanged application.

## What changed

- Fixed pickup standing cells are checked for a return route first, then a forward route under the same deadline. Sealed pockets can be rejected cheaply; neither direction is optional. See [the diagnostic and safeguards](../docs/PICKUP_PREFLIGHT.md).
- Pausing between collection and recovery preserves scoped pending drops in the same play session. Respawn, reconnect and process restoration do not blindly trust old entity IDs.
- Specific stop and low-air instructions survive an interruption during the controller's inter-step delay.
- “Craft four torches” stays in the offline grammar, with the same 1–64 quantity boundary. Capitalized “Follow Me” and “Come Here” resolve the owner without changing literal player-name case.

The earlier 526 build failed world 42 during pickup. That full 2/3 original-cohort result remains [preserved](results/pause-resume-2026-10-01/); it is not replaced by the later successful retry on this new source. The trajectories differ, so one later pass does not by itself establish causality or general reliability.

## Remaining limits

The canopy case 8675309 reached the five-minute limit. World 345250156 still found no tree logs within the bounded search; world 904314939 still stopped on difficult mangrove terrain. These gaps prevent a stable 1.0 readiness claim. No live paid-model evaluation or rendered Windows/macOS client playthrough has been completed here. [The manual player checklist](../docs/PLAYTEST.md) makes those client checks explicit.

[Per-world records, prepared suites and file manifest](results/pickup-preflight-2026-10-01/) retain conditions, source identity and failures. The natural runs use normal survival, empty inventory, no supplied items or edited terrain, and the fixed 300-second protocol. Prepared fixtures are separate. Identical verified binary caches were reused; world/config/log/result data stayed isolated. Full local raw records were retained; published summaries omit duplicate traces.

---

## Prior pause/resume validation (preserved)

The later pause/resume fixes on clean source `526bfb8` passed 203 checks and the full prepared suites, but the complete ten-world rerun scored **2/3 original, 2/3 additional, and 2/4 wider known worlds**. In particular, world 42 failed again during pickup recovery. [All ten later records](results/pause-resume-2026-10-01/) are retained. The 6e results below describe that earlier coherent build; they are not substituted for the later failure. The resulting reverse-first change is measured in the latest table above; this failed cohort remains unchanged.

## Earlier workstation and recovery checkpoint — October 1, 2026

Tested app `6e63360210f525baa3d53af6a8cfffa2b63015df`: **198 automated checks**, **17/17 prepared live regression phases**, **11/11 prepared skill cases**, and **20/20 local controls**. Source stayed frozen and clean throughout this suite. Documentation and evidence are packaged afterward with a matching tested-file manifest.

Workstation selection now prefers a visible table over a closer obstructed one and places a carried table locally when the nearby table is blocked. Repeated crafting failures now execute bounded scouting instead of spinning through the work limit.

| Cohort / world | Complete starter and return | Elapsed |
|---|---:|---:|
| 718224 | Pass | 99.653s |
| 42 | Pass | 150.625s |
| 20260930 | Pass | 91.643s |
| **Original development worlds** | **3/3** | |
| 314159 | Pass | 95.489s |
| 271828 | Pass | 108.002s |
| 8675309 | Fail | 300.005s |
| **Additional development worlds** | **2/3** | |
| 256004205 | Pass | 78.019s |
| 345250156 | Fail | 67.619s |
| 387394791 | Pass | 124.452s |
| 904314939 | Fail | 116.963s |
| **New first-pass worlds** | **2/4** | |

All ten cases used the same clean app, Linux/Node 24.19.0, Minecraft 1.21.8, normal survival, empty inventory and a 300-second limit. No materials or terrain were supplied. Every scheduled case remains in its denominator; no best retry was selected.

The original and additional cohorts are known development worlds. Four new seeds were randomly selected before their worlds were inspected and tested once on this frozen build; [the selection record](results/workstations-2026-10-01/first-pass-selection.json) is included. Their **2/4** result is a small first-pass check, not general reliability proof. Once used for diagnosis, these are also known development cases for subsequent work.

### What still stops it
- **8675309:** Canopy run reached the 300-second limit; no completion claimed.
- **345250156:** No supported logs were found before the eight-scout limit. A separate saved-terrain diagnostic found no logs inside the loaded 90-block job area; extending retries would not create trees.
- **904314939:** The bot made a wooden pickaxe but could not reach stone through its dry, returnable walking policy. Saved-terrain analysis found a 108-cell canopy component at Y81–90, with the observed stone targets at Y67 or lower and no reachable harvesting endpoint. Home was reachable. This static diagnosis does not prove how terrain editing would behave live.

[Per-world evidence, cohort reports and the tested-file manifest](results/workstations-2026-10-01/) retain pass/fail conditions and source identity. Summary records omit duplicate traces; full local harness records remain retained. Prepared fixtures supply resources and do not prove autonomous acquisition. Live API planning and Windows/macOS rendered-client gameplay remain unverified. This is a development preview, not stable 1.0.

---

## Previous complete checkpoint (preserved)

## Earlier measured recovery checkpoint — October 1, 2026

The application snapshot `c1e01963a8eea0b6446c47a1f4dd6302a91986f8` passed 194 automated checks, all 17 prepared live regression phases, all 11 prepared skill cases and all 20 local control/grammar cases. The published documentation/evidence commit may differ; application code is unchanged from this tested snapshot.

| Development world | Complete starter and return | Elapsed |
|---|---:|---:|
| 718224 | Pass | 99.100s |
| 42 | Pass | 182.106s |
| 20260930 | Pass | 88.720s |
| **Original cohort** | **3/3** | |
| 314159 | Pass | 89.896s |
| 271828 | Pass | 91.871s |
| 8675309 | Fail | 274.493s |
| **Additional cohort** | **2/3** | |

All six runs used the same clean source, Linux/Node 24.19.0, Minecraft 1.21.8, normal survival, empty inventory and the fixed 300-second protocol. They had no supplied items or edited terrain. These seeds have informed development and are not a held-out set. The canopy failure reached the 64-step work limit while repeatedly failing to reach its crafting table; no completion is claimed.

[Per-world summary records, cohort reports and prepared-test records](results/recovery-2026-10-01/) preserve the denominators and conditions. World records explicitly omit duplicate runtime history/trace; full local harness records and unsuccessful intermediate runs were retained. This small sample does not establish general reliability. Prepared skill fixtures supply materials and differ from natural survival. No paid model evaluation was run.

## Diagnosed recovery problems

- A microscopic collision-contact error could make the client predictor think it could sprint into a solid grass corner. A scoped predictor adapter now clips that inward motion; the exact prepared corner completed three consecutive trials in the earlier targeted replay, and the final full suite also passed its repeated-corner phase. See [the numerical analysis and limits](../docs/COLLISION_CONTACT.md).
- A stale pickup continuation could run after clearance had already recovered all tracked drops, then pursue unrelated litter into water. Recovery now uses observed entity IDs and cancels empty continuations.
- The installed Mineflayer modern shared oxygen field can contain another entity's air. The current snapshot reads only the bot's own mapped player metadata; earlier shared-field oxygen values must not be treated as proof of its air level.
- Canopy and other difficult terrain still need more recovery work. Earlier static analysis showed one canopy state could descend but not walk back to stone under the existing no-dig/no-placement navigation policy. That analysis is diagnostic, not a claim about every later run's exact topology.

The prior 1aa7788 same-source cohort passed 2/3 original and 1/3 additional worlds. Later targeted successes were not substituted into it; the table above is a complete rerun on c1e0196. Longer 600-second diagnostics remain separate from the fixed protocol. Windows/macOS rendered-client gameplay and live API planning remain unverified. This is a development checkpoint, not a stable 1.0 release.

---

## Preserved earlier results

# BroBench results and recovery checkpoint

## Frozen comparison

The [raw results and summary](results/frozen-2026-09-30/) preserve the original comparison between local source commits `659ffce1da4d8203c6d448a221d5f4c0ff71bb5f` and `5164554fdaf25d9139ace4becc9aa803861333f7`. These local commit IDs identify the evaluated sources; they may not be reachable as commits on GitHub because publication uses an equivalent squashed source tree. The baseline source tree matches published PR 4 at `ea513e5d32dde630c706ddd3e3ceb0614c6ae4b5`.

Both versions scored MineLine 3/3, Workbench 6/6, Pathfinder 2/2 and SafetyLatch 6/6. CommandSense changed from 12/14 to 14/14. Trailhead was 0/3 for both: the baseline lacks the starter mode, while the candidate hit its travel bound, paused on low health and exhausted scouting. GoalSense LLM was not run.

The baseline raw dirty flag came only from an untracked dependency symlink. Tracked files matched its commit and both versions used the same unchanged lockfile. The candidate was clean. Raw flags and outcomes are preserved, including failed runs. Embedded filesystem paths refer to the original test executor, not files expected on your computer.

See [the protocol](protocol.json) and [reproduction guide](README.md) for fixtures, seeds and scoring. These are development cases, not held-out tests. There is no aggregate intelligence score.

## Recovery development checkpoint

After table reuse, travel guards, full-footprint support protection and tracked-drop headroom recovery were added, [one targeted Trailhead replay](results/recovery-development/trailhead-20260930.json) passed on seed `20260930` in **215.975 seconds**. It began with an empty survival inventory and ended alive at the starting point with a stone pickaxe and furnace. No items were granted, terrain was not prepared and no live API model was used.

This run records parent commit `5164554` with `dirty: true` because the recovery edits were not yet committed. Those tested source edits were subsequently saved as local commit `1b443383cf3268abf7fb909264a1997d9a66cc27`. Later README changes do not change that tested application source.

The same recovery source passes **141 automated tests** and [all 16 live regression phases](results/recovery-development/live-regression.json). Prepared regression fixtures are not fresh-world survival evaluations.

One targeted success does not replace the frozen 0/3 result and is not a new full comparison. Repeated worlds, wider terrain, real Windows gameplay and live language planning still need validation. Current branch CI must be checked on its own published commit.
