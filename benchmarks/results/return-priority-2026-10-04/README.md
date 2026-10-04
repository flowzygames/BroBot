# Fresh return and hunger decisions outrank stale recovery

This code change prevents queued exploration or leaf clearance from replacing a freshly observed return-home decision after the starter kit is acquired. It also prevents those continuations from replacing an urgent eating decision. Normal safety checks, certified routes, and job limits remain in force.

Three new deterministic controller regressions fail against the preceding survival.js and pass with this change: late kit arrival before a queued scout, late kit arrival before queued leaf clearance, and low food with carried bread before a queued scout. The full automated suite passes 311 checks.

This is a behavior fix, not a new survival benchmark score. No live Minecraft trial was run for this patch yet. The existing Core 0.1 downloadable package and its 10/20 known-world result still refer to the previous tested snapshot. World 113919219 motivated return-home investigation, but its stored summary lacks action history; it does not establish that this bug caused that run's failure.
