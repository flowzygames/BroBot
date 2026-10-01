# Fixed-endpoint pickup preflight

Pickup targets are not ordinary destinations: a dropped item may sit in a sealed,
one-block pocket. Searching toward that pocket from a large open area can use
most of the planning allowance even when searching back from the pocket would
reject it almost immediately.

For an already validated pickup standing cell, the planner now:

1. Requires an integer cell that satisfies the exact walking goal
2. Searches from that cell back to the action's original standing neighborhood
3. Searches from the actual bot position to that exact cell
4. Rejects either timeout, missing path, terrain edit or mismatched endpoint

Both searches share the original deadline. This does not increase the budget,
allow digging/placement/parkour, move the bot during planning, or make an unsafe
route legal. Generic block-face and other non-fixed goals keep their original
forward-then-reverse ordering.

## Evidence and limits

A failed development run on world 42 ended with six cobblestone while several
remaining drops sat in disconnected pockets. It did not pause or reconnect;
the run diverged from a previous success during ordinary log gathering. The
pause/resume fixes have no demonstrated causal role in that failure.

A read-only diagnostic on the saved final terrain, with 16 loaded chunks and an
80 ms search allowance, compared three selected landing cells. Forward-first
search exhausted that allowance after 840–1,165 visited nodes. Reverse-first
rejected the same cells in 0.40–0.97 ms after 1–4 nodes, without starting a forward
search. These are static diagnostic measurements, not gameplay speed or success
scores. They establish cheaper rejection of those sealed endpoints only.

The tests cover isolated endpoints, valid round trips, failed forward routes,
wrong endpoints, terrain-edit rejection, timeouts and invalid fixed targets.
The live-world result must still be measured separately. Nearby stone clearance
is a separate unresolved recovery capability; this change does not add it.
