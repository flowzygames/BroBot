# Server-acknowledged sprint and wake — October 5, 2026 UTC

Frozen combined source: `2a5150c5b57682d6bdcfca00043f44f8ccef8b09`.
**617 automated checks and 17/17 prepared Minecraft phases passed.**

## Correct sprint command mapping

Pinned Java 1.21.8 uses a shortened string-mapped entity_action enum. Native
physics emitted old numeric 3/4, which actual protocol serialization decoded as
start_riding_jump / stop_riding_jump. The per-bot, version-gated compatibility
plugin makes physics use the correct sprint labels, without changing shared
registry data or packet-writing methods. Other versions and already-correct
feature support are untouched. Earlier isolated evidence is retained in the
[sprint record](../sprint-protocol-2026-10-05/README.md).

On this combined source, actual Runtime go_to and explicit Stop produced three
unique server-side is_sprinting predicate confirmations: OFF → ON → OFF.
Outgoing labels agree, controls release, and the action drains. This short
prepared-lane proof establishes state transitions, not a measured speed gain.

## Explicit wake command

The native wake helper also used an obsolete value: numeric 2 means stop_sprinting
on 1.21.8, not stop_sleeping. This change adds an app-owned `wake` action and exact
offline aliases `wake` / `wake up`. It sends the correct stop_sleeping label only
on explicit invocation, then waits for own server wake acknowledgement and an
observed awake flag. It never changes the flag optimistically or automatically
wakes from Stop, cleanup or reflex code.

The action holds its lock while waiting. Cancellation, timeout, session changes
and send failures clean every listener/timer. Wrong versions and already-awake
state refuse before sending. Shared sleep acknowledgement retains its existing
safety checks. Native elytraFly has a separate unsupported enum issue and is not
an exposed BroBot action; this does not claim a global native-protocol repair.

The real prepared night fixture confirms sleep → wake → sleep, exactly one
stop_sleeping command and matching own animation 2 plus awake metadata. The
second sleep is acknowledged. The predecessor standalone wake result is retained
separately; it is not relabeled as the combined source.

## Scope and retained evidence

`sprint.json`, `wake.json` and `prepared-17.json` belong to the combined source.
The normal result format lacks a commit field; the frozen clean execution and
manifest establish provenance. Both controlled source manifests match; no
cleanup errors occurred. Normal integration retained one recovered pickup
noPath while collecting all four required logs.

These are prepared protocol-state/integration tests. There is no natural-world
reliability improvement score or speed comparison. Earlier whole-world scores,
the public download/site and stable 1.0 status are unchanged.
