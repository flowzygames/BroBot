# Local pickup transit clearance

Sometimes a dropped item has standing space, but the exit between that pocket
and the bot is too low. Looking only above the item misses this transit obstacle.

The starter can now consider one visible ordinary natural block in its local
neighborhood, only after the existing clearance check found no candidate. It
uses a read-only hypothetical terrain view and the installed movement rules.
The existing reverse pocket must be conclusively sealed within the bounded
probe; after the hypothetical edit, both an exact return route and a forward
route must be found. Unknown terrain, clipped searches, exhausted budgets and
one-way routes do not authorize an edit.

The probe has an 80 ms / 512-node total limit, at most 12 candidate blocks and a
small local search area. It requires the full starter dry-land movement policy.
It never mutates the real world, actor position, active goal or movement index.
The normal dig action subsequently rechecks the expected block, tools, support,
liquid exposure and falling-block hazards. Actual pickup and inventory changes
remain the success evidence. It uses the existing eight-clearance job limit.

Aquatic plants and bubble columns carry water even when their waterlogged flag
is false. The probe and live harvest action share an explicit fluid-bearing
block check. Pickup also recognizes only zero-collision-shape snow as an empty
standing cell; raised snow is not assumed to be a full integer-height cell.

Two saved local geometry fixtures verify reversible candidates with the real
installed movement model and an independent A* check. A neighboring one-way edit
is rejected. These fixtures are static regression evidence, not proof of live
collection, broad terrain reliability, or a complete natural-world starter run.
A prepared saved-world diagnostic verified recovery of ten pre-existing cobblestone and a return with inventory intact, without deaths or respawns. A targeted natural replay of seed1542908414 completed the full starter objective in242.380 seconds and used the same dirt-obstruction recovery. The original three known worlds also passed. These are bounded development results; the wider paired rerun is still pending. Full records are linked from benchmarks/RESULTS.md.
