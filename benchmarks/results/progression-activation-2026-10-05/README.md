# Guard progression item interactions immediately before sending

Final frozen source: `a9374eeb169cc40f6a695f027f976fd80a6370b3`.

Two raw Mineflayer activation calls remained in Nether ignition and End-eye insertion. Native activation awaited aiming internally, then sent a block interaction even if Stop or a session change had occurred. The surrounding progression check rejected afterward, too late to prevent the packet.

Both now use the app-owned guarded seam. It captures the target state, deep item identity and cursor geometry, awaits aiming, then synchronously rechecks the session/cancellation, current target, positive held count, item identity, reach and unobstructed top face before sending. Cursor Y remains 1 for ignition and .8125 for eyes. Existing core center-cursor behavior is unchanged. Counts need to remain positive; unchanged count is not required.

## Verification

- 672 automated checks passed on unchanged application/test bytes. Twenty focused cases cover both actions with Stop, dimension change, round-trip dimension change, replaced client, item swap, component mutation, empty item, changed target and obstructed face; successful cases verify packet geometry and observed completion.
- The final prepared real-server fixture cancelled ignition during held aim without a packet. End-eye insertion held across a real Nether transition likewise emitted no packet or inserted eye there.
- Subsequent normal Overworld ignition and eye insertion were server-observed successes, with exactly two captured main-hand interaction packets and preserved cursor Y values.
- All 17 normal prepared phases passed on the final frozen source, including actual Nether construction/lighting, End-frame activation and End traversal.
- The two initial fixture attempts are retained: one support platform overwrote the Nether frame; after separation, the initial view was obstructed. Both were refused before aiming or interaction. The final fixture changed only the test layout/start pose, not application code.

## Scope

Prepared peaceful arenas use supplied items, complete frames, console teleportation and artificial aim holds. This proves the tested final-packet safeguards and normal server acceptance, not autonomous acquisition of portal materials, full-game completion or rollback of packets already sent. Earlier integrated652 natural diagnostics remain separate, with their original source identity.
