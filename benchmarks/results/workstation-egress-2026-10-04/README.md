# Preserve a local exit when placing workstations

A saved natural-world run (924242050, resource-search-2026-10-04/search-924242050.json) ended trapped beside its own crafting table. Offline reconstruction with the actual Mineflayer movement graph found no outgoing movement neighbors with the table present. Virtually removing only that table restored a 111-cell component and the short route toward the start. The compact recorded geometry is in test/fixtures/workstation-trap-924242050.json; unknown outside its stated bounds remains unknown.

Automatic workstation placement now checks the same nontrivial local standing-cell witness in both the existing and hypothetical post-placement worlds. Forward and reverse paths must succeed without digging, placing or parkour. Proofs remain within six blocks and share a bounded planning budget. Rejected table locations yield to later candidates.

The proof is repeated from the actual grounded pose after approach, equip and look. All observed terrain fingerprints, pose and body/target clearance are revalidated immediately before the placement call's synchronous packet path. Planning uses isolated virtual blocks and does not mutate the world. This proves preserved local egress, not complete canopy escape or a distant route home.

Verification: 328 automated checks passed. The integrated recorded-world crafting regression places the trapping table with the previous actions.js and selects an alternative with this patch. Other checks cover an L-shaped exit, geometry/pose/ground changes, cancellation during final look, original-radius resource search, and normal flat-ground crafting. Fresh live validation is pending.
