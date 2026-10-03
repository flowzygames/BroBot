# Bounded pickup candidate — October 3, 2026

Frozen application `ee5084117f8ca492549759b2ec78ef41a18a2b38` passes 308 automated checks and 17 prepared live phases. It shares an approximately eight-second pickup allowance across each physical collection action, preserving partial inventory/drop evidence for recovery instead of repeatedly pursuing until the outer action expires. Polling and bounded synchronous work can modestly exceed this allowance; it is not a hard real-time deadline. Cancellation still rejects and cleans up.

| Selected known world | Outcome | Seconds |
|---|---|---:|
| 355620996 | Pass | 126.943 |
| 1244186709 | Pass | 250.542 |
| 718224 | Pass | 106.281 |
| 42 | Fail: nearby hostile safety stop | 101.310 |
| 20260930 | Pass | 93.290 |

The first two are targeted cases that failed on the 305-check source. The final three are the original regression set, which is **2/3 on this candidate**, not 3/3. No failed case was retried or replaced. This is 4/5 selected outcomes, not a full twenty-world reliability score. The previous complete 305 evaluation remains 8/20. All natural trials used fresh worlds, empty inventory, normal survival, no supplied items or prepared terrain, and the 300-second job limit. Prepared smoke fixtures are separate.

The executable-file SHA256 manifest identifies the tested code. Public download remains the prior 293 package pending release evaluation. No stable 1.0 or rendered-client claim.

## Interpretation

355620996 exercised the pickup limit, preserved tracked drops and used three safe clearance digs before passing with no action timeouts. This supports the intended recovery mechanism. 1244186709 passed with four clearance digs but no returned pickup_limited=true result; different movement cannot be attributed solely to the new limiter. World42 stopped at full health with a zombie1.9 blocks away, after a partial collection. Its route diverged before the first pickup-limit activation, so neither a direct limiter regression nor purely random mob causality is established. Keep the observed failed outcome.
