# Correct Java 1.21.8 sprint commands — October 5, 2026 UTC

## Bug

The pinned Minecraft registry reported the old numeric entity_action mapping.
Mineflayer physics therefore emitted numeric 3/4 for sprint on/off. Actual
Java 1.21.8 serialization decoded those values as start_riding_jump and
stop_riding_jump, rather than sprint commands.

A queued per-bot compatibility plugin corrects only the
entityActionUsesStringMapper feature for exactly Java 1.21.8. It delegates all
other feature queries, is idempotent, leaves already-correct feature support
untouched, and never changes shared registry data or the packet writer.
Runtime registers it before pathfinder/tool consumers. Physics queries the
feature dynamically, so it now sends start_sprinting / stop_sprinting labels,
including the stop emitted by clearControlStates.

## Evidence

The actual plugin-loader/physics/serializer tests verify corrected 1.21.8 packet
meanings, unchanged 1.21.5 meanings, unchanged sneak input flags, and idempotence.
The original numeric mismatch is retained as a regression test.

Integrated frozen source: `8f3e30cc646aeb39e9325c4ae0bf8e29d5e97f26`.
610 automated checks passed. `sprint.json` records a prepared flat-lane test
through actual Runtime go_to and explicit Stop. Three distinct server say-result
lines from BroBotHome confirm server-side is_sprinting OFF → ON → OFF.
Outgoing entity_action labels agree, the action drains with the explicit Stop
reason, and all seven controls are false afterward. Connection remains live;
no health loss or cleanup error was observed in this short fixture.

This test stops soon after the server confirms sprinting. It demonstrates server
state and command compatibility, not faster movement, a speed ratio, or a
natural-world survival gain. The predecessor 602-check source's controlled result and
normal 17 are retained separately, not relabeled as integrated-source results.

The normal prepared suite also passed **17/17** on the integrated frozen source
(`prepared-17.json`), including a recovered pickup noPath within successful
four-log collection. Normal results have no commit field; the frozen checkout
and full source manifest establish provenance. No failed phase or terminal
cleanup error occurred.

## Scope

This fixes the app-reachable sprint path for the pinned protocol. It does not
repair every native entity_action helper. Native wake still uses a different
incorrect numeric value, and native elytraFly has a separate incorrect label;
neither was an exposed BroBot action in this change. Explicit wake is separate
work. Other Minecraft versions are not modified by this compatibility plugin.
Public downloads/site, historical full-cohort scores and stable 1.0 status remain
unchanged.
