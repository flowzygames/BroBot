# Complete current source evaluation

Frozen application: `fb69b493054d0f1eca47ef1bca2cd12827876176` (merged PR 85). Completed October 7, 2026 at 9:52 PM ET. This is development evidence, not a new public download or a stable release.

| Check | Result |
| --- | --- |
| Local syntax and automated checks | 1,016 passed, zero failures |
| Prepared real Minecraft integration | 17/17 phases |
| Known-world starter kit and return home | 14/20 |
| Separate original development worlds | 3/3 |
| Postmerge source and extracted-artifact CI | All six jobs passed |

[Postmerge CI](https://github.com/flowzygames/BroBot/actions/runs/37702411686) includes Linux and Windows on Node 22/24 and both extracted-release gates. Linux reports 1,016 passes; Windows reports 1,015 passes and one expected POSIX-file-mode skip. The release gate exercises installation and actual launcher refusal, not graphical Minecraft gameplay.

## Natural world outcomes

All 23 completed evaluations used a clean frozen application, the existing 300-second Trailhead protocol, fresh natural terrain, empty survival inventory and the offline starter. The original three worlds completed in 128.984 seconds (718224), 147.361 seconds (42) and 85.638 seconds (20260930), alive with a stone pickaxe and furnace back at the starting area.

The same 20 known worlds previously scored 13/20 on frozen `5b66f11`. This run retained all 13 earlier passes and additionally completed seed 1014875191. These small repeated known-world outcomes do not isolate a causal fix or estimate unseen-world reliability. The six incomplete worlds remain in the record:

| Seed | Outcome |
| --- | --- |
| 61544722 | 300-second time budget reached |
| 924242050 | 300-second time budget reached |
| 1276821265 | 96-step budget reached without cobblestone |
| 1542908414 | Paused after an observed polar bear attack; no supported automatic retreat |
| 1547703085 | Exploration budget exhausted without supported visible tree logs |
| 1888406977 | Stopped on powder snow; stopping work does not stop freezing |

Safety stops are incomplete starter attempts, not successes. Private soil excavation remains disconnected from automatic starter routing. This run does not establish indefinite survival, food production or completion of Minecraft.

## Preserved evidence and infrastructure

`main1016-evidence.tar.gz` retains all 23 complete results, event journals, saved runtime memory, server logs, source-file hashes, the fixed cohort plan, prepared results and harness logs. Every archive member was read back and compared with its original bytes. `manifest.json` records archive and member SHA-256 checksums.

Two infrastructure interruptions are separate from gameplay outcomes:

- The first prepared smoke attempt failed before gameplay because Java could not resolve the Mojang download host. The unchanged retry used the previously downloaded official jar, verified against Paper's embedded SHA-256, through a cache-preseeding Java wrapper. It passed all 17 phases and saved/stopped the server.
- After 18 completed known-world attempts, the executor was interrupted while seed 761598570's server was preparing its level. No bot had connected and no result existed. Its partial startup log was retained. Only that incomplete attempt was restarted; the final seed had not yet been started. No completed gameplay result was replaced.

The prepared suite uses supplied materials and console-prepared terrain for some phases; it is not a natural-world score. Actual graphical Windows/Bedrock-client gameplay and live paid-model planning remain unverified. Public Core 0.2, its frozen 11/20 score, the website download and pricing remain unchanged.
