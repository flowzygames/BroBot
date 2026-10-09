# Mining stance support: deterministic correction, selected natural failures remain

Tested published source [`97a6eb1895171ece9513f7cc0a59834969b3fd8d`](https://github.com/flowzygames/BroBot/commit/97a6eb1895171ece9513f7cc0a59834969b3fd8d), tree `9df88cb250d65eb9ef44ce4c1df04844dd66a6e3`. Local prepared source `085f6b7ff2d4a60b1ef3e10a8d40a5371ba3568d` has the identical tree; prepared result format does not independently certify a source commit. Completed October 9, 2026, Eastern Time.

## Correction and limits

The rejection-only mining preflight no longer treats clear but unsupported air cells as ordinary reachable standing cells when scaffolding is explicitly disabled. Original initial-node exceptions are retained. Liquid, partial, unloaded and climbable support cases remain unknown rather than falsely rejected. The bounded envelope accounts for the support row.

Mining interaction goals now reject the exact column-underfoot endpoint already prohibited by the live mining guard. Generic placement/workstation goals and direct visible underfoot refusals remain unchanged. No safety or return rules, planning allowances, route certification or private excavation permissions were relaxed. [Contract](../../../docs/MINING_STANCE_SUPPORT.md).

- Initial full check: **1,110/1,111**, with a timed canopy-descent positive fixture returning null. The failure log is retained.
- Isolated unchanged canopy checks: **10/10**; unchanged full recheck: **1,111/1,111**.
- Prepared Minecraft: **17/17 phases passed**, including supplied-material later phases.
- Independent source review found no blocker. Deterministic fixtures demonstrate unsupported-air and self-support endpoint mismatches; they do not prove these caused prior natural failures.
- All six exact-head and six merge-candidate CI jobs passed: [source CI](https://github.com/flowzygames/BroBot/actions/runs/37981585670), [merge CI](https://github.com/flowzygames/BroBot/actions/runs/37981629818).

## Selected natural outcomes

The predeclared order was seed `1744809425` followed by `1276821265`. Both ran the clean published source in fresh natural normal-survival worlds, empty inventory, no supplied items, no prepared terrain and no paid model. The unchanged limits were 300 seconds, 96 actions and 24 scouts. Pre-connection spawn-radius setup is disclosed in raw receipts.

| Seed | Result | Seconds | Actions | Scouts | Stop |
| --- | --- | --- | --- | --- | --- |
| 1744809425 | Failed | 300.041 | 76 | 17 | Starter job time budget reached |
| 1276821265 | Failed | 98.196 | 64 | 17 | No bounded exploration target remained inside the job area |

Both ended at health and food 20/20 without cobblestone. The first retained one crafting table. The second retained an unused wooden pickaxe, two sticks and three spruce planks. No interrupted attempts or replacement of completed outcomes occurred.

The preflight rejection message appeared as the top-level collection error once in the wood trial and twice in the canopy trial; these are not complete per-candidate counts. The wood journal also contains 40 top-level collection noPath errors. Changed error mix and more actions do not establish causality or improvement.

These selected cases show no completed survival gain and are not a new full-cohort score. Differences in duration or action count are not evidence of improved reliability. The latest full development cohort remains **13/20 known worlds and 2/3 separate originals on older `a2bdfd00`**, not this patch. Existing journals do not reliably distinguish forward-route rejection from reverse certification failure; a separately tested diagnostic change is needed before attributing those failures.

## Evidence

`mining-stance-evidence.tar.gz`: **169,677 bytes**, SHA-256 `e592b818f141f8fbb4d229364c9fb29a63b45e34871a30d1a06bf8f6092afe0c`. All 23 members were read back byte-for-byte. It retains both natural results, complete bot journals and saved job state, server/harness logs, prepared result/log, initial failing and passing test logs, selected-run plan, Java cache wrapper and hashes of 172 tested source files. `manifest.json` lists every member checksum.

Public Core 0.2's packaged ZIP is unchanged. Rendered Windows/Bedrock gameplay, paid-model planning and stable 1.0 remain unverified. This source correction is not a new packaged release or a readiness claim.
