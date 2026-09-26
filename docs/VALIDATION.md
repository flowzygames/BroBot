# Validation

Status is recorded separately for offline logic tests, real-server fixture tests, client access, and an actual autonomous survival run. Passing one category does not establish the others.

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
| Bedrock authentication gate | A headless Bedrock 1.26.51 client reached Geyser, which rejected it with “Please log into Xbox to join this server.” No user credentials were accessed and authentication was not disabled |
| Launcher shutdown | `npm run play` started Paper, Geyser, and BroBot; clicking **Close BroBot** exited the bot and launcher with code 0, logged that all dimensions were saved, and closed the Java and dashboard ports |

The passing full run is `2026-09-26T23-31-53-618Z-599c1813`; its `result.json` records all 16 phases with `passed: true`. The transferred plank in this full run came from the logs the bot gathered. Portal construction took approximately 10.5 seconds, End eye insertion 25.0 seconds, and End entry 1.1 seconds in the prepared arena. The headless Bedrock check used `bedrock-protocol` 3.60.1 with its native RakNet backend; Geyser logged the authentication rejection at 19:25:44 local time.

These tests exposed and helped repair inventory synchronization, elevated-block visibility, item-transfer timing, and portal-entry pathing defects. They exercise prepared, loaded terrain; they do not certify unrestricted autonomous survival.

## Explicitly unverified

- A real OpenAI API request or model access for the user's account: no API key was available during validation. Planner behavior was tested with mocked Responses results.
- A signed-in Minecraft for Windows client login and its rendered game UI. Network startup, UDP replies, and the observed authentication rejection are narrower checks.
- Survival play over arbitrary terrain and long sessions, including resource acquisition for every milestone.
- A complete fresh-world, no-assistance dragon run.
- Stronghold bearing capture against a naturally thrown eye in a live world, beyond pure triangulation tests.
- A complete live dragon fight, protected-crystal handling, and robust combat survival.
- Nether portal traversal, return travel, and portal access in arbitrary terrain. The prepared End-entry fixture passed.
- Every platform/client combination, reconnect condition, and Bedrock gameplay difference.

Portal tools and combat controllers should be described by their observed test results and current limits. Their existence in the source is not a completion certificate.
