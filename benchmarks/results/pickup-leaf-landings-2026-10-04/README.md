# Starter pickup leaf landing checks — October 4, 2026

## Bug and fix

A dropped item's destination could be a detached natural leaf even though the
existing collision-based forward/reverse route planning succeeded. Such a cell
had not necessarily become a saved home or retained arrival, so protecting those
positions during mining did not prevent this pickup decision.

Starter-scoped pickup now requires the existing bounded retained-log proof for
leaf cells under its proposed landing footprint. It checks candidates, checks
again after awaited planning, and checks the actual landing during arrival,
exception/passive settlement, and before returning after inventory settlement.
Near-integer standing heights use the existing 0.03-block tolerance. Ordinary
direct pickup without starter scope is unchanged.

## Verified source

- Frozen clean application and harness: `b13628ba4af0faef0d4cf1b6b48c8b6ef86d85ad`
- 530 aggregate syntax/automated checks passed
- Seven new regressions cover detached/anchored destinations, direct-action
  compatibility, anchor loss during planning and after arrival, failed-path
  settlement, height jitter, footprint edges and unavailable evidence
- The first regression run demonstrated the old detached-destination and
  postarrival failures. The planning regression was subsequently corrected to
  mutate in generator cleanup, which the route planner executes before moving
- `tested-files.json` records SHA-256 hashes for the changed code/tests/harness

## Controlled Minecraft result

`controlled-landings.json` records a fresh Java 1.21.8 world, console-prepared
stone approach and leaf destination, peaceful mode and disabled random ticks.
Real movement and inventory packets were used; no fake collection events.

1. Detached leaf: no retained anchor, selected neighboring stone goal `(1,64,0)`,
   genuinely collected one oak log and stopped grounded on stone
2. Anchored leaf: retained log at `(2,62,0)`, selected leaf goal `(2,64,0)`,
   genuinely collected one oak log and physically stopped grounded on oak leaves
   at approximately `(2.43475875,64,0.5)`

Both ended with verified landings, health 20 and no remaining drops. No health
loss events or cleanup errors were recorded. The raw result includes source
hashes, before/after state, selected goals, anchor proof and final support.

## Limits

The normal prepared integration suite also passed **17/17 phases** on the same
frozen clean worktree (`prepared-17.json`). Its raw format does not contain a
commit field; provenance comes from the frozen worktree and matching application
files, not an invented field. It includes four survival logs mined and collected,
crafting, smelting, equipment, cancellation, owner commands and prepared portals.
These normal controls do not independently exercise every anchor-loss race.

This certifies these controlled landing decisions, not every block along the
route. A path crossing a detached leaf bridge toward a stone destination remains
outside this patch's guarantee. It is not a leaf-decay timing experiment or an
autonomous starter-world completion. The existing six-leaf/512-node anchor
proof, planning/retry/time caps and no-terrain-edit movement policy remain.
There is no new full natural-world score or stable 1.0 claim. The public Core 0.2
download is not updated by this source patch.
