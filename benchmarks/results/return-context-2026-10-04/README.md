# Return-probe context and observed arrival identity

## Evidence and limitations

The frozen 413-check evaluation of seed 1744809425 crafted both kit items but stopped after inconclusive return-planning failures. Terminal health was 20, but its raw journal includes an earlier 20-to-18 loss. Saved terrain showed that an earlier canopy waypoint had lost support. These observations do not prove a surviving route home.

The separate frozen 426-check run timed out at 300.004 seconds with the kit while repeatedly walking between two observed waypoint regions. Nominal points (4.31,71,0.47) and (10.48,72,24.34) were represented by actual radius-accepted arrivals (4.5,71,1.5) and (10.38,72,23.32). The earlier 0.1-block edge matcher failed to reconcile them, reopening spent routes. The final eight steps contained four cycles. This correction was not in that frozen run.

## Correction

- Match failed edge endpoints and repeated travel attempts by observed standing cell, absorbing sub-block jitter while preserving distinct cells
- Use validated successful radius-1 arrival receipts as intermediate waypoint representatives, while still requesting the original nominal target
- Persist at most 64 arrival aliases alongside retained observed waypoints; prune discarded waypoints and retain identity after the short action history expires
- Reject malformed saved aliases and mismatched, unsuccessful, implausible, or wider-radius receipts
- Check both representative distance and emitted integer target against the existing 96-block leg bound
- Preserve actual home/table goals and explicit final-leg identity; resume clears failed edges for fresh verification

435 automated checks pass on the revised source, including history expiry, pruning, malformed reload, radius mismatch, rounding, alternative routes and repeated-cycle regressions. Read-only review found no blocking defect. All actual walks still require the existing physical safety certification. No teleportation, assumed path, automatic completion, enlarged exploration budget, natural-world improvement or release is claimed. Physical verification is pending.
