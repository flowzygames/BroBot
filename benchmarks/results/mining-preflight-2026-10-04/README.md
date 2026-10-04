# Mining candidate preflight

The Core 0.2 seed 386690312 trace shows two successive zero-progress collect calls spending 6.729 seconds on repeated liquid-adjacent stones. Eight unsafe targets exhausted the action failure allowance before a farther safe target could be tried.

Current terrain vetoes (waterlogged target, liquid/unloaded side-or-upper neighbors, and overhead falling blocks) are now filtered before candidate count caps and path planning. They are recomputed each search, never permanently blacklisted. Harvest-time checks remain and are repeated after tool equipping. Pose-dependent support, reach and tool checks remain post-approach. This does not eliminate changes during Mineflayer's internal look/dig interval.

355 automated checks pass. Three new regressions fail on the preceding source: starvation by eight unsafe targets; no route planning for static hazards plus retry after removal; and liquid appearing during tool equip. A fourth uses the installed real Mineflayer iterator: 672 unsafe stones previously fill the 512-candidate cap and hide a safe stone at (40, 64, 0); filtering lets collection mine the safe stone.

One selected fresh natural-world replay used clean source f5c16247b389e59078193cfabfaf0003dbd33ff0. The application files match the accompanying manifest. Publication adds the stronger real-iterator unit fixture without changing runtime code. World 386690312 still failed after 202.291 seconds, stopping during gathering at 6.00000095 health. It carried one cobblestone, not a completed starter kit. No adjacent-liquid refusal appeared in this run's action log; no general survival improvement is claimed. The source of injury is unconfirmed.

This is a selected diagnostic, not a replacement for the frozen Core 0.2 cohort or original-world regression. The published download remains Core 0.2 with 346 checks and its original 11/20 and 1/3 results.
