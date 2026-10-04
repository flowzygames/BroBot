# Prepared retained-leaf support evidence

Frozen application and harness source: c7b84f16c0c323bddd8b7eac1af2036f326c0c51. Aggregate 517 checks passed. See prepared-support.json for exact source hashes, actions and geometry.

The harness used a separate stone saved-home point and a retained actual leaf-supported waypoint with 0.02-block height jitter. It refused an initial collection of the final anchor, added an alternate anchor through the prepared console fixture, allowed one original-log removal, refused the new last anchor and returned separately to the retained waypoint. Support remained present, health stayed 20 and cleanup succeeded.

The one allowed dig did not collect its drop. It returned mined 1 and completed=false with three PICKUP_NO_COLLECTION_PROGRESS attempts and no inventory gain. The final current-footprint assertion called the guard directly against real loaded terrain after return; it was not a further mining action. Random ticks were disabled. These distinctions prevent treating this fixture as autonomous survival, successful resource acquisition, or a leaf-decay timing study.

The unchanged application also passed all 17 normal prepared Minecraft phases. See prepared-17.json; this is compatibility evidence, not a natural-world score.
