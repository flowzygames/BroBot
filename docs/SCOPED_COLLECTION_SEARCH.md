# Keep widened traversal inside the collection sphere

Collection uses an expanded Manhattan chunk-section iterator so a requested Euclidean search radius does not lose diagonal corners. That iterator's outer region is not itself the collection radius. Previously, matching blocks in the outer region consumed the per-page matching budget before the collection filter rejected them.

`BlockSearchCursor` now accepts an optional `queryRadius`. Automatic collection supplies its original radius; generic cursor callers retain the previous native-parity behavior. The option requires a sufficiently widened iterator. Entire sections whose inclusive integer-coordinate bounding box cannot intersect the query sphere are skipped. Remaining cells outside the sphere are skipped before reading or counting a matching block. Targets on the sphere boundary remain included.

This only changes target enumeration. Exposure checks still read neighboring blocks, including neighbors outside the sphere. Environment checks, candidate filtering, current-world route certification and mining admission are unchanged. No candidate, block object, route or safety verdict is cached by this optimization. Cancellation and time checks remain in every iteration, the matching cap remains 65,536, and collection pages still consume starter steps. No time, step, travel or excavation limit is expanded.

Missing columns and unknown cells within the sphere still prevent complete coverage. Data outside it does not change target-coverage accounting. Existing continuation watchers include the sphere plus the immediate neighbor layer; they retain their invalidation rules. Candidate-count termination remains incomplete coverage.

## Evidence motivating the change

The retained October 8 run of seed 1276821265 failed after 96 actions. Of those actions, 59 were bounded stone-search pages. At the recorded origin (-13, 76, -49), the widened radius-32 iterator covers 378 distinct sections, while only 75 intersect the actual sphere. The issue is unnecessary target enumeration, not evidence that mining should be allowed through unsafe terrain.

## Verification approach

Geometry tests compare complete visited-coordinate sets against independent integer-sphere enumeration, including negative origins and section boundaries. Dense fixtures preserve the exact unevaluated page-boundary cell and establish a three-page traversal of the 137,065 radius-32 cells under a fixed clock. Actual ActionRunner tests retain empty continuation through cleanup and inspection, discover a later candidate, reject its route, and preserve radius-plus-one exposure/fluid/unloaded-neighbor checks.

Synthetic work reduction is not a natural-world completion result. The known world may still lack a verified route to stone. Natural-world and prepared-server outcomes must be reported separately and tied to their tested source.
