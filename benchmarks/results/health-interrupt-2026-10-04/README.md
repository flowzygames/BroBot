# In-flight starter health interruption

Source tested: ba1bd3262fed83dd40ebd30ffb76120ea767497f. The application/harness/tests match the accompanying manifest and the publication branch; only release documentation and retained evidence differ.

The starter formerly checked health <=8 between actions, while Runtime only interrupted at <=6 every second. A Core0.2 regression run ended a long stone collection at6.783 health before the starter stopped. The damage source was unconfirmed.

The fix shares the existing8-health starter boundary with in-flight interruption, listens to fresh health packets immediately, preserves the6-health boundary for direct controls, lets eating complete and lets the existing death handler own lethal packets. The timer remains a fallback. Five new automated checks bring the suite to351. The two positive-health boundary tests fail on the old source.

A fresh isolated prepared Minecraft1.21.8 fixture applied13 generic damage during real log digging, with the one-second reflex timer disabled. The starter and action paused at7 health and digging stopped; the measured console-command-to-settled interval was60ms. This verifies cancellation after reported damage, not prevention of damage or escape to safety. The world continues while paused.

One separately selected natural-world replay (20260930) completed in79.394seconds, alive at home with both items. Its sampled health stayed20, so it did not exercise the new interruption. It is not causal evidence of a survival improvement and does not replace Core0.2's frozen1/3 original-world regression or11/20 cohort. No new full cohort was run for this patch.

The published Core0.2 ZIP remains the separately verified346-check snapshot; this source follow-up is not silently inserted into that archive.
