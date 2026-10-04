# Validation

Status is recorded separately for offline logic tests, real-server fixture tests, client access, and an actual autonomous survival run. Passing one category does not establish the others.

## Latest complete source evaluation

Frozen source `5b66f11` passed 454 automated checks and 17/17 prepared phases, then completed 13/20 known worlds and 3/3 separate originals under the existing 300-second Trailhead protocol. Every result and full event journal is retained in [the complete evidence archive](../benchmarks/results/recovery-full454-2026-10-04/README.md). One passing run took skeleton damage. These repeated development cases do not prove broad reliability, client compatibility or a particular fix's isolated effect. The public Core 0.2 package and its separate frozen evidence are unchanged; later source patches require their own validation.

## Historical September 30 recovery checkpoint

The September 30 recovery source passed 141 automated tests and all 16 Linux real-server regression phases. One targeted fresh-world starter run passed in 215.975 seconds. This does not establish general survival reliability; the earlier frozen comparison remains 0/3. See [current results and raw evidence](../benchmarks/RESULTS.md). The dated records below describe earlier source versions and remain historical.

## Commands

```sh
npm test
npm run check
npm run test:live
```

The live test starts a fresh isolated server under `.server/smoke/<timestamp>/`, prepares a controlled arena through the server console, and connects a survival-mode Mineflayer client. Console preparation belongs to the test harness; the production bot does not receive operator privileges.

The initial gathering/crafting/building sequence begins with an empty survival inventory. Later fixtures supply cobblestone, sand, coal, armor, a shield, food, obsidian, flint and steel, and eyes; a hunger effect prepares the eating check. This is a test of skills, not proof that the bot independently acquired those resources.

Each run writes `result.json` and `smoke-server.log` in its isolated directory. `.server/last-smoke.json` points to the most recently finished result. When separate focused runs execute concurrently, the latest file may refer to only one selected subset; read its `selection`/fixture description and phase list.

## Build validation record

The implementation was checked on 2026-09-26 using Node.js 24.14.1 and Java 21 on Windows with:

| Component | Version |
| --- | --- |
| Minecraft world | Java 1.21.8 |
| Paper | 1.21.8 build 60 |
| Mineflayer | 4.39.0 |
| Pathfinder | 2.4.5 |
| Geyser | 2.11.3 build 1247 |
| ViaVersion | 5.12.0 |

The server startup and an actual Bedrock UDP status response have been observed. The bridge advertised Bedrock 26.51, protocol 2193. Mineflayer connected to the real server in survival mode. Logic tests include strict tool schemas, action cancellation, observed inventory calculations, API budget reservation, malformed/concurrent model-call refusal, portal geometry, eye-ray triangulation rejection cases, and bow trajectory calculations.

`npm run check` passes source syntax checks and **58 tests**. The complete real-server suite passed **all 16 phases**. These observations were recorded in the suite and separate client/launcher checks:

| Live fixture | Observed result |
| --- | --- |
| Navigation and Stop | Walked around a solid obstacle without digging; cancelling active movement released controls and allowed the next action |
| Gathering and crafting | Mined four logs by hand, collected four actual drops, crafted 16 planks, then a table, sticks, and a wooden pickaxe using the 3×3 grid |
| Building | Placed an inventory block and built a four-block floor; checked all five blocks in the world |
| Furnace | Crafted a furnace from fixture cobblestone; smelted two sand into glass in separate calls using one coal, reusing the remaining heat |
| Equipment and eating | Equipped an iron chestplate and offhand shield; ate cooked beef and observed food rising from 17 to 20 |
| Owner controls and item transfer | Actual chat from another connected client was ignored; commands from the configured owner were handled; the owner's inventory gained one plank after BroBot gave it |
| Nether portal | 14 owned obsidian placed in survival; flint and steel ignited it; active portal blocks observed |
| End portal | All 12 missing eyes inserted from owned inventory; the central End portal block observed |
| End entry | Bot approached a supported rim, entered the active opening, and observed an actual Overworld → End transition |
| Account-free Bedrock connection | A headless Bedrock 1.26.51 client using `offline: true` and `SELF_SIGNED` login spawned without Microsoft/Xbox credentials. A Java Mineflayer observer saw the player and received its chat |
| Launcher shutdown | `npm run play` started Paper, Geyser, and BroBot; clicking **Close BroBot** exited the bot and launcher with code 0, logged that all dimensions were saved, and closed the Java and dashboard ports |

The passing full run is `2026-09-26T23-31-53-618Z-599c1813`; its `result.json` records all 16 phases with `passed: true`. The transferred plank in this full run came from the logs the bot gathered. Portal construction took approximately 10.5 seconds, End eye insertion 25.0 seconds, and End entry 1.1 seconds in the prepared arena.

### Account-free local connection

The initial bridge configuration rejected unsigned Bedrock logins. The updated configuration sets `advanced.bedrock.validate-bedrock-login: false`, keeps Java `online-mode=false`, and forces both listeners to `127.0.0.1`. This uses a setting in the installed Geyser build; no game-client patch or Microsoft credential is involved.

A separate isolated test on 2026-09-26 local time (`2026-09-27T01:14:43.870Z`) passed all four checks: server startup with authentication disabled, an offline Java observer joining, an unsigned Bedrock player spawning and appearing to that observer, and Bedrock chat arriving in Java. The test used `bedrock-protocol` 3.60.1, native RakNet, Bedrock 1.26.51, and isolated ports 25575/19142. It saved and stopped the server cleanly. No Microsoft authentication callback ran. Geyser was exactly 2.11.3 build 1247, upstream commit `63a4e2b79b12f0d138777d5fd80176a112b4bd72`.

The user confirmed **Add Server is available while signed out** in their Minecraft for Windows menu. An actual rendered client joining and playing remains to be confirmed. The protocol test establishes the server path, not every client UI. Geyser still rejects the separate split-screen `GUEST` login type; the passing test used `SELF_SIGNED`.

These tests exposed and helped repair inventory synchronization, elevated-block visibility, item-transfer timing, and portal-entry pathing defects. They exercise prepared, loaded terrain; they do not certify unrestricted autonomous survival.

## Planner safeguard regression record (2026-09-30)

`npm run check` passes syntax checks and **83 tests** after adding planner safeguards (the original 58 plus 25 regressions). The new tests use mocked Responses output and runtime observations; they do not establish live model behavior.

Coverage includes returned partial/blocked outcomes and action-specific pickup/combat/eye-bearing result contracts, canonical argument order, cross-argument no-progress limits, mixed thrown/returned failures, positive partial progress and recovery, observation/chat non-progress, rejected and retried premature completion, fresh inventory verification and stack totals, text-only bypass rejection, ordinary conversation, compound/unsupported goal reports, actual destination dimensions, and current-goal dragon-death evidence. The original `completed: false, mined: 1` example is deliberately treated as partial mining progress; zero-progress partial results and blocked results are bounded independently. Mined blocks alone still cannot certify inventory acquisition.

No gameplay action implementations were changed for these safeguards. They do not provide an arbitrary natural-language goal verifier, a full autonomous survival strategy, or new proof of live model access. The earlier real-server validation record remains separate from these planner tests.

## Explicitly unverified

- A real OpenAI API request or model access for the user's account: no API key was available during validation. Planner behavior was tested with mocked Responses results.
- A signed-out Minecraft for Windows client joining and its rendered game UI. Add Server availability is user-confirmed; unsigned protocol login, spawn, and cross-edition chat passed independently.
- Survival play over arbitrary terrain and long sessions, including resource acquisition for every milestone.
- A complete fresh-world, no-assistance dragon run.
- Stronghold bearing capture against a naturally thrown eye in a live world, beyond pure triangulation tests.
- A complete live dragon fight, protected-crystal handling, and robust combat survival.
- Nether portal traversal, return travel, and portal access in arbitrary terrain. The prepared End-entry fixture passed.
- Every platform/client combination, reconnect condition, and Bedrock gameplay difference.

Portal tools and combat controllers should be described by their observed test results and current limits. Their existence in the source is not a completion certificate.
