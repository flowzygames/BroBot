# Passive pickup settlement

In the frozen 383-check run of seed 113919219, a pickup attempt expired while the bot was airborne at approximately (46.53, 62.54, -219.5). The starter halted safely at health 20. The saved player record was later lower, with negative vertical velocity and onGround false. Observed and saved local geometry showed one-layer snow above grass, with no nearby fluid or damaging-block overlap. The exact time between observations and the cause of the failed navigation are unproved.

This change reserves up to 500ms inside the existing shared 8-second pickup allowance, including before planning. After a started navigation attempt fails, a hazard-free downward fall can be observed passively. Two fresh dry grounded physics samples must arrive before the absolute deadline. Unknown/fluid/hazard cells, cancellation, replacement goals, observation errors and exhausted time reject the fallback.

The observer never steers, sets goals, resets velocity or clears a replacement goal. That is a helper-scoped guarantee; ordinary physical-action cleanup still stops the action as before. Successful passive settlement does not certify navigation arrival: failure and incomplete status stay sticky, collection does not mine another block, and the final pickup pass is skipped. Inventory changes remain action-wide.

398 automated checks pass, including deadline ordering, slow/failed world reads, fresh samples, abort/replacement, continued falling and end-to-end no-further-mining. This patch has not yet been physically replayed and does not change any published world score.
