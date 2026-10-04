# Equivalent completed scout endpoints

Selected 426 seed 1744809425 revisited a known corridor using 22-block and then 24-block west/east scouts. All four moves were recorded completed and non-novel, with endpoints separated by only 2.26 blocks; outward alternatives had genuinely failed route checks. Exact-length retry memory treated the new length as unspent.

The correction recognizes nearby horizontal endpoint equivalents only for plausible, completed, verified, explicitly non-novel attempts from the same local origin. Unverified probes remain length-specific so failed long routes do not exclude shorter ones. Returnability, boundary, scout-count and leg budgets remain unchanged.

The deterministic reproduction failed before the correction. The full check passed 429 tests before one additional boundary-only regression; all 24 focused scout tests now pass, including actual fractional/differing-height coordinates and exact threshold boundaries. Exact publication-head CI verifies the expanded suite.

Four-block XZ equivalence is an exploration heuristic, not proof that nearby landings or elevations are interchangeable. It can prune a useful nearby destination; physical evaluation is pending. This patch does not establish a viable stone route in the observed seed or change the public score.
