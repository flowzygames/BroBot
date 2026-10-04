# Blocked crafting retry context

The frozen 383-check run of seed 1744809425 recorded 36 failed crafting-table placement attempts and 17 failed scouts while remaining in the same canopy pocket. Health stayed 20. This correction avoids repeating the unchanged blocked craft after a scout also fails without moving or changing materials.

Recovery retains the original failed action signature and its observed context, rather than assigning the failure to a freshly proposed action that may never have been attempted. New inventory, observed terrain, pose or intended action permits fresh work. Craft failure contexts are captured immediately before execution: a failure that itself moves the bot or changes inventory cannot transfer old retry counts to the new conditions.

395 automated checks passed. Regressions cover unchanged craft/scout cycling, changed terrain and movement, a newly reachable table before the first recovery scout, new tools, and movement during a failed craft. Read-only review confirmed the related partial-inventory failure case as well. Existing step, scout, time and safety limits are unchanged.

This is a retry-control fix, not a demonstrated canopy escape or an improved natural-world score. The ongoing frozen world evaluation does not include this source change.
