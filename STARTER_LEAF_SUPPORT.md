# Retained leaf support protection candidate

Automatic starter mining must not remove the observed log connection keeping a protected leaf floor supported. The shared mining preflight checks both logs and leaf connectors before equipment/aiming and again immediately before the confirmed mining transaction.

Protected evidence is bounded: saved home, the last 64 observed positions, up to 64 retained actual waypoint arrivals, and the current grounded footprint. Nominal target coordinates and table-block locations are not substituted for actual arrival positions. A point must match a full-block top within 0.03 blocks; interpolated heights such as 73.54 are not rounded into standing evidence. The current grounded footprint stays protected even in the controller's stop margin outside the 256-block waypoint radius.

For each relevant loaded leaf support, the guard hypothetically replaces the intended target with air and requires a retained log connection through at most six leaf blocks. An alternate connection permits mining. Missing relevant support, unloaded proof or a severed final anchor refuses the edit with STARTER_SUPPORT_PROTECTED. Removing the support leaf itself is also refused. The existing bounded anchor helper is reused.

Typed collection refusals exclude that candidate within the existing 128-position limit and allow other safe targets. Repeated protected-support failures do not trigger destructive foliage clearing. A protected recovery dig stops truthfully instead of retrying the same connector. Direct controls outside the automatic starter retain their existing behavior.

This is not a reservation of every return path, a prediction of decay timing, or protection against external changes and already-missing supports. It does not establish that a previously failed world will finish. The broader guard replaces the closed home-only prototype in PR 44. It remains part of the development source rather than a new stable release.

## Verification so far

- 517 automated checks pass, including sequential anchor alternatives, leaf connectors, current-footprint changes within one collection action, final equipment/aim revalidation, bounded evidence, the live stop-margin edge case and typed controller recovery
-A prepared real-server fixture refused two protected-anchor requests, allowed exactly one log removal with an alternate anchor, retained the leaf support and completed a separately requested return with health 20
-The allowed dig's pickup did not succeed: it reported mined 1 but completed=false after three no-progress pickup attempts. This fixture proves anchor preservation and return, not material acquisition
-The current-footprint check used the real loaded world through a direct helper assertion, not another physical mining attempt. Waypoint evidence was supplied by the harness; autonomous completion remains separate

The unchanged application also passed all 17 normal prepared Minecraft phases. See prepared-17.json; this is compatibility evidence, not a natural-world score.
