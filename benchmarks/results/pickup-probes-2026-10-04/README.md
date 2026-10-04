# Distinct failed pickup probes — October 4, 2026

## Fix

Pickup previously cycled destinations by attempt number. With two unchanged
unreachable standing cells, it planned A, B, A; a sole cell could be planned
three times. A bounded invocation-local ledger now suppresses already-failed
destinations only while the observed planning inputs remain unchanged.

Context includes exact bot/drop position, grounded state, dimension and entity
object identity. Block/chunk and entity collision events invalidate observations.
The context is captured before awaited planning; a change during that wait
cannot attach the old failure to the new context. Successful navigation with
no collection is not recorded as a failed route and keeps its existing retry
behavior. Exhausted destinations yield to another item without a synthetic
third failure or a permanent blacklist.

The original three attempts, 24 passes, eight-second allowance and route budgets
remain. Ledger memory is limited to 64 entities and three cells per entity;
listeners are removed on exit. It resets for a separate pickup invocation.

## Verification

- Frozen clean source: `98087b53ef9c55292e1fae2135da0d2e70ca61bc`
- 549 aggregate syntax/automated checks passed
- New tests cover distinct probes/fairness, terrain changes during planning,
  exact context changes, collision events, entity identity, bounds and cleanup
- Existing initial collection cap and starter deferral assertions remain
  unchanged. Two old fresh-direct-pickup expectations were updated from three
  duplicate probes to the actual one or two distinct available cells
- The actual unchanged no-path fixture failed its distinct-probe expectation
  on old code and passed after the fix

`distinct-probes.json` is a real Java 1.21.8 controlled stone enclosure with
two safe standing cells that have no return path to the bot. The planner tested
`(3,64,0)` and `(4,64,0)` once each. Both failed; no fabricated third failure was
reported. The item remained, with no inventory gain, digging or bot movement.

The normal prepared integration suite also passed **17/17 phases** on the same
frozen source (`prepared-17.json`). Its raw format has no commit field; the
frozen checkout and file hashes establish provenance. No cleanup errors occurred.

## Limits

This saves duplicate work only under unchanged observed inputs. Moving entities
and terrain updates can legitimately permit another probe. The controlled
fixture does not independently log every invalidation event or establish a
natural-world completion gain. It does not make an unreachable item reachable,
increase budgets, or weaken route/landing safety. No new full benchmark score,
public ZIP deployment or stable 1.0 release is claimed.
