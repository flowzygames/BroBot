# Bounded multi-log foliage recovery

A ray toward the first observed trunk block can pass through an existing gap,
even when another part of the same tree is behind a reachable leaf obstruction.
The earlier observation path stopped after that first ray and could consume
scouting attempts without noticing another useful local clearance.

The prototype samples up to 128 observed logs within the unchanged 48-block
radius, then selects the nearest sixteen from that bounded sample. A small raw
cap can fill in one chunk section before considering a closer tree across its
boundary. The foliage helper examines up to sixteen logs of the selected species. Every ray keeps the 4.2-block reach limit. Only a
visible loaded leaf at or above the current feet can be proposed. Waterlogged
leaves, fluid-bearing or unknown adjacent cells, and overhead falling blocks are
rejected. All six neighbors are checked. Normal dig_at revalidates the real
block and support before mining. The existing four-clearance cap is unchanged.

The saved canopy fixture reproduces a missed later-log obstruction and verifies
that its hypothetical removal opens a supported cell with both an outward and
an exact-origin return route. The observed log sample was reconstructed from
the retained final world, not captured as a separate live observation event.
This fixture is static selection and geometry evidence. The subsequent live
results below establish partial wood acquisition, but not full starter completion.

## Experimental validation, October 1, 2026

Application commit: `42e5d8708e82f1d8e024e82e0780642eb5184529`.
This prototype remains unpublished; the downloadable build is the separately
validated 219-check transit-recovery version.

- 225 automated checks passed
- 20 local control cases passed
- 17 prepared live phases passed
- 11 prepared skill cases passed

All five natural cases are retained, including failures:

| World seed | Starter result | Seconds | Observation |
| --- | --- | ---: | --- |
| 924242050 | Failed | 122.565 | Three leaf clearances, wood collected, wooden pickaxe crafted; stone remained unreachable |
| 8675309 | Failed | 300.013 | Benchmark time limit |
| 42 | Failed | 102.809 | Hostile-world failure |
| 718224 | Passed | 100.098 | Full starter completion |
| 20260930 | Passed | 80.227 | Full starter completion |

These are known-case experiments, not a fresh random-world reliability estimate.
The earlier 9b1 prototype and its failed cases are retained separately. Do not
combine successful runs across versions or substitute a retry for a failed run.

## Remaining canopy barrier

The saved failing world has an exhausted 111-node reachable walking component,
with standing heights Y85–86. The surveyed stone targets at Y63–72 are not
connected under the existing movement rules. The survey encountered no unloaded
blocks, and changing the six scout goals did not create a route. Larger search
budgets alone are therefore not a demonstrated solution.

## Prepared one-plank construction experiment

A separate harness, not integrated into the production controller, copied the
failed world, reconstructed the recorded inventory and position, and controlled
mobs, weather and random ticks. It placed one plank using a verified visible
attachment face, stepped onto it, waited for actual ground settling, and returned
to the staging point and home. All six phases passed, health remained 20, no
death or respawn occurred, and exactly one plank was consumed.

The landing height was Y85, which does not extend below the original component's
minimum height. This proves one reversible placement-and-step primitive only.
It does not demonstrate an escape from the canopy, a complete descent, stone
acquisition, or autonomous construction. Earlier harness failures are retained:
an incorrect planning argument in v1 and a premature landing assertion in v2.

A future controller must establish actual frontier improvement, preserve a route
home after each world mutation, check the specific attachment face, use owned
materials, and verify physical settling. Existing drop, parkour, scaffolding,
clearance, and benchmark limits have not been relaxed.

## Experimental explicit one-leaf descent action

The unpublished prototype now exposes `action descend_notch {}`. It attempts
only one adjacent, one-block-lower leaf notch from the current grounded position.
It does not select a distant staging point, excavate a complete trunk staircase,
or run automatically inside `survive starter`.

Before mining it requires health at least 12, food at least 10, a visible dry
leaf, supported headroom, hypothetical routes out and home, and retained log
anchors for nearby leaf supports. Planning is bounded to eight adjacent
candidates and 400 ms total, with a 50 ms cap per route search. Mining rechecks
the actual stage after tool selection. Execution is limited to certified route
cells, stops on relevant terrain changes, waits for physical ground settling,
and has a 20-second cancellation deadline. A refused plan is not a success.

Prepared live evidence includes a one-notch action followed by a safe return,
and a separate four-dig scripted trunk segment reaching Y83. A ten-second
normal-random-tick observation retained the home support. This short observation
is not proof of long-term survival. Earlier setup failures are preserved: the
planner correctly refused when movement had not yet been configured safely,
and when its loaded-world preconditions were not established. The initial
scripted trunk attempt also stopped safely after pickup moved the bot over the
next intended dig.

The longer geometry-only trunk spiral needs roughly forty removals. It remains
unimplemented and untested live. Existing starter budgets have not been raised.
The last full automated check of this experimental action passed 245 tests;
this does not change the published 219-check build or its 10-of-20 score.

The same experimental application also passed all 17 prepared live regression
phases and all 20 local command/control cases. These are regression checks,
not a new natural-world starter score.
