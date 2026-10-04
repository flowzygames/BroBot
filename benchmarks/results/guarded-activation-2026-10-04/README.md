# Guarded block interaction — October 4, 2026

## Bugs fixed

- The native activation helper awaited aiming internally and could send a
  block interaction after Stop. Checking only before/after that helper was too
  late to prevent the packet.
- Sleep checked Overworld only before walking to the bed. A dimension change
  during navigation or aiming could therefore reach an explosive bed.
- The native sleep helper did not await its activation promise, and its timeout
  did not remove the sleep listener.
- Collision-face visibility could never see noncolliding levers/buttons.
  Interaction now uses a target-cell ray, like pinned Mineflayer's canSeeBlock,
  while preserving intervening collision occlusion. Mining rays are unchanged.

The application now awaits aiming, then validates cancellation, connection/entity
identity, dimension/session continuity, target state, visibility and reach before
sending the pinned Java 1.21.8 interaction packet synchronously. There is no await
between that final validation and the write. Sleep additionally rechecks night
or thunderstorm, occupancy and not-already-sleeping, and waits for its own bounded
server sleep acknowledgement. Timers/listeners are removed on all exit paths.
The action lock stays held while an already-started aim drains after Stop.

Session changes are also checked after observation/window-close and sleep
acknowledgement, preventing a replacement world's window from being inspected
or closed. A command already sent before Stop cannot be retroactively withdrawn.

## Verification

598 automated checks passed on source 7537a9f (full hash in manifest). Later
b991edc and e776606 changes affect only the prepared diagnostic harness; their
syntax was checked, and application/test files are byte-identical.

The final prepared fixture on clean
`e7766062f1b2a224b73f06a9327a052fec00a48c` verifies:

1. A real lever interaction changes the server-observed powered state
2. Cancellation while actual aiming is held sends no later interaction packet;
   the server-observed lever remains off
3. A real transition to the Nether during held sleep aiming sends no bed
   interaction. Both prepared Nether bed blocks remain intact, health 20
4. After returning, an explicitly empty inventory/hand receives actual sleep
   acknowledgement. The outgoing interaction records heldItem:null

The aim-delay gate and console-prepared/force-loaded arenas belong only to the
test harness. Exactly two interactions were sent, both in the Overworld. The
normal prepared suite passed 17/17 on b991edc with identical application code.
Its raw result has no commit field; the frozen checkout establishes provenance.
All complete runs had no cleanup error.

## Retained limits and unsuccessful setups

- 3444ac9 failed before its first click because the old collision visibility
 could not see the lever. This led to the interaction-only visibility fix.
- 7537a9f confirmed lever, cancellation and empty-hand sleep, then its native
 wake cleanup timed out. This does not prove wake works. The later fixture puts
 sleep last instead of relying on native wake.
- b991edc completed the broader fixture, but the final sleep was holding
 crimson_roots picked up in the Nether. It proves sleep acknowledgement, not
 empty-hand final sleep. e776606 explicitly clears and records the final hand.

Raw attempts and normal suite are archived with hashes. This is protocol-pinned
interaction verification, not a full-world survival improvement, natural
benchmark, stable 1.0 release, or public ZIP/Vercel deployment.
