# Short scout endpoints: complete development evaluation

Frozen source [`a2bdfd00e62a3e3f909339363096a9a327391300`](https://github.com/flowzygames/BroBot/commit/a2bdfd00e62a3e3f909339363096a9a327391300), tree `130d24428831a1d132f71888e806d1d01200d7c8`. Completed October 9, 2026, Eastern Time. The local selected-world and prepared runs used `cef853a5a0cce9efccccb2ec1e0147de9936faa4`, whose tree is identical.

## Outcome

- **13/20 known development worlds**, down from **14/20** on frozen `fb69b493`.
- **2/3 separate original worlds**, down from **3/3** on that baseline.
- No paired gains. Lost known pass: `1744809425`. Lost original pass: `718224`.
- **1,076/1,076 automated checks**, **17/17 prepared Minecraft integration phases** and all six source CI jobs passed. [Source CI](https://github.com/flowzygames/BroBot/actions/runs/37877769684).

These lower observed completion counts are not an improvement in natural-world reliability. This comparison includes several changes since `fb69b493`, not only short-scout novelty. Known seeds are repeatedly used development cases, not held-out tests. Freshly generated worlds can still have different trajectories, mobs and timing. Safety stops remain failures in the denominators.

## What changed and what it proves

A four-block scout may arrive less than four blocks from its start. The former four-block revisit threshold therefore classified distinct short landings as already seen and prevented adaptive growth. The short-leg-specific threshold now distinguishes those landings, while legs of six blocks or more retain their former threshold. This is endpoint scheduling evidence, not proof of unseen terrain or a safe route. All route checks and work limits remain unchanged. [Contract](../../../docs/SCOUT_ENDPOINT_NOVELTY.md).

The separate selected seed `1276821265` still failed after 183.202 seconds, 80 actions and 24 scouts, with no cobblestone. Its journal shows five novel endpoints and intended adaptive 4-to-8-to-12 growth, but no starter completion. It was not substituted for the preselected cohort trial, which also failed.

The lost known pass `1744809425` stalled during wood gathering and pickup: repeated route-certification budget exhaustion, a mined log not acquired, and eventual refusal to begin another dig without enough time. Its only completed short scout occurred near the end, without a later scout using the new classification. That does not establish a causal regression from the novelty change. Planning-limit outcomes do not prove terrain is impassable. Original `718224` stopped near a hostile mob. Neither safety nor planning limits were relaxed.

## Protocol and integrity

Every accepted result records the exact frozen source, `dirty:false`, `trailhead-v1`, fresh natural terrain, normal survival, empty starting inventory, no supplied items or prepared terrain, an offline observation-driven controller and the same 300-second, 96-action and 24-scout limits. The existing pre-connection spawn-radius setup is disclosed in each result. Passing requires a stone pickaxe and furnace, positive health and being within 2.5 blocks of home. All 15 passes were independently checked against final inventory, health and home distance.

The 20 known seeds and separate original trio were fixed before execution, in the same order as the baseline. The benchmark/server harness and configuration are unchanged versus that baseline. Recorded environments match Node 24.19.0, Linux and Minecraft 1.21.8; version strings are not full binary reproducibility certification.

### Interrupted original-world attempt

The first `20260930` attempt was interrupted during gameplay when its execution environment ended. It has partial event journal, saved bot job state and server/harness logs, but no final result. Before recovery, process and result checks found no surviving driver, benchmark or Java process and no late result. A separately labeled second attempt passed in 77.495 seconds. All 22 previously completed outcomes and raw-result hashes remained unchanged. No completed failure was rerun or replaced. The interruption and recovery are a qualification of this complete comparison, not an undisclosed clean first attempt.

## Every accepted result

| Group | Seed | Outcome | Seconds | Reason |
| --- | --- | --- | --- | --- |
| known | 1014875191 | Pass | 147.747 | Observed a stone pickaxe and furnace in inventory, alive and back at the start. |
| known | 1041160109 | Pass | 129.110 | Observed a stone pickaxe and furnace in inventory, alive and back at the start. |
| known | 113919219 | Pass | 292.981 | Observed a stone pickaxe and furnace in inventory, alive and back at the start. |
| known | 1146093953 | Pass | 93.690 | Observed a stone pickaxe and furnace in inventory, alive and back at the start. |
| known | 1244186709 | Pass | 265.930 | Observed a stone pickaxe and furnace in inventory, alive and back at the start. |
| known | 1276821265 | Fail | 192.515 | Exploration budget exhausted: Repeated collect failure. Look for a different approach. |
| known | 1382194916 | Pass | 151.552 | Observed a stone pickaxe and furnace in inventory, alive and back at the start. |
| known | 1542908414 | Fail | 227.453 | Observed polar_bear attack: starter work paused. This attacker has no supported automatic retreat. The world keeps running; reach safety before resuming. |
| known | 1547703085 | Fail | 285.718 | Exploration budget exhausted: No supported tree logs are visible nearby. |
| known | 1576696577 | Pass | 68.999 | Observed a stone pickaxe and furnace in inventory, alive and back at the start. |
| known | 1587439118 | Pass | 108.409 | Observed a stone pickaxe and furnace in inventory, alive and back at the start. |
| known | 1744809425 | Fail | 291.978 | Not enough remaining time to confirm another mining operation; stopped before digging |
| known | 1888406977 | Fail | 0.120 | Powder snow is touching BroBot. Work stopped, but freezing continues. Move BroBot onto dry solid ground before resuming. |
| known | 355620996 | Pass | 102.176 | Observed a stone pickaxe and furnace in inventory, alive and back at the start. |
| known | 386690312 | Pass | 261.700 | Observed a stone pickaxe and furnace in inventory, alive and back at the start. |
| known | 454806089 | Pass | 112.319 | Observed a stone pickaxe and furnace in inventory, alive and back at the start. |
| known | 474859294 | Pass | 66.431 | Observed a stone pickaxe and furnace in inventory, alive and back at the start. |
| known | 61544722 | Fail | 300.023 | Starter job time budget reached. |
| known | 761598570 | Pass | 82.388 | Observed a stone pickaxe and furnace in inventory, alive and back at the start. |
| known | 924242050 | Fail | 300.015 | Starter job time budget reached. |
| original | 718224 | Fail | 54.092 | A hostile mob is too close for unarmored starter gathering. |
| original | 42 | Pass | 163.455 | Observed a stone pickaxe and furnace in inventory, alive and back at the start. |
| original | 20260930 | Pass | 77.495 | Observed a stone pickaxe and furnace in inventory, alive and back at the start. |

## Evidence package

`short-scout-evidence.tar.gz`: 774,970 bytes; SHA-256 `ba6135f4e61660a4c08118fce8a929bfd0a4a722c71b7a1b0c05318e28e684fd`.

The 137 members include all 23 accepted raw results and journals, the interrupted first attempt, the separate selected trial, prepared integration result, test logs, frozen plan and driver, recovery record and hashes of 168 tested source files. `manifest.json` records every member checksum. Archive members were read back byte-for-byte and audited independently.

Prepared integration uses supplied materials in later phases and is not natural survival evidence. The public Core 0.2 ZIP is unchanged. No rendered Windows/Bedrock client gameplay, paid-model evaluation, enabled private excavation or stable 1.0 claim is made. The separately developed query-skip evidence candidate is not present in this cohort.
