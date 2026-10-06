# Read-only post-exposure stone certificate

`planExposedStoneRemoval` is a private planning boundary. It does not call mining,
walk, collect, equip or inventory-changing APIs, and is not routed to the public
Runtime or automatic starter. Its return value is snapshot evidence, never
permission for a later ordinary `dig_at`.

An exact in-process successful excavation result supplies target and provenance
through a WeakMap. Coordinates are frozen independently of mutable result fields.
This protects against JSON/copy reconstruction, not arbitrary trusted in-process
code: the internal writer is intentionally exported for the executor.

Durable protections are original origin, home, current actual feet, all external
points seen during excavation, and fresh caller-supplied points. The default also
retains actual temporary excavation arrivals. Only the private Symbol allows
retirement of overlapping executor-owned temporary arrivals for this one target,
and a point with external provenance remains protected even if also temporary.
No footprint tolerance or terrain receipt requirement is relaxed.

Planning reobserves the already-excavated world, checks settled current support,
and models only the named stone as air. It requires before/after bidirectional
home routes and post-removal pickup access/home routes with complete recorded
terrain dependencies. Before signatures describe stone; after/pickup signatures
describe the virtual air state. Later code must not compare after signatures
literally against the pre-dig world.

Four bounded epoch listeners per bot revoke receipts across spawn, respawn, end
or untrusted-terrain events. Ordinary per-plan listeners still detect changes
while planning. Caller-array snapshot checks detect mutation of that supplied
array, not replacement of an external provider's array.

A future owned collector must freshly sample that provider immediately before
digging, synchronously recheck target/support/dependencies after aiming, maintain
cancellation and terrain watchers during mining, validate the raw receipt and
actual post-removal world, then independently verify pickup and inventory.
Neither this proof nor exposure alone enables automatic mining. A paused
exposure-only starter feature would also need explicit admission/retry rules;
blindly resuming ordinary collection would bypass this boundary.
