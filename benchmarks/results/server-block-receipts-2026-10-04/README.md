# Experimental raw server block receipts

Frozen code and fixture commit: `5b1a001b5e9e994a302a844779786789de56f7d6`.

At the frozen commit above, the experimental observer was not imported by production actions. Later candidate integration is described in MINING_CONFIRMATION.md and requires separate evidence. This is not a new BroBot release or world-cohort score. Aggregate checks passed 477/477, including 14 observer regressions.

## Prepared real-server experiment

Java 1.21.8, Mineflayer 4.39.0. The isolated peaceful fixture placed one oak log and supplied an iron axe. Adventure and survival cases used separate bot connections. Both passed; no cleanup errors or health loss. The raw result records packets, local events, source hashes, inventory and independent console checks.

- Adventure: the library resolved its dig promise and emitted a completed-dig event. It locally changed the target to air, while the server had reported oak-log state137 and independently confirmed the log still existed. Two sequence0 acknowledgments were received; neither indicated success. No target-air update occurred during the observation window. The observer expired without accepting clearance. No log entered inventory
- Survival: the library again resolved before any target receipt. A raw server air update arrived about36ms after local prediction; the observer accepted that observation. The server console independently confirmed air, and a separate inventory observation confirmed one oak log collected

The negative case proves cached air and diggingCompleted alone can be false positives on this installed stack. The positive case proves the observer can distinguish actual server-reported air in this fixture. It does not prove which actor caused a change, that all servers emit the same updates, or that terrain remains safe later.

## Scope and remaining integration work

The observer is deliberately restricted to protocol1.21.8. It decodes raw block_change/multi_block_change updates, retains the latest exact-target state, rejects local events and acknowledgments as receipts, and invalidates on deadline, abort, death, disconnect, respawn, changed client/dimension, or replacement/unload of the target column. Listeners are removed on invalidation/disposal; initialization rolls back on failure.

Before use in production mining, callers must also retain the action lock until digging drains, revalidate the latest state after awaits, prevent cached predicted terrain from being reused after uncertainty, and stop collection/pathfinding continuations on failed confirmation. An observer snapshot alone does none of these. In particular, the adventure client still cached air after refusal, so simply throwing an error and allowing the next action is insufficient. This experiment closes the bot connection before the positive case rather than claiming it repaired that cache.

Existing full-world starter inventory and return results remain separate evidence and are not invalidated by this narrower finding.
