# Pickup landing guard investigation

A frozen pre-fix run of seed 386690312 finished `dig_at` successfully and reported no remaining drops, despite subsequent inspection placing the bot body in an observed lava cell. It then began another collection action. The run ended at the low-health threshold with eight cobblestone and no finished kit. The retained excerpt includes the preceding observation, action, independent injury packets, completion and next action.

The hurt packet did not identify a source. Health-loss records are separate observations; they are not joined into a proven damage attribution. Lava/body overlap is concrete observation geometry, not a claim about every preceding hit.

## Changes under verification

- Pickup item events no longer cause our helper to clear its own movement goal before a grounded, dry, verified destination
- Disappearing drops do not by themselves prove a successful landing or completed mining action
- Unsafe pickup endings halt the starter rather than trying another block; failure results retain real action-wide inventory changes
- Runtime observations expose body/lava contact and the starter refuses a new task step there
- Success and failure logs retain destination, ending position, grounding and landing verification

## Limits

Mineflayer-pathfinder 2.4.5 can itself finish a goal while airborne and clear controls. This patch does not override that library behavior; it waits for a verified dry grounded arrival or reports bounded failure. The helper flaw has deterministic regression coverage, but its causal role in this recorded lava entry is unproved. Pausing work does not pause Minecraft or rescue a bot from lava.

The separate 365-check cohort does not test this patch. This patch passed 383 automated checks and 17/17 prepared integration phases. A fresh selected replay of seed 386690312 passed in 287.077 seconds, with a stone pickaxe and furnace in inventory, alive and back at the start. Tested source: 8dbe23c09fe9b2cba6714a7d428255dcf1cd20d1, clean. This is one selected diagnostic replay, not a new full-cohort score or causal proof that the patch alone changed the outcome. Raw results and run plan are retained beside this note.
