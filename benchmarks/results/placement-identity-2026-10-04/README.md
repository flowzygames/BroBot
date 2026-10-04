# Final placement item identity

A deterministic regression showed that ordinary placement could finish its hidden Mineflayer aiming await with a different held item, then send a placement packet. Guarded workstation placement explicitly aimed first but still failed to validate the held item afterward. Both original regressions sent unwanted placement requests before the fix.

Every placement now completes an explicit aim before its final target/support/workstation proof checks. It verifies the held item's requested name and positive count, then calls the pinned Mineflayer 4.39.0 placement helper with forceLook:'ignore'. Static inspection and an independent isolated contract probe verified that this route sends its packet synchronously without another aiming await. Existing server-result verification and placement options are retained.

457 automated checks pass, including changed-item rejection for workstation and ordinary placement, empty-stack refusal, and successful ordinary placement using exactly one explicit aim and the ignore option. Read-only review found no blocking defect. Exact published source 5ba9e304 passed all 17 prepared Minecraft phases and the separate controlled canopy fixture. The latter verified two typed table-egress failures, one grounded leaf descent, pickaxe crafting and a separately requested return, with no health events or cleanup errors. The raw results, plan and tested-file manifest are retained here. These are prepared scenarios, not new natural-world benchmark scores.

This patch is separate from the frozen 454-check natural-world evaluation and cannot be attributed to those outcomes. It does not solve multi-block placement footprints or enable the held excavation experiment.
