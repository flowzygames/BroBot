# Latest workstation and recovery checkpoint — October 1, 2026

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

# Latest measured recovery checkpoint — October 1, 2026

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
