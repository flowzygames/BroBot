# Local evidence for craft retries

The frozen integrated 413-check candidate completed 17/17 prepared phases, 10/20 known worlds and 3/3 separate originals. These are pre-fix results, not scores for this hotfix. Compared with the public 346-check release, seed 1244186709 was lost and no known-world pass was gained.

That failed run repeated 84 rejected wooden-pickaxe crafts at the same pose and inventory over 32.121 seconds. The recorded local block names changed twice, but the global terrain revision was not logged. Source analysis suggested unrelated block/chunk updates were reopening retries. A deterministic reproduction that increments only the global revision confirms that failure mode; it does not identify a particular event as the cause of the historical run.

Craft retry contexts now use bounded local block-state/shape evidence and table/hazard observations, rather than global revision or remote resource lists. Inventory, position, local state and usable-table changes still permit new attempts. The context remains craft-specific through failed-scout continuations. Physical actions still verify complete safety conditions independently. The local hash performs 4,913 block reads; it is a retry hint, not a complete dependency fingerprint or permission to place a block. Real observation latency has not yet been quantified.

The isolated source hotfix passes 400 automated checks on application commit 70c4164. The same correction plus the separate pending pickup, search and return changes passes 426 checks at a3cbc3c74ba7db5ca52cdbe1b90ae6f2681fb75e and is undergoing prepared and selected-world verification. Those sources and their evidence are not interchangeable.

The retained archive contains every pre-fix 413 known/original result, complete event journals, prepared result, plan and tested-file hashes. All 23 runs ended at health 20, but journals include three transient unattributed health losses: two 20→19 losses on 386690312 and one 20→18 on 1744809425. Separate hurt observations did not identify a source; no packet joining was used to infer causes. Five-second samples alone missed these losses.

Archive SHA-256: `aeea8ef40c1b01f06652b62606877a72556041aeff486c7d4498cff5b97c59d8`. File hashes are also in manifest.json, both inside and beside the archive. No failed run was replaced. Queued 418/421 component validations were canceled before any physical run after this inherited defect was discovered. Public Core 0.2 ZIP is unchanged.
