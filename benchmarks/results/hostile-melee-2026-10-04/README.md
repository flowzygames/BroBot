# Observed hostile-hit interruption — October 4, 2026

## Behavior

An own-entity hurt observation with an explicitly hostile source now interrupts
active starter work before diagnostic journal I/O. Eating, direct controls,
retired connections, already-aborted work and lethal-health handling retain
their previous behavior. Health packets remain separate observations; they are
not joined to invent a damage cause.

This is the previously held PR 40 component, integrated onto the current source.
It stops work, not the Minecraft world. It does not fight or retreat, prevent a
later hit, or establish improved survival. A hit during an attempted unconfirmed
dig can intentionally trigger the existing terrain quarantine/disconnect policy.
The physical proof below is pre-dig and does not weaken that policy.

## Source and automated verification

Final frozen source/harness: `2f74d081f2e908e06d5918cdcfdad31a757499f5`.
The identical application and test files passed **547 automated checks** before
subsequent harness-only corrections; each final harness was syntax checked and
actually executed. File hashes are recorded in `tested-files.json`.

## Controlled real melee

`melee.json` records a flat dry prepared arena at night, an actual offline
starter job collecting distant logs, and one ordinary summoned zombie ahead of
the route. There was no fake hurt event, injected damage command or altered mob
speed. The observed attacker ID matched that one zombie.

The first own hostile hit was observed during `collect`; the action was then
aborted, the goal cleared and all seven control inputs verified false using
`getControlState`. No dig occurred before or after the interruption. The starter
job paused and the connection remained present until harness cleanup. The
harness removed the zombie only after the recorded stop, so this does not prove
protection from subsequent attacks. The separate health packet recorded 20→17.

The normal prepared integration suite also passed **17/17 phases** on the frozen
source (`prepared-17.json`). Its raw format has no embedded commit field; source
provenance comes from the frozen checkout and verified file equivalence.

## Retained unsuccessful setup and evidence corrections

- `invalid-reactive-spawn.json` and `invalid-disabled-monsters.json`: inherited
  smoke settings had `spawn-monsters=false`; no valid melee encounter occurred.
  These are failed harness setups, not application passes. The first shutdown
  interrupted a dig and correctly invoked existing terrain quarantine.
- `limited-control-capture.json`: real hit/abort/paused-job evidence, but object
  spread omitted nonenumerable control getters. Its empty controls object did
  not prove controls were off. The authoritative final rerun explicitly reads
  all seven controls.
- `interrupted-startup.log`: a normal-suite attempt stopped when execution's
  automatic review was cancelled during startup. It has no result and is not a
  pass. The final normal run was performed only after ports/processes were clear.

## Selected natural-world results before this interruption patch

`selected-543.tar.gz` retains all three predeclared known-world attempts on
`00f213a7532ef20afddd202f095d72e589ea93fc`: **0/3**.

- 454806089: failed 69.635s after observed zombie hits and airborne settlement
- 924242050: failed 101.697s on stone-route/exploration exhaustion
- 1744809425: failed 253.054s on log-route/exploration exhaustion, only a table

All retained terrain trust; no receipt/quarantine or explicit inventory-accounting
error was recorded. The formerly passing control's failure is not evidence of a
leaf-landing false refusal: saved terrain was grass/air and the player airborne
after hostile contact. Fresh mob/timing differences prevent causal comparison.
These selected results are not a full score and do not replace the older full
cohort. No natural-world result is claimed for this new interruption patch.

Archive: 49,476 bytes; SHA-256
`28e41e5538926f6acff1155feff3ecd092b722697430f020bcb2f1887d066b4a`.
No public website/ZIP deployment or stable 1.0 release is implied.
