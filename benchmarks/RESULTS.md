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
