# Floating-point contact correction

The 1.21.8 client predictor can miss a collision at an already-contacting block
face. A retained natural-world run stopped at a grass corner while the bot still
had a valid path home. Earlier revisions occasionally escaped the same corner;
this is a reproduced movement flake, not evidence that the recent collector
introduced an unreachable home.

## Reproducer

The saved player position was `(-27.562169459617916, 69, -4.30000003)`.
With the configured half-width `0.30000003`, its maximum Z became
`-3.9999999999999996`, microscopically beyond the solid face at Z=-4.
The installed AABB implementation tests `player.maxZ <= block.minZ` before
clipping positive Z movement. That comparison fails at this contact. A predictor
step then allowed about 0.07665 blocks of penetration into a full grass block.

An isolated AABB test and an actual prismarine-physics simulation reproduce the
incorrect inward motion. The adapter prevents it while allowing tangential and
outward movement. Server correction feedback as the cause of the observed live
stall remains an inference until targeted live validation; no packet-correction
recording was available in the earlier run.

## Narrow scope

- Enabled only for Minecraft 1.21.8 with the tested locked Mineflayer 4.39.0,
  pathfinder 2.4.5 and prismarine-physics 1.11.1 versions
- Preserves the original perpendicular-overlap conditions and normal clipping
- Clips inward movement to zero only for microscopic contact overlap
- Tolerance is max(1e-9, eight machine-epsilon units at the contact coordinate),
  capped at 1e-7 blocks
- Does not displace the entity, teleport it, change server attributes, reduce
  collision margins, enable parkour or alter mining/placement permissions
- Leaves meaningful overlap handling and outward/tangential motion unchanged

The adapter temporarily wraps the AABB methods during the same synchronous
`simulatePlayer` call used by both live prediction and pathfinder lookahead. It
restores the exact entry-time methods in `finally`, including exceptions and
nested calls. No global patch remains between simulations. Reentrant unrelated
AABB operations inside that synchronous call could still see the adapter; it is
not a general upstream replacement or a claim about every Minecraft version.

Run `node --test test/collision-contact.test.js` for the numerical, all-axis,
large-coordinate, restoration, nesting and actual-predictor regressions.
Natural-world validation is recorded separately from these deterministic tests.
