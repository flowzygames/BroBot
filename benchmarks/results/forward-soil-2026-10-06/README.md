# Experimental forward soil staircase proposal

The planner is **read-only**. This experimental branch also adds a private
Actions executor and console-prepared diagnostic, behind an internal Symbol
and required ownership guard. Neither has a public tool definition or starter
route. No improved survival score or completed natural-world run is established.
The executor reuses server-confirmed mining, verifies each landing, and leaves
the exposed stone unmined. Modeled tests are not physical proof.

## Why this exists

The separately published 793-check build still failed the selected, known
1542908414 survival attempt after 300006 ms, with no cobblestone. The world had
stone underneath shallow soil. A bounded access proposal is a next feature to
investigate, rather than repeating that unchanged run indefinitely.

The proposed shape makes five soil removals in a forward staircase. A nearby
staging approach is allowed. Original, home, supplied protected feet positions,
and every subsequently reached landing retain their support. These inputs are
feet positions, not arbitrary protected-block coordinates.

## Reproducible static fixture

`test/fixtures/forward-soil-saved-world.json.gz` is a cropped block-state snapshot
from that saved Java 1.21.8 world. It includes its bounds, source result SHA-256,
home, origin, and retained feet positions. Cells outside its bounds are unknown,
not assumed air. Tests use the pinned real Mineflayer pathfinder/Movements.

The known modeled proposal approaches (130.5,63,81.5), removes five soil cells,
and exposes stone at (133,60,81). Every prefix, landing, and hypothetical pickup
has observed no-edit routes in both directions to home. The planner checks dry
corridors, retained leaf anchors, visible targets, falling-block hazards, and
protected support footprints. It captures route-search and validation reads as
expected block-state dependencies, including hypothetical air only after its
corresponding planned edit. It makes no live world changes.

## Limits and next gate

This fixture is a saved snapshot, not proof those cells are currently loaded.
The output is a proposal, not an execution authorization or a durable lease.
Movement callback identity cannot freeze arbitrary callback closed-over state.
A future executor must independently revalidate the current session, movement
policy, fresh route and target dependencies, protected positions, and real
physical pose. Each edit must use existing server-confirmed mining receipts;
each walk needs a confirmed landing and a recoverable return route. Live physics,
item pickup, deadlines, entity interference, and natural completion remain
unproven. Do not connect this planner to autonomous runtime before those gates.
