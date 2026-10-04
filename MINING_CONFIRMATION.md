# Server-confirmed mining candidate

This source candidate requires a raw Java1.21.8 server block update before counting a mined block. Mineflayer can predict air and resolve its dig promise even when the server refuses the edit; a local block event, changed cache, or sequence acknowledgment is not sufficient evidence.

After the existing reach, tool, footing, fluid and final-look checks, BroBot arms an exact-target observer, starts mining and directly awaits the mining operation. It accepts only a current server-air observation matching the loaded target. Inventory gain remains a separate measurement. A server update establishes observed state, not which actor caused it.

The receipt wait is limited to five seconds after digging. The entire observation also has a fixed deadline based on the initial dig estimate plus six seconds, capped at30seconds. Digs estimated above24seconds and unvalidated protocol versions are refused before mining. An unsupported version is not silently given cached-state fallback.

If an attempted edit cannot be confirmed, BroBot marks that bot connection's terrain untrusted, stops current work and disconnects. It will not try another resource or plan a path using potentially predicted air. The normal Runtime reconnect mechanism may create a fresh connection, but goals remain paused until explicitly resumed. Respawning or creating a new action object on the old bot does not clear the quarantine. The action lock is retained until its underlying operation drains; only an actual connection end retires that connection's runner.

This is a candidate safety change, not a new full-world score. Historical observer-only evidence is retained under benchmarks/results/server-block-receipts-2026-10-04. The separate diagnostic-confirmed-mining script verifies the integrated refusal/disconnection and successful mining paths. Prepared fixtures do not establish broad terrain reliability, Windows client behavior, Bedrock gameplay, or readiness for a stable1.0 release.
