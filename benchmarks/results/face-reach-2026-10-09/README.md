# Block-face reach broad phase: less geometry work, no survival gain shown

Frozen published application [`7c800b971ac4acf5d0f03459ff7b556398e430bc`](https://github.com/flowzygames/BroBot/commit/7c800b971ac4acf5d0f03459ff7b556398e430bc), tree `a7ef5fa8a5b859ced586c581ef7ffa6cd85821df`. Local automated/prepared source `89aa9d99e264088bdbc8dbcd2f3384698375da35` has the identical tree. Completed October 9, 2026, Eastern Time. Prepared result format does not itself certify the commit.

## Verified change

A* mining goals test block-face visibility for each expanded node. Eyes obviously outside reach previously allocated seven centers and their direction/distance vectors before rejecting every center. Six strict axis comparisons now reject only eyes outside the target's reach-expanded unit cube. Near, boundary and diagonal cases retain the original ray loop. Non-finite or coerced reach arguments retain the prior fallback. [Contract and limitations](../../../docs/BLOCK_FACE_REACH_BROAD_PHASE.md).

There is no visibility cache, stale terrain reuse, changed heuristic, increased planning allowance, relaxed route/mining check or enabled private excavation.

- **1,103/1,103 automated checks passed.**
- **17/17 prepared Minecraft phases passed**, including mining, navigation, crafting and later supplied-material phases.
- Seven new deterministic tests compare the frozen legacy algorithm's Boolean results and exact ordered ray arguments across grids, negative/fractional and world-border coordinates, reach boundaries, absent/blocked hits and live occlusion changes.
- The far-probe fixture previously allocated 21 target centers across three eyes; it now allocates zero, with zero rays in both cases. A fixed 1,089-node grid reduces target-center allocations by more than 75 percent while preserving ray counts. These are work-count assertions, not elapsed-time benchmarks.
- Independent review found no correctness blocker for finite Minecraft world coordinates.
- All six exact-head jobs and all six identical-tree merge-candidate jobs passed: [source CI](https://github.com/flowzygames/BroBot/actions/runs/37923500777), [merge CI](https://github.com/flowzygames/BroBot/actions/runs/37923532969).

## Both selected natural checks failed

The seed order was fixed before running: lost wood-planning case `1744809425`, then difficult canopy case `1276821265`. Both used the exact clean published source, fresh natural terrain, normal survival, empty starting inventory, no supplied items/prepared terrain/paid model, and unchanged 300-second/96-action/24-scout limits. The existing pre-connection spawn-radius setup remains disclosed in raw results. These two selected cases are not a new full-cohort score.

| Seed | Outcome | Seconds | Actions | Scouts | Stop |
| --- | --- | --- | --- | --- | --- |
| 1744809425 | Failed | 294.602 | 42 | 8 | Insufficient remaining time to confirm another mining operation; stopped before digging |
| 1276821265 | Failed | 76.254 | 40 | 21 | No bounded exploration target remained inside the job area |

Both finished with health and food 20/20 and without cobblestone. The first retained only a crafting table; the second retained an unused wooden pickaxe, three spruce planks, two sticks and three spruce logs. There were no interrupted attempts or replaced completed outcomes. Servers saved and stopped normally.

The canopy run's faster failure is **not** a speed or reliability improvement. Neither trial identifies the cause of a previous failure or demonstrates improved completion. Planning-limit and no-path outcomes must remain distinguished. The latest full development cohort is still **13/20 known worlds and 2/3 separate originals on older `a2bdfd00`**; it has not been repeated on this patch.

## Retained evidence

`face-reach-evidence.tar.gz`: 104,600 bytes; SHA-256 `88642d873938ec2198e16965ae0504b7202b2fa6f810369c6bb88f4518434f93`. The 19 members contain both complete natural results, journals and saved bot job states, server/harness logs, prepared result/log, pre-fix and passing test logs, selected plan and hashes of 169 tested source files. `manifest.json` lists every member checksum. Members were read back byte-for-byte.

Public Core 0.2's packaged ZIP is unchanged. Prepared checks use supplied materials in later phases. Graphical Windows/Bedrock gameplay, paid-model planning and stable 1.0 remain unverified; no release or survival-readiness claim follows from this optimization.
