# Adaptive scout distance

The starter controller can get stuck planning the same long compass routes.
Previously, leg length increased solely with total scout count: after ten scouts,
all remaining attempts targeted 64 blocks, even if no movement was possible.

The new behavior records each actual probe's direction, distance and outcome.
Only a complete set of unverified eligible directions triggers backoff near that
origin. The next scout tries half the failed distance, down to four blocks.
Moving more than two blocks away stops applying that location's backoff.
Incomplete probes, cancellation, a verified route followed by walking failure,
and old records without outcome evidence do not imply a fully failed sweep.

This does not authorize extra exploration or unsafe movement. The existing
24-scout cap, 256-block job radius, shared 1,600 ms planning window and forward
and reverse walking verification remain. Both intended and floored targets are
checked against the boundary. No new digging or placement is introduced.

## Evidence and limits

The candidate passes 300 automated checks, including seven new regression
cases for backoff, reset, boundaries, incomplete/cancelled probes and a single
eligible route. Local tested source: bf4c3e5267ed4df3f0e42be3959539918bfca612.
GitHub source 3204ea42d82f165f6c6514f8fcbe3f22b4cbc070 has the identical tree
491bc180deac1cfeafd59a5be1beca320da7b1b9.

The targeted known world 1276821265 still failed: exploration exhausted after
210.146 seconds with a wooden pickaxe, not the complete starter kit. Shorter
attempts produced additional observed positions but did not solve resource
acquisition. This is not an improved full-cohort reliability score.

A first attempt stopped before gameplay because the server could not download
its Mojang jar. The separate recovery used an existing official jar whose SHA256
matched the embedded Paper download context. Both records are retained under
`benchmarks/results/adaptive-scout-2026-10-03/`. No items were supplied, terrain
was not edited by the harness, and the world was freshly generated.

The same first candidate passed selected regression world 718224 in 100.958
seconds. This pair of selected worlds is not a full-cohort rerun.

## Successful-distance continuity

A second candidate retains the requested leg length after a physically completed
scout, tied to its actual observed endpoint. While still within two blocks of
that endpoint, subsequent exploration grows by at most four blocks if the
endpoint was new (more than four blocks from previous observations). Returning
to a previously observed position does not grow the leg. Local failed-sweep
backoff can still shorten it. A planning success or claimed action success
without sufficient actual displacement cannot establish this record.

This addresses the first candidate repeatedly jumping from successful 8–12 block
legs back to failed 48–64 block attempts. The second candidate passes 303 checks;
its natural-world results must be recorded separately, not substituted for the
first candidate's failure.

The broad-continuity candidate 7a8cd38 also failed world 1276821265 after
231.330 seconds, exhausting its exploration allowance. Its record is preserved
as `continuity-1276821265.json`; this is a separate unsuccessful iteration.

The final scoped variant applies continuity only when a successful leg was
shorter than the original schedule for that scout. Uninterrupted open-terrain
scouting therefore preserves the old 12,12,24,24,36,36 schedule. Additional
regressions cover this scope and failed-sweep precedence. No claim is made
that shorter legs solve the remaining canopy/resource-access limitation.

## Scoped candidate verification

Application source d13c245070d7d9fc9b5431bb8f8fddec43d3405a passes all
305 automated checks and all 17 prepared live integration phases. Its original
three known natural worlds completed the fixed 300-second protocol:

| Seed | Outcome | Seconds |
| --- | --- | ---: |
| 718224 | Starter kit and return | 100.973 |
| 42 | Starter kit and return | 133.938 |
| 20260930 | Starter kit and return | 76.810 |

All began with empty survival inventory in fresh worlds and ended alive, with
both required items, within the completion distance of home. The consistency
reporter accepted all three matching clean-source records. These are known
regression cases, not proof of general reliability. The scoped candidate has
not run the complete twenty-world cohort or the difficult canopy seed. The
previous two failed canopy experiments remain above and in the evidence folder.
GitHub CI passed remote 1cd20038d13102aebaaccf9440302941a24d8f18, whose tree
matches this tested application source. Later evidence-only commits do not
change that application source.
