# Starter scouts can use a safe adjacent landing

October 5, 2026 UTC. Tested source `2b5345bb38cdf809497b6b335f0c21695488f8c4`.

## Defect and change

The saved final world from selected seed 924242050 contained a returnable canopy route to the column next to an unreachable nominal scout target. Exact-column scouting discarded it. Starter-scoped returnable scouts now accept a one-block horizontal goal region, retain the existing minimum travel distance, certify both route directions, and check boundary membership for route nodes, standing centers, selected endpoints and observed final position. Direct exploration retains exact-column goals.

Four candidate directions, shared planning time and starter work limits are unchanged. Existing saved jobs migrate only when explicitly resumed: legacy unverified scouting attempts are reconsidered once, while successes, counters and observations remain. New failed attempts retain the new goal policy, including fractional-position endpoint matching.

## Evidence

- 625 automated checks passed on the unchanged application/test tree; the final replay harness was subsequently syntax-checked and physically executed. The manifest records every tested application, test and harness file.
- `prepared-17.json`: all 17 normal prepared phases passed on the clean frozen source. One pickup-no-progress attempt recovered; all four logs were collected.
- `replay.json`: copied the completed natural-world snapshot, verified all 3,024 recorded block-state cells, and used the exact saved player pose. The test-only exact-goal comparator failed without movement. The production starter-scoped scout then moved 7 blocks to a reachable landing and returned to within approximately 0.962 blocks of its starting pose. No digs or placements occurred, inventory was unchanged, sampled health remained 20, controls were cleared, and original evidence hashes were unchanged.
- `test/fixtures/scout-924-landing.json` retains the sparse world cells, player pose, entity collision inputs, anchored-leaf proofs, dependency versions and original snapshot hashes. Unlisted cells remain unknown. The regression exercises the pinned pathfinder rather than inventing a route.

## Limits

The comparator substitutes the old exact goal inside current guards; it does not execute the entire historical binary. The harness requests a direction and return, with random ticks frozen. This proves the local landing mechanism in that copied world, not autonomous starter-kit completion or a fresh natural-world score. Route certification and final-position checks do not guarantee every physical position during replanning.

The latest complete natural cohort remains 13/20 known worlds plus 3/3 separate originals on source 5b66f11. The selected 589-check 0/3 remains retained. Neither score is replaced by this controlled replay. The public download remains unchanged.
