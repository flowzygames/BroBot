# BroBot Core 0.2 development release evidence

Frozen tested source: 1a7dc58dbcbd9ff3c42fb2829745f92c2d9f5a78. Its complete application tree matches published commit a73e0aa8c7f95d2de34e252487d9b19ef9c29a25, merged in PR #23.

All 20 known seeds ran once, sequentially, with fresh natural worlds and the unchanged 300-second starter protocol. 11/20 completed, versus Core 0.1's 10/20. One gain (113919219), no losses. This is one known development cohort, not held-out reliability, identical trajectories or proof of any one patch's effect. No failed or interrupted trial was replaced.

Failures: five time-budget stops, one repeated-collection/exploration limit, one no-log exploration limit, one exhausted bounded target set, and one powder-snow safety stop. Canopy escape and difficult terrain remain unresolved. The separate automatic canopy experiment is excluded from this release.

Raw result values and compressed full event timelines are retained per seed. The flat SHA-256 manifest covers frozen application, harness and test files. Routine offline Mojang DNS and server plugin update/locale warnings occurred; they did not abort these Java offline runs. This does not establish broad hazard reliability or Windows/Bedrock runtime coverage.

## Separate original-world regression

1/3 completed, versus Core 0.1's 2/3. Seed 718224 passed in 99.256 seconds. Seed 42 stopped near a hostile at 144.774 seconds. Seed 20260930 stopped at low health during stone gathering after 43.573 seconds (6.783 health remaining). The source of damage is not established by the logs. These results are not substituted into the 20-world cohort. They are a negative signal: the release is not uniformly better and safety checks do not guarantee avoidance of damage.

## Prepared integration

The full isolated prepared integration suite passed 17/17 phases on the same frozen source. This uses supplied test materials and console-prepared terrain for several phases. It is distinct from the named BroBench skill/control scorecards, which were not rerun for Core 0.2. Bedrock bridge discovery passed; no rendered Bedrock client gameplay was tested.
