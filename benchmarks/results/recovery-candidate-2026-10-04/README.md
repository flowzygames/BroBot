# Integrated reliability and recovery candidate

This branch consolidates reviewed changes from draft pickup, collection, return and scout work plus a bounded automatic canopy fallback. It is not a new public release.

## Changes

- Starter-only unchanged-drop deferral, with direct commands still able to retry
- A bounded passive landing observation after failed pickup; failed movement is not reported as successful arrival
- Reuse of untried collection candidates within one unchanged action, with fresh hazard and route checks
- Ignore unrelated distant block updates only for candidate-list invalidation; updates within radius + 2 blocks, unknown geometry, chunks, movement, dimension and boundary changes still invalidate
- Validated persistent return waypoint-arrival aliases to avoid nominal-versus-actual arrival cycles
- Avoid equivalent completed non-novel scout endpoints across slightly different trip lengths
- After two explicitly typed crafting-table egress failures, permit at most four distinct-cell attempts using the existing certified one-leaf descent action, only with healthy grounded canopy evidence

454 automated checks pass on byte-identical application, scripts and tests from d488d2e3690e1cab9512b0c45076844eb5712472. Read-only component reviews found no blocking defect. The distant-update regression changes eight redundant candidate scans to one plus seven reuses with the same failed targets. This does not prove which invalidation caused live-world rescans, or that any rejected route is traversable.

## Prepared canopy proof on earlier 451-check source

The attached raw result was produced by eef03cf1c349c772000b20135781eee2d5f860ae, before the distant-block-update optimization. A peaceful console-prepared ledge used persistent leaves and disabled random ticks. The normal controller encountered two typed workstation egress failures, chose one certified adjacent leaf descent, actually moved grounded from Y66 to Y65 while retaining its home support, then crafted a wooden pickaxe. The harness separately requested a certified return and observed grounded arrival. No health-loss event or cleanup error was observed.

This is neither a natural-world reliability score nor an autonomous completed starter kit. Three selected natural-world diagnostics on that 451-check source are retained separately and are still running at the time of this note. A new pass in a familiar seed is not causal proof of a particular fix.

## Promotion gate

Keep draft until the integrated source has completed physical verification and evidence review. Do not relabel the public Core0.2 ZIP, benchmarks, download checksum, or website from these candidate counts. Experimental hostile-hit interruption and stone-entry excavation are excluded.
