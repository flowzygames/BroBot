# Short-scout endpoint novelty

Automatic scouting can back off to a four-block requested leg when longer routes are not certified. Its checked landing may legitimately be about three blocks from the origin. The origin was already recorded as an observation, and the previous four-block revisit radius therefore classified every such short success as non-novel. Adaptive continuity could not grow the next leg even when that endpoint was distinct from prior destinations.

Endpoint novelty now uses a revisit radius of `min(4, requestedDistance - 2)`. A four-block request uses two blocks, a five-block request uses three, and every request of six blocks or longer preserves the old four-block radius. Exact equality remains a revisit. Invalid endpoints or requested distances do not establish novelty.

This is a narrowly scoped scheduling heuristic, not evidence of unseen terrain, resources or a safe escape. Existing actual-completion checks, observed-position recording, spent-edge suppression, return-route certification and all time/step/scout/travel limits remain in force. Necessary retracing is not globally forbidden. Saved history is not reset.

The controller regression starts from an adaptive four-block leg, observes a verified three-block landing, and requests eight blocks next. It requested four again before this change. A landing near a prior observation remains non-novel; longer-leg revisit behavior stays unchanged. These fixtures prove the scheduling change, not completion of the previously failing natural world.
