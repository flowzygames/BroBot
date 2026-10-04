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

The running 365-check world cohort remains frozen and unchanged. It does not test this patch. Prepared physical verification and a selected fresh world replay are pending after that cohort ends. No success-rate or release-score improvement is claimed here.
