# Continue unchanged empty collection searches

Frozen application and final prepared fixture: `aa84fa3b7c2bf57d6f7d189aa3a3007763921768`.

A bounded collection scan could visit the same 65,536 matching blocks on every retry without examining later cells. This patch retains one short-lived geometric traversal cursor only after a completely empty, capped starter scan. It resumes with fresh checks rather than replaying that prefix.

## Safety and limits

The lease belongs to the same parent job and exact grounded pose, velocity, aim, entity, client, world, registry and dimension. It expires after five seconds and invalidates on observed block or chunk changes, movement, session changes, cancellation, Stop, or other actions. A successful read-only inspect may occur between calls; failed inspect invalidates it. Runner cleanup preserves only an already eligible empty cursor.

No candidate block, route, safety decision, old action callback or inventory operation is retained. Once a page finds a candidate, normal fresh environment, approach, harvest and pickup checks apply. Ordinary direct collection and unsupported fixture contexts keep the existing bounded search. The widened section envelope does not expand the requested resource radius.

## Evidence

- 722 automated checks passed. Differential traversal tests compare the pinned Mineflayer implementation, including negative coordinates, palettes, missing columns and shell-boundary counts
- Actual Runtime/ActionRunner tests demonstrate continuation across inspect and cleanup, invalidation after Stop/world changes/cancellation/failed admission, and discovery of later exposed ore followed by fresh route refusal without digging
- All17 standard prepared Minecraft phases passed on the same frozen source
- A prepared real Minecraft arena demonstrated continuation, followed by fresh scans after a server block change and explicit Stop; no mining or placement packet was sent
- The first prepared fixture legitimately found exposed ore on its outer surfaces and failed the empty-scan assertion. That result is retained. The corrected fixture encloses the ore volume in bedrock; application code did not change

Prepared enclosing terrain is artificial. It proves cursor behavior, not natural-world resource gathering, faster completion or improved general success. The separately recorded selected-world attempt must not be treated as a full cohort score.

## Selected natural-world diagnostic

The one predeclared 300-second attempt on known seed1542908414 **failed at the time limit**. It retained a wooden pickaxe, three planks, two sticks and one incidentally collected sugar cane, but gathered no stone; health and food remained20. There were47 controller steps and12 scouts. In the final eight retained history entries, six empty cursors were saved and none resumed. Earlier failed collection events omit result payloads, so whole-run continuation totals are unknown. This attempt does not demonstrate a natural-world benefit from continuation. There was no retry or substitution. The raw result, events, declaration and execution plan are preserved in `selected-diagnostic.tar.gz`; hashes are in `manifest.json`.

The earlier complete13/20 known-world score and qualified interrupted625-check cohort remain separate historical measurements. Public Core0.2 is unchanged.
