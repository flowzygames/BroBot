# Conservative block-face reach rejection

Mining path goals test visibility for every expanded A* node. Previously, even an eye position far outside mining reach constructed seven target centers and their direction/distance vectors before every center failed the existing reach test.

A numeric broad-phase now rejects only eyes strictly outside the target unit cube expanded by the requested reach on each axis. Every sampled center lies inside that cube. Face, edge and corner boundary cases remain on the original path, as do diagonal cases inside the expanded box. Non-finite or coerced reach arguments retain the prior fallback behavior.

For a potentially reachable target, the original center ordering, exact distance checks, live raycasts and hit checks are unchanged. There is no visibility cache, reused terrain result, new path permission, changed heuristic, increased planning budget or relaxed route/mining guard.

A frozen legacy oracle compares Boolean results and exact ordered raycast arguments across deterministic grids, negative/fractional and world-border coordinates, face/edge/corner reach boundaries, obstructions and absent hits. Tests also cover changing occluders, the actual BlockFaceGoal eye offset, and nonstandard reach arguments. A local target wrapper counts center allocations without changing Vec3 globally. Far probes allocate no centers, while the legacy routine creates seven each. A fixed 1,089-node grid must reduce target-center allocations by more than 75 percent with identical ray counts; no wall-clock timing assertion is used.

This is a verified reduction in avoidable geometry work. It does not identify the cause of any previous natural-world failure, guarantee faster planning in Minecraft, or establish a new survival completion score. All prior benchmark scores retain their original source attribution.
