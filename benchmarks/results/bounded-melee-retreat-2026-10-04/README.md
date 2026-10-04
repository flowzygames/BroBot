# One bounded melee retreat — October 4, 2026

## What changed

An explicitly observed hostile hit interrupts active starter work. The old
physical action and ActionRunner must both settle before a private recovery
operation can start. Unconfirmed mining still quarantines terrain and prevents
recovery. Ordinary gathering never resumes automatically afterward.

For an observed zombie, husk or zombie villager, recovery can attempt one short
flat retreat. It passively observes knockback and supported ground, considers
four local destinations, and validates bounded outward/return routes. It does
not dig, place, open doors, jump, drop or attack. Unknown terrain, unsupported
threat types, player conflicts, lost support, relevant block/chunk changes,
repeat hits during movement, cancellation and the original eight-second incident
deadline prevent a successful receipt. The destination must show at least four
blocks of observed separation and two blocks more than the grounded origin.

The initial grounded branch waits 150 ms before accepting two samples at least
40 ms apart. This reduces an observed hurt/knockback packet race; it is not a
network-ordering guarantee. Descending knockback retains the existing bounded
passive-landing check. Movement still aborts if it becomes airborne.

Both node supports and swept diagonal corner supports are protected. Remote
leaf-anchor changes and intersecting chunk events invalidate the corridor;
distant chunk streaming does not. Unknown event coordinates fail closed.

The latest requested receipt is saved after initiating cancellation, so a
process restart during action drain does not show the previous successful
attempt. A write failure prevents retreat; terminal save failure retains the
existing fatal runtime-shutdown policy. Ownership cleanup still runs. The real
Memory write/rename path is tested, but power-loss durability is not established.

## Frozen evidence

Final implementation source: `68bc28ae21b4c91bcf8b57186deff72378cb4704`.
589 aggregate automated/syntax checks passed. Three fresh, predeclared prepared
trials used ordinary zombie-family entities in a flat dry night arena:

| Attacker | Real hits before recovery | Initial separation | Final separation | Result |
|---|---:|---:|---:|---|
| Zombie | 2 | 1.630 | 7.398 | One grounded retreat, then paused |
| Husk | 1 | 2.281 | 7.073 | One grounded retreat, then paused |
| Zombie villager | 1 | 1.937 | 7.010 | One grounded retreat, then paused |

Distances are blocks from the observed attacker. No fake damage, altered mob
speed or teleport recovery is used. Each attacker remains present until recovery
ends, then the harness removes it for cleanup. All three cases recorded actual
movement controls, zero digging/attacking, a connected paused job and all seven
controls clear at termination. These are three controlled cases, not a natural
survival success rate.

The normal prepared integration suite also passed **17/17** on this final
frozen source. `raw-results.tar.gz` retains all final trials and earlier failed
attempts; `manifest.json` records their byte hashes and tested source files.
The normal suite has no commit field; the frozen execution checkout establishes
its provenance. A separate predeclared three-known-world, 300-second compatibility run
completed **0/3**: 454806089 paused after a skeleton hit (unsupported retreat
threat); 924242050 exhausted bounded exploration without obtaining stone;
1744809425 reached the 300-second job deadline while a mining operation was
active, causing the existing unconfirmed-edit quarantine/disconnect. No natural
retreat success is claimed. `selected-589.tar.gz` retains the plan, raw results,
logs and frozen source manifest. These known cases are not a causal A/B test,
held-out sample or replacement for the earlier full cohort.

## Earlier attempts retained

- A setup attempt lacked the shared previously accepted EULA/cache. No server
  started and no new agreement was accepted. Another attempt refused a dirty
  checkout caused by an evidence directory; it also did not start a server.
- `7d77618` failed its real retreat: two catch-up grounded ticks preceded delayed
  knockback. The walk correctly stopped airborne. The observation-window fix
  was then added.
- `a60c867` failed on the conservative all-chunk invalidation rule. The original
  event's coordinates were not captured, so it is not labeled an irrelevant
  event. Relevant-corridor filtering and raw chunk logging were then added.
- `7bc5ed8` passed one prepared zombie retreat (2.054→6.777 blocks) and all 17
  normal prepared phases before the persistence change. This is predecessor
  evidence, not relabeled as the final source.

## Limits

This is momentary observed spacing, not ongoing defense, invulnerability,
automatic safe resumption, combat strategy, or full-game competence. Unsupported
threats or unverified terrain may still leave the bot paused in danger. A second
hit while work drains can occur, as the zombie case demonstrates. The world
continues running after pause.

Earlier full-cohort scores and public downloads are unchanged. No new full
benchmark score, stable 1.0 release, Windows gameplay proof, Bedrock rendering,
competitor superiority or Vercel deployment is claimed. The earlier selected 543-check
natural trials completed 0/3 and remain separately recorded in the predecessor
[interruption experiment](https://github.com/flowzygames/BroBot/pull/53).
