# Integrated server-confirmed mining candidate

Application and fixture source: `e37362f21606fbea028ef42fcec403f97f30ad68`, clean. Aggregate source checks:502/502. This is separate from the earlier observer-only experiment.

The prepared real-server createActions diagnostic passed both cases:

- Adventure: the library predicted air and emitted diggingCompleted, while raw server updates and an independent console check retained the oak log. The action rejected with MINING_UNCONFIRMED without a mined result, permanently quarantined that bot, and disconnected. A later movement request and inspect through a newly created actions object both rejected with TERRAIN_UNTRUSTED
- Separate survival connection: the action received real server air, the server console agreed, and dig_at returned completed=true, mined=1 and inventory_changes={oak_log:1}. Terrain remained trusted

Both cases ended at health20. All captured source hashes matched the frozen source; no cleanup errors. Separate connections are recorded in the server log. The raw result includes the packets and action outcomes.

This is a prepared refusal/success fixture, not a new full-world benchmark. A server update establishes observed state, not which actor caused it. The earlier full454 cohort and later targeted leaf473 cohort remain separate, with their original limitations. This patch does not fix the remaining terrain navigation failures or establish a stable1.0 release.

The normal prepared compatibility suite on the same frozen application passed17/17, finishing2026-10-04T19:21:00Z. Its mining phase verified four logs mined and four actual inventory gains; one pickup noPath failure recovered. No unconfirmed-mining, quarantine or receipt-deadline errors appeared. See prepared-17.json. This is prepared compatibility evidence only, not a natural-world cohort.
