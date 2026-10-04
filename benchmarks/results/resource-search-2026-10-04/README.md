# Diagonal resource discovery

Mineflayer 4.39.0 searches chunk sections using Manhattan-distance shells. Passing a desired spherical radius directly as maxDistance misses some loaded diagonal sections. The collection and starter log-observation callers now widen the section enumeration bound while retaining the original spherical filter before the candidate count cap.

Actual-library regressions reproduce missed stone at (-17,64,-17), a log at (-33,64,-17), and a three-axis section corner relative to an origin near (0,64,0). The collection and runtime-observation regressions fail against the previous source and pass against this patch. Movement, round-trip certification, world boundaries, collection scan/cancellation limits, and success criteria are unchanged. Enumeration is still bounded and may be incomplete when the existing scan budget or count cap is reached.

## Separate preceding live run

return-priority-113919219.json records a fresh natural world run of a836cdb (the executable equivalent of merged PR19). It completed the starter kit and return in 234033 ms. This happened before the resource-search patch. It is a single known-seed development run, not an updated cohort or causal comparison. The earlier Core 0.1 downloadable package's 10/20 result remains tied to its original source.

## Resource-search development run

search-924242050.json is a fresh run with the resource-search patch. It stopped after 126120 ms when the exploration budget was exhausted, with a wooden pickaxe but no cobblestone. The bot remained on the canopy and could not certify its short scouting routes. The resource-discovery fix does not solve canopy escape, and this failed run is retained.

The run began from a dirty a836cdb because the first local commit attempt lacked author configuration. Those executable files were unchanged throughout the run and committed as bcfbf6864f1caedf36c5f692c8831134e0c1cd2c at 05:06:54 UTC. The raw result's original commit and dirty fields are preserved. All 319 automated checks passed on this candidate before the trial. No public cohort score is revised from this selected development case.
