# Controller search continuation

Frozen application/test source: `2e0177854e988c876b60493b26c2fd14ed78f2dc`.

## Bug and correction

The collection executor deliberately retains a short-lived cursor after an empty bounded scan. The starter controller previously counted every such result as an exhausted collection attempt. After two pages it scouted, discarding the unfinished cursor before later candidates could be considered.

A continued, saved, empty collection page is now exempt from the ordinary failure counter only when it has no typed refusal, no mining failures, and no planning or pickup limit. The first fresh page still counts; repeated cursor restarts still lead to normal recovery. This is not recorded as material progress and does not reset other failures. Step limits, time limits, fresh observations, cancellation and execution-time route checks remain unchanged.

## Verification

- 759 automated checks passed on the frozen source
- 134 focused SurvivalJob tests passed, including five-page continuation, repeated restarts, exhausted search, planning/mining failures, typed refusals, fresh crafting inventory, step budget, deadline and cancellation
- A full in-process integration connects SurvivalJob, Runtime.execute, ActionRunner, createActions and the actual BlockSearchCursor, with real inspection calls between scans
- Dense modeled loaded stone with an opening at (-25, 48, -4) yields four genuine empty saved pages. The fifth page discovers candidates and performs fresh route checks. All routes are deliberately rejected as noPath; zero digging occurs
- An independent read-only reproduction confirmed the original controller ran collect, collect, explore, whereas the fix reached the later search pages

The modeled world supplies geometry and uses a fixed monotonic clock for deterministic page boundaries. It is not Minecraft server gameplay, a mining-success result, or a new natural-world benchmark score. The public Core 0.2 package is unchanged. The preceding 749-check source's stale tree-clearance fix remains a separate change.

To reproduce the integration: `node --test --test-name-pattern="real controller keeps a dense" test/actions.test.js`.

Local aggregate log SHA-256: `07a9ef871dc4bde2af6677505a81582fa8f8d884664368161c5d63c771d9788f`. The log is not included; use the pinned source and test commands to rerun.
