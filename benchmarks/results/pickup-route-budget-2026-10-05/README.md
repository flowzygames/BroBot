# Admit starter pickup travel before movement

Frozen tested application and final fixture: `7bab666f53492ce5082c917b65eee80112fc4c78`.

A previous selected-world pickup planned a long ascending detour toward a nearby item, then timed out while airborne. The existing fatal grounded-stop safeguard correctly stopped work. This patch adds a pre-motion admission policy so starter pickup does not begin an already-certified route whose estimated cost exceeds its remaining pursuit allowance.

## Policy and tradeoffs

Cost is rounded up from 750ms plus 350ms per horizontal block, 500ms per ascending block and 250ms per descending block. These are conservative policy constants, not measured travel-time bounds. The estimate uses actual position, copied forward standing-cell geometry and allowance remaining after route planning. It does not lengthen the six-second per-pursuit ceiling or consume the reserved passive-settlement allowance.

Only starter-scoped pickup uses the admission policy. Direct pickup is unchanged. Existing returnability, terrain, anchored-leaf, cancellation and final grounded-stop checks remain. Execution can replan, and collisions or lag can still cause an admitted pursuit to time out.

Budget refusal emits `PICKUP_ROUTE_BUDGET` before any navigation goal starts. It retains the item and tries bounded alternative destinations without marking a failed landing or adding durable unreachable evidence. A new action may reconsider it. If all items are collected by an alternative, pickup is not reported budget-limited. Retained drops can still end the current mining batch early, which may reduce gathering throughput.

## Verification

- 736 automated checks pass, including the long ascending detour, short paths, off-center negative coordinates, rounded thresholds, allowance consumed by planning, fresh retries, alternative destinations and listener cleanup
- All 17 standard prepared Minecraft phases pass
- The final prepared real-server arena refuses three 7835–8185ms detours before any goal or movement, retains its grounded position and item, and creates no retry-cache deferral. After a console-opened wall, the same job collects the supplied log
- The first fixture is retained: one 6085ms route was refused, but an affordable alternative legitimately collected the log. Its all-routes-refused assertion failed. The final harness lengthens the wall; application bytes are unchanged

These artificial supplied-item arenas prove the tested refusal/retry behavior, not natural-world survival improvement. Selected diagnostic evidence is kept separate from full cohort scores. Public Core0.2 is unchanged.

## Selected natural-world diagnostic

The single predeclared 300-second attempt on known seed 1041160109 **passed in 286.191 seconds**, with an observed stone pickaxe and furnace, alive and back at the starting point. Final health was 20 and food 15; the controller took 35 steps and 8 scouts. No attempt was retried or substituted.

The new route-budget refusal did not activate in this attempt. This result therefore does not establish that the admission change caused the successful outcome. It is one selected world, not a new full-cohort or general survival score. Raw result/events and the declaration/execution plan are preserved in `selected-diagnostic.tar.gz`, with hashes in `manifest.json`.
