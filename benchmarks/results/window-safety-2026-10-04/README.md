# Furnace synchronization and late-window cleanup

Application tested with retained leaf protection: 507d60f61df925c59aaf0b275bfd1d5fd164b7c3. The integrated source passed 522 aggregate checks and all 17 normal prepared Minecraft phases. The standalone window patch9bb6a02 passed507 checks before integration. See prepared-17.json and tested-files.json.

## Fixed behaviors

1. Furnace contents can change or reconcile while the authoritative inventory refresh is pending. The previous code checked input/output/fuel only before that await. A reproduction revealed one foreign sand during refresh; a two-sand request could consume it and report three glass. The fix rechecks all three slots after refresh, before transfers. This is not an exclusive lock against later concurrent player changes
2. Direct createActions cancellation during openBlock/openFurnace could throw before the returned window was captured inside cleanup scope. The fix retains the acquired window, checks cancellation, and awaits its closure before unlocking. Runtime's outer ActionRunner cleanup already mitigated this leak on the normal runtime path; no broader production leak is claimed

## Regression evidence

Five initial regressions failed against the old application: occupied input, fuel and output first revealed by sync; and late crafting/furnace windows following cancellation. All five pass with the patch. The cleanup tests were additionally strengthened to hold closure pending and verify that a subsequent action remains blocked until it resolves. Occupancy cases assert zero transfer clicks, closure and preserved foreign contents.

The 17-phase live suite verifies normal forward compatibility, including crafting and smelting. The injected race/cancellation cases are automated fixtures, not separately staged live-server races. No new natural-world score is claimed. Existing 13/20 full-world, 2/3 selected mining and 2/5 selected leaf-start results retain their own source identities and limits.
