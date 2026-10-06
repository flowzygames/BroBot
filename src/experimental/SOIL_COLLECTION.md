# Private owned stone collection

The private Actions facade can collect the single stone named by an exact,
in-process soil exposure result. It is absent from public tool definitions and
Runtime/automatic starter routing. Call it only under the ActionRunner lock with
a strict current-owner guard and a finite deadline.

It obtains a fresh counterfactual removal certificate inside that owned action.
Before entering mining and again after equipment/aiming, it checks the union of
before/after/pickup dependencies, translating only the named target's virtual air
back to its observed stone signature. Fresh external protections are sampled
again. All durable protections remain intact; only the recorded temporary private
arrivals may be retired through the explicit internal policy.

The existing mining protocol confirms the raw server-air receipt and drains the
dig even on cancellation. A private confirmation callback preserves that receipt
before an outer post-await ownership check can reject. Terrain, column, entity,
health, policy, session and cancellation watches remain active through the edit,
proof-constrained pickup walk and actual return home. Success requires a settled
home arrival and a fresh increase in observed cobblestone inventory.

Partial results distinguish a confirmed edit from an entered mining hook.
`mining_hook_entered` does not prove a dig packet was sent. An unfinished target
remains explicit while confirmation is missing. Inventory is refreshed on failure
only for the original valid play session; `inventory_observation_current` makes
stale or unavailable current inventory evidence explicit. A receipt or inventory
gain is not erased merely because later walking or cancellation fails.

This is still a private experimental transaction. It does not grant public
coordinates, accept serialized exposure records, activate the autonomous starter,
or establish general natural-world reliability. Automatic admission, persistence,
retry limits and full-world evaluation remain separate work.
