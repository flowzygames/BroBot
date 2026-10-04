# Frozen 342-check development cohort

All 20 known seeds ran once on fresh natural worlds with the existing 300-second starter protocol. Result: 11/20, versus 10/20 for the earlier Core 0.1 snapshot. Gains: 113919219, 1014875191. Losses: 1041160109. No interrupted case was replaced and all raw results are retained.

Tested local source: b7257569c48014384c308b88e8720a2df216de27. Its complete tree matches published application commit a423588bf995acac4e23171ebf453910ed2ec59c. The executable-file manifest is retained alongside the raw results. All runs report a clean checkout.

These are known development worlds with one run per source, not held-out reliability or identical trajectories. Source changes include resource discovery, workstation egress, observation gating and finite scouting targets. The gain/loss comparison does not isolate any one change's causal effect.

This is an intermediate overnight candidate. A later 346-check build is evaluated separately; its results must not be substituted into this cohort.

Per-seed compressed event logs preserve the full action timeline; raw result JSON retains sampled positions, nearby terrain and the final controller history. JSON whitespace is normalized without changing values.

Infrastructure note: world 1888406977 refused work on observed powder-snow contact after 93 ms. Paper logged chunk-generation errors only after the bot disconnected and server shutdown reached the player-saving phase. The failure was retained without retry; the event/server chronology does not show those teardown errors causing the recorded result. Its compressed server log is retained.
