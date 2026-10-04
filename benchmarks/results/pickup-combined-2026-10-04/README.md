# Combined pickup correction validation

This candidate combines starter-only failed-drop deferral with bounded passive landing observation. Integration review found an additional bug: a transient cache world-read exception could bypass the authoritative unsafe-ending check and allow another block to be mined. Cache reads now fail as cache misses, and body read failures become unknown cells that cannot certify a landing. Other observed hazardous cells remain visible.

407 automated checks passed after combining the changes, including a starter-scoped regression that refuses further mining after a failed airborne pickup and one transient cache read error. The separately tested components had 395 and 398 checks; those counts are historical component checkpoints, not additive benchmark scores.

Earlier queued 395- and 404-check physical validations were superseded before any Minecraft test began. Their plans and cancellation reasons are retained. No failed world result was replaced. The independent 383-check full cohort continues unchanged. Prepared integration and selected new-world replays of seeds 454806089, 113919219 and 386690312 are queued after it finishes. No current world-success gain is claimed for this combined candidate.
