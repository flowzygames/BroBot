# Scoped empty collection retry verification

Frozen application `5a1522588e3d4be770bae849e0db55f097501248`, tested October 8, 2026. All 1,056 automated checks and all 17 prepared real Minecraft phases passed. Independent review found no blocking correctness issue. [Scheduling contract and limits](../../../docs/EMPTY_COLLECTION_RETRY.md).

The controller regression demonstrates that an unrelated global terrain revision no longer restarts gathering after a stationary failed scout when a continuously watched complete-empty search hint remains valid. Nearby or unknown changes, missing receipts, movement, cancellation, lifecycle changes and fresh materials still invalidate the hint. Actual ActionRunner integration, listener cleanup, real timer expiry and stale callbacks are covered.

## Natural world result remains incomplete

Known seed 1276821265 still failed: the original 96-step limit was reached at 166.438 seconds, without cobblestone. The run used fresh natural terrain, empty survival inventory, no supplied items, no paid model and the unchanged 300-second protocol. Source was clean at the frozen commit.

Two stationary rejected scouts were immediately followed by another scout, showing the intended continuation in those cases. This is not proof of overall world improvement. The final run made 13 exploration calls and still exhausted its step budget. Its failure is retained in full. The earlier 14/20 full-cohort score remains tied to `fb69b493`, not this change.

## Evidence

`empty-retry-evidence.tar.gz` includes the complete failed natural-world result, event journal, memory and server log, successful prepared result/server log, source hashes, automated-check output and harness records. Every member was read back and byte-compared. `manifest.json` contains archive/member checksums.

The initial npm smoke wrapper was interrupted before server setup by a registry network-policy refusal. No gameplay ran in that attempt. Existing dependencies were already installed; the same local smoke script was then run directly with Node, without requesting registry access. That actual prepared run passed all 17 phases and saved/stopped the server. The checksum-verified previously downloaded Mojang jar was reused through the recorded cache wrapper.

This does not activate private excavation, extend work budgets, replace the public Core 0.2 download, verify a graphical Windows/Bedrock client, or establish stable 1.0 readiness.
