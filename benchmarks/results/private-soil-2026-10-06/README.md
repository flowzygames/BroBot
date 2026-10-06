# Private soil staircase: first prepared physical gate

On frozen local source `dc315dbc96d94f200e5c441046b0325b45246197`
(tree `dc5f04e0263f32793568bca74ab1cfd9984cce31`), all 864 automated checks
passed before the Java 1.21.8 prepared gate.

The real server run passed:
- Five soil edits, each with a matching raw server air update
- Two physically settled descents
- Stone exposed at (3,62,0), deliberately not mined
- Original and home supports retained
- A separately requested guarded walk home, health 20/food 20, terrain trusted
- Independent console verification, unchanged source hashes and confirmed server shutdown

The excavation phase took 5613 ms and the separate return took 1630 ms. See the
archive's complete result, packet observations, server log and properties.
`manifest.json` gives archive and result SHA-256 values.

This is a console-prepared flat arena with fixed inventory, peaceful conditions,
and random ticks disabled. The private facade is absent from public definitions
and autonomous starter routing. It is not a natural-world score, a claim of
general terrain reliability, a hostile-safety result or Bedrock testing.
The released Core 0.2 download is unchanged.

## Prepared copied-world gate

Frozen local source `ae34690642857c981f3b9a72cb30159cdc8bea38`
(tree `f5bdd7a93eef74f143d988570776b9d2c57160cd`) passed all 887 automated
checks and the prepared copied-world run at 03:58 UTC on October 6.

- Five receipt-confirmed soil edits and one explicitly modeled thin-snow clearance
- Two settled descents with actual position, velocity, grounded state and health samples
- Stone exposed at (133,60,81), deliberately unmined
- Separate guarded return home with health 20, food 20 and trusted terrain
- Independent console verification of protected supports and untouched stone
- Zero recorded server position corrections, unchanged source and confirmed shutdown

Excavation took 6995 ms; the separate return took 6590 ms. This replay copies the
known failed seed 1542908414 terrain, starts at (129.7,64,81.5), supplies equipment,
removes entities and uses peaceful conditions with random ticks disabled. It does
not fill terrain. The source result hash was verified, not every source-world
file. The executor remains private and is not selected by the autonomous starter.
Exposure is not stone collection or a new full-world score.

`prepared-saved-world-development.tar.gz` preserves all eight iterative replays
of this same prepared case, including seven failed/refused development attempts.
`saved-world-manifest.json` records their results and hashes. Earlier traces
without correction logging have an unknown count rather than an assumed zero.
Two unrelated underground air updates were also observed in the successful run;
the five soil edits and one dependent clearance are not a count of all world
changes. Thin-snow handling requires both raw air receipts and matching loaded
state; other dependent changes remain refused or quarantined.
