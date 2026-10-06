# Collection-local cursor invalidation

## Observed defect

An attribution-only 120-second diagnostic on source `b59fa557503c0458913024b357c9db9747c45aa2` recorded three pending collection cursors cleared directly by block updates. There were no recorded snapshot/identity changes, aborted signals or expiry. The updates were at least 87.664, 121.033 and 123.794 blocks from any possible fixed query origin in the recorded starting section. All are outside even the maximum legal collection dependency radius of 65 blocks.

The diagnostic produced 29 numbered records plus a header, below its 2,000-record limit. Its timing was affected by instrumentation and it reached the 120-second time budget. This is not a normal benchmark score, nor proof of the cause in older uninstrumented runs.

`before-trace.tar.gz` preserves the declaration, trace, raw result, console/server logs and per-file manifest. SHA-256: `ada79a9907d8e18c4dceb9f7f3386f89bef86b4107f9559d0a30f296b59042e5`.

## Narrow correction

Only collection supplies a terrain dependency: the fixed floored search origin and search radius plus one block. The collection predicate reads a target within radius and its immediate face neighbors; all those terrain dependencies are inside this sphere.

- Ignore a block update only if both old and new positions are valid and strictly outside the sphere
- Invalidate on sphere boundaries, malformed/missing coordinates and relevant local changes
- For chunk events, intersect the complete column's horizontal rectangle with the dependency disk; include tangencies and all heights
- Copy and freeze the scope; changed scope forces a fresh cursor
- Preserve global invalidation when no scope is supplied
- Preserve every existing exact pose, session, parent/action signal, TTL and query guard
- Recheck routes and mining safety after candidate discovery; no prior safety verdict is retained

The generic cursor does not infer locality for arbitrary predicates. Distant matching-state changes can alter scan timing, but cannot make a previously rejected local target eligible without a relevant target/neighbor change, which still invalidates.

## Verification so far

58 focused lifecycle/trace checks passed. Four full action/controller integrations passed: normal and distant-event five-page scans, plus block-update and chunk-reload insertion into an already skipped palette section. Newly inserted targets are rediscovered and still refused by the fresh digging guard; no digging occurs in these modeled fixtures. The exact frozen source `4de9ef595e60efca1db67e9c020cf8eb804349f3` passed 793 automated checks. Published equivalent head `1ddfac6b4f948734221cc693bca402189d9dcb06` passed CI run 37399067636 on Windows/Linux with Node 22/24; merged in PR #72.

## Post-change diagnostic observations

`after-trace.tar.gz` retains the timing-affected 120-second diagnostic and raw result on the frozen source above. SHA-256: `5917700cd3a035702e0fb6fbe2a7ec43fcae3226ae997e43b41f6939b0af59b7`.

An independent read-only audit verified 87 numbered records plus header, with no cap reached. All 56 terrain observations used radius-49 wood-search scopes. All 52 preserved events had valid old and new positions outside their recorded dependency region. Four local block updates still invalidated pending leases; a fifth clear was explicit Runtime.invalidateSearch. No begin reported a resume in this short run, so it proves event filtering, not natural cursor advancement.

This diagnostic stopped at 117,026 ms before starting mining that could not finish within its remaining budget. Inventory included ten cobblestone and a wooden pickaxe; health and food were 20. It did not complete the starter objective. Different timing and a single observation do not establish a performance improvement.

## Separate uninstrumented validation

`runtime793.tar.gz` preserves the declaration, driver, both stage logs, prepared result, selected-world result, game events, selected server log and checksummed manifest. SHA-256: `4f42075c30794ddb078a9271973469aafe1e466703b5a139f3e16c02d2498a77`. `runtime-manifest.json` indexes those members.

All 17 standard prepared Minecraft phases passed. The one selected known seed 1542908414 still failed at 300,006 ms on the starter time budget: 55 steps, 11 scouts, health 20, food 20, wooden pickaxe and no cobblestone. Six of the seven collection entries in the final retained history reported search_continued=true. This establishes natural continuation reporting but not starter completion or a whole-run continuation count.

The selected attempt was declared after seeing the short diagnostic and ran once, with no replacement. It is not held-out, a full cohort, or a causal comparison. Both validation stages verified unchanged tracked source and server cleanup. The production website/download and their frozen release scores are unchanged.
