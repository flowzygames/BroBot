# Return-probe context

In the frozen 413-check evaluation, seed 1744809425 crafted both kit items but stopped at 245.583 seconds after eight inconclusive return-planning-budget failures. Health remained 20. Saved terrain showed that an earlier canopy waypoint had lost its support. These facts do not prove a surviving route home or that this correction would recover that world.

Three separate deterministic controller regressions failed on the old source:

1. A failed edge from a previous pose suppressed a distinct standing pose 1.9 blocks away because the edge exclusion used a two-block halo.
2. Two failed go_to counts transferred to a newly observed pose before any attempt from that pose.
3. Explicit resume rejected the old candidate graph before performing any new observation.

The correction narrows endpoint matching to 0.1 block, associates failed travel counts with the actual action-start position, and clears candidate edge exclusions on explicit resume. Walking still requires the same bounded safety certification. No path is assumed, no completion is invented, and per-run step/time budgets remain unchanged. Unchanged failed poses still exhaust their attempts.

421 automated checks pass. The three new regressions and existing alternative-shortcut tests pass, and read-only review found no blocker. Physical verification is pending. No natural-world success gain or new public release is claimed.
