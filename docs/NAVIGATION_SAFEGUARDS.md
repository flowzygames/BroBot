# Collection navigation safeguards

Local follow-up to the planner and exposed-block selection patches. No change to mining/building permissions, global movement safety settings, or paid AI access.

## Changes

- Before collection-related travel, plan an outbound route and a walking return route to the action's starting cell using the existing no-dig/no-scaffold/no-parkour movement policy.
- Require completed successful plans, not partial/timeout results. Navigate to the exact verified endpoint rather than letting a block-face goal choose an unverified alternative endpoint.
- Bound planning by short generator slices, a per-round-trip budget and a total collection planning budget. Honor cancellation between slices.
- For dropped items, require loaded support and headroom; try a small bounded set of adjacent standing cells instead of navigating into an obstructed item cell.
- Item-aware pickup navigation releases its own goal and listeners as soon as the target is collected/disappears. Disappearance does not count as a verified inventory gain.
- Bound each pickup navigation attempt by local timeout and stalled movement. Preserve caller cancellation and never clear a replacement movement goal.

## Verification

101 tests and syntax checks pass. New coverage includes one-way descent rejection, valid reverse routes, partial/timeout/terrain-modifying plan rejection, planning cancellation, item acquisition/disappearance, wrong-item events, stalled replans, local deadlines, goal replacement, unsafe headroom and listener cleanup.

A targeted real-server replay of the formerly failing log fixture gathered all four logs and all four inventory drops in about 16 seconds, instead of pursuing a vanished first drop until the 45-second deadline.

The preserved ordinary-world cave replay rejected all eight candidate routes because return walking was not verified. The bot stayed at its starting position with inventory intact, and the home command succeeded. This prevents the reproduced trap; it does not find an alternative source of stone or claim the stone-tool progression is complete.

The unchanged full real-server fixture suite passed all 16 phases, including gathering, crafting, building, furnace, owner commands, Stop, portal activation and End entry. Run: 2026-09-30T23-23-13-224Z-4b4c7508. These prepared scenarios are not an autonomous survival run.

## Limits

Preflight establishes paths in the currently loaded world. It is not a proof against later terrain changes, moving entities, movement drift, interruption midway through a route, or mining away a block used by the planned return route. Planning budgets can conservatively reject a route that would be found with a longer search. Long pickup trips may require another bounded command. No automatic rescue digging/building was enabled.

Tests are direct server controls and deterministic planner simulations, not live-model autonomous play or rendered Windows-client verification.
