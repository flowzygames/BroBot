# Combined pickup correction validation

Frozen application: `2fc3075afb4c0eecd3b0c168b2200b1463f78a5f` (407 automated checks). Prepared integration: 17/17. Three selected diagnostic replays, one fresh run each; this is not a full cohort score:

- 454806089: passed 101.064 seconds
- 113919219: passed 294.766 seconds
- 386690312: timeout 300.006 seconds

All ended at health 20. In the timed-out run, the eleventh cobblestone arrived at 293.903 seconds; return to the remembered crafting table was still running when the job expired. There was no stone pickaxe or furnace yet. Collection consumed 225.501 seconds over 21 actions, with eight return-planning-budget errors, four no-path errors, one obstruction and one bounded-search failure. These counts describe this run, not a proven cause of all changes against earlier candidates.

Cache deferral appeared in five direct action results in each of 454806089 and 386690312, with six and nine reported entries respectively, across three unique item IDs per run. These are reported entries, not cache-creation counts. Deferred-only actions can avoid new pursuit, but expiry and observed context changes allow later retries. No natural run reported successful passive settlement; 113919219's pass cannot be attributed to that fallback.

## Prepared passive client-physics probe

Probe commit `7eb1797b489d2824a3140757c7adc500987246c3`; application source matches the 407 snapshot. The retained script differs only in the explicitly selected prepared fixture. Script SHA-256: `e5f117ae497d4f3f001a3a190cfa4f6a255a5f0e56b60120538c5fdeaf1ac714`.

Two console-prepared short falls above stone and one-layer snow settled in 300.365 and 302.267 ms, with two fresh grounded client-physics frames and health 20. This demonstrates the helper under controlled conditions. It does not reproduce failed natural pickup navigation or independently establish server position. Raw trials, timestamps and observed blocks are retained.

## Integration and limits

Read-only integration review found a transient cache-read exception could bypass unsafe-ending handling. The 407 application fixes it: failed cache reads are misses; failed body reads are unknown cells and cannot certify safe landing. The regression stops after one dig and pursuit. Component 395 and 398 counts are earlier source checkpoints, not additive benchmark scores.

The combined application plus merged craft-scout context passes 413 automated checks at `5be5e6f57a0841d93a39fb77a94129be7de85a88`. Its separate full prepared/20-known/3-original evaluation is in progress. Do not label these 407 diagnostic runs as 413 outcomes. Public Core 0.2 package and published scores remain unchanged.

Earlier queued 395 and 404 validations were superseded before physical tests began; no failed physical run was replaced. The 383 full cohort finished 10/20 known and 3/3 original worlds and remains independently retained.
