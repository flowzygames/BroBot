# Expanded-body contact correction

The supported client half-width expansion can start about 3e-8 blocks inside
an adjacent face at exact .3/.7 coordinates. The older contact tolerance was
only 1e-9 at the recorded location, so prediction allowed inward movement while
the server repeatedly corrected the player back.

The correction raises the minimum inward-contact clipping tolerance to 4e-8.
The existing 1e-7 maximum, orthogonal-overlap conditions, version gates and
synchronous restoration are unchanged. It does not push or teleport a player,
change server attributes, authorize edits, or alter deeper-overlap handling.
Outward and tangential movement remain available.

## Evidence

Two new regressions failed before the change and pass afterward: the exact
leaf AABB and one real prismarine-physics tick. The uncorrected tick predicted
x=129.77958618 from x=129.7, penetrating the leaf; correction clips X and retains
the safe Z slide without mutating the live entity.

The archive contains two prepared replays of copied, known-world terrain.
Among every recorded source hash, only src/collision-contact.js changed; fixture
commands were identical. Recorded server position corrections fell from 59 to 0.
The second run completed the approach and two grounded descents, with three
receipt-confirmed soil edits.

Neither complete soil gate passed: the first stalled on approach; the second
correctly stopped and quarantined when removing grass also cleared an unmodeled
snow layer. That separate experimental planner issue is not hidden or counted
as success here. This is targeted collision evidence, not a natural-world score,
a full survival benchmark, or a claim of general terrain reliability.

Both owned servers stopped and both source snapshots remained unchanged.
Archive and result hashes, exact commits, counts and limitations are in the
manifest. The private soil executor used to expose this defect is not included
in this isolated production fix.
