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

## Prepared server and selected world follow-up

The documentation-only frozen source `0f445aeb4ca356c394b847eeb1625e64cff0542b` has the same application/tests as the source above. It passed all 17 standard prepared Minecraft phases on October 6, 2026 at 00:52 UTC. `prepared759.tar.gz` retains the result, console log, selected-run declaration, validation driver and initial failed bootstrap result. SHA-256: `fe49ef08564f70c773f32038e73b040c1af97b93b0922bf31dc5b09c38de50e3`.

The first bootstrap failed before gameplay because the runtime cache lacked the Mojang jar and the host could not resolve piston-data.mojang.com. An already-installed local jar was found and verified against Paper's embedded SHA-256 (`2349d9a8f0d4be2c40e7692890ef46a4b07015e7955b075460d02793be7fbbe7`), then restored to the expected cache. No new EULA acceptance, alternate download or world-attempt replacement occurred.

The single preselected known failing seed **1542908414 still failed** after **228004 ms**, 41 steps and 10 scouts. The bot had a wooden pickaxe and two sticks, but no cobblestone. An explicitly observed polar-bear attack paused exploration; a separate health packet recorded 20 → 14. This is interruption evidence, not an automatic escape or a causal attribution of the health packet. Food remained 20.

`selected154759.tar.gz` contains the raw result, game-event log, server log, driver output and final plan. SHA-256: `26a691c595a4ddc7a4003cdeada43c0685f388be6809428b4488e1498fdf892b`. `selected-manifest.json` lists each member's checksum. Both stages verified server cleanup and unchanged tracked source. The selected world ran once; the failed startup was a prepared-gate attempt before that world was launched.

This is one known-world diagnostic, not a held-out evaluation or a new full-cohort score. The final retained history still includes saved searches that did not continue; it does not record their invalidation causes. The controller fix is proven by deterministic integration tests, while its benefit in this natural attempt is unproven. Public release numbers remain unchanged.
