# Experimental observed-hostile interruption

In the selected 426 run of seed 454806089, collection continued 5.376 seconds after the first explicitly sourced zombie hurt observation until the existing low-health pause at 7.333 health. The hurt observations and health-loss packets are retained as independent evidence; no packet joining is used to infer a damage amount or cause.

This candidate responds to an own-entity hurt observation with an explicitly hostile source before journal writes. It interrupts active starter work immediately, retaining the original diagnostic action context. Direct controls, eating, retired connections, already-aborted work and lethal-health handling keep their existing behavior. Missing or ambiguous sources are not guessed.

430 automated checks pass, including observer ordering, scoped cancellation and real Runtime.connect listener wiring. Read-only review found no code-level blocker. Physical verification remains pending.

## Important product limitation

This is a work interruption, not combat, retreat or a paused Minecraft world. The next hit remains possible. It may reduce autonomous completion rates: a separate full 426 run of the same seed finished successfully despite a skeleton hurt observation and a transient health loss. Therefore this candidate must not be advertised as improved survival or shipped as a completed defensive system. Hold it experimental while evaluating a bounded escape/recovery policy and verifying actual event response. No new public release or benchmark score is claimed.
