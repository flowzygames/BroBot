# Architecture

BroBot is one local Node.js process controlling one Minecraft: Java Edition client. It does not contain an LLM, call a cloud service, or require a hosted control plane. Mineflayer speaks the Minecraft protocol directly to the configured server; a small HTTP server and terminal loop provide local controls.

## System map

```text
Minecraft chat/whisper ─┐
Terminal command line ──┼─> CommandRouter ─> TaskManager ─> domain services
Local dashboard/API ────┘         │               │              │
                                  │               │              ├─ navigation
                                  │               │              ├─ resources/inventory
                                  │               │              ├─ farming/building
                                  │               │              └─ combat
                                  │               │
                                  │               └─ cancellation + safety timeout
                                  │
                                  ├─ authorization by command source
                                  └─ validated parser and bounded flags

                       BotRuntime / Mineflayer
                                  │
              local Minecraft: Java Edition server

StateStore ── waypoints, routes, last death
Logger ────── terminal output + bounded dashboard log buffer
```

The process is deliberately layered. Command handlers translate a human request into a bounded service call. Services own game mechanics. `BotRuntime` owns the Mineflayer connection and plugins. This keeps chat authorization, cancellation, and configuration separate from block- and entity-level work.

## Startup and shutdown

At startup, the entry point:

1. Loads built-in defaults, merges the optional JSON configuration, applies supported environment-variable overrides, and validates the result.
2. Resolves the data directory relative to the config file (or the current directory when no config file is supplied) and loads persisted state.
3. Creates the logger, runtime, task manager, command router, dashboard, and terminal command loop.
4. Starts the dashboard when enabled, then begins the Mineflayer connection.
5. On `SIGINT`/`SIGTERM`, cancels active work, clears physical controls, disconnects the bot, stops the dashboard, and closes the terminal input.

Connection loss is separate from process shutdown. When reconnect is enabled, `BotRuntime` uses capped exponential backoff. A `maxAttempts` value of `0` means unlimited attempts. A successful spawn resets the attempt counter. A pre-spawn network attempt is cancelled after 30 seconds so a stalled TCP/status/login path cannot hold the process indefinitely.

## Configuration boundary

`src/config.ts` owns defaults, deep merging, validation, and environment overrides. Unknown JSON properties are not used by current code, so spelling matters. The supported environment overrides are:

- `MC_HOST`
- `MC_PORT`
- `MC_USERNAME`
- `MC_AUTH` (`offline` or `microsoft`)
- `DASHBOARD_TOKEN`

Numeric limits are validated before the bot starts. Important limits include task duration, gather count, build size, search radius, and movement behavior. See `config.example.json` for the complete shape.

## Minecraft runtime and plugins

`src/bot-runtime.ts` creates the Mineflayer bot and loads these pinned plugins:

| Component | Responsibility | Important caveat |
|---|---|---|
| `mineflayer` 4.37.1 | Protocol, world/entity state, inventory, chat, crafting, windows | The negotiated server version must be supported. This pinned release advertises Java Edition 1.8.8 through 1.21.11. |
| `mineflayer-pathfinder` | Route planning and movement goals | It only knows loaded world data and can fail on doors, hazards, unusual blocks, unloaded chunks, or a changing world. |
| `mineflayer-tool` | Chooses an appropriate carried tool | It cannot use an item the bot does not possess and does not make a dangerous block safe to mine. |
| Local armor scorer | Equips strong carried armor without a background plugin | Scores armor points, toughness, protection, and durability; rejects Curse of Binding and does not auto-equip elytra. |
| `mineflayer-auto-eat` | Hunger-triggered eating below 15 food points | The runtime bans several risky foods, including raw chicken, and disables delayed return-to-old-item behavior; food can remain selected after eating. |

BroBot does not use `mineflayer-collectblock`. Its resource worker selects a bounded set of loaded targets, paths without ordinary route digging, revalidates the exact block, checks flow/falling-block and configured protections, equips a carried harvesting tool, calls core Mineflayer digging, and follows only drop entities observed beside that break for a bounded pickup window. It requires an empty inventory slot before each mining or farm-harvest break so a full inventory does not knowingly strand new drops. Veins use a bounded in-process flood search over loaded blocks.

General pathfinding disables parkour, one-by-one towers, scaffolding placement, and ordinary route digging. Source and legacy flowing lava are avoided; source/flowing water can also be avoided. The configured `protectedBlocks` are added to the pathfinder's cannot-break set (including every colored shulker variant when generic `shulker_box` is listed), but this is a name-based guard, not a claim that every valuable block or modded container is automatically protected. Protection matching treats `furnace`/`lit_furnace` and `spawner`/`mob_spawner` as equivalent legacy names. Bed and wood helpers similarly recognize legacy `bed`, `log`, and `log2` registries when present.

Mineflayer's connection is supplied a custom direct TCP connector so every socket, including the status client used during `version: "auto"`, can be cancelled. Consequently, `minecraft.host` and `minecraft.port` must be the actual endpoint: ordinary A/AAAA hostname resolution works, but Minecraft DNS SRV service discovery is deliberately skipped and SRV-only domains are not resolved.

All Minecraft identifiers are resolved through the registry for the connected version. A newer server can introduce protocol or registry behavior that the pinned stack does not understand even if the TCP connection succeeds.

The current production audit (`npm audit --omit=dev`) reports 8 moderate transitive findings, no high/critical findings, and no current non-breaking fix. The root is `uuid` through `prismarine-auth`/`minecraft-protocol`, plus Mineflayer-ecosystem packages inheriting the finding. Do not use `npm audit fix --force`; follow upstream, retest deliberate dependency upgrades, and retain the loopback-only network boundary.

## Command path and trust model

Every input becomes the same `ParsedCommand` and is executed by the same router:

- Terminal input is source `console` and needs no command prefix.
- Dashboard/API input is source `dashboard` and needs no command prefix.
- In-game messages are source `chat`; the application removes the configured one-character prefix before routing.

The parser supports single/double quotes, backslash escaping, `--flag value`, and `--flag=value`. It rejects duplicate or malformed flags, control characters, and commands over 1,000 characters. Individual handlers reject unknown flags and bound numeric arguments.

Console and dashboard callers are treated as local operators. Chat callers may use commands named in `commands.publicCommands`; all other non-local commands require a case-insensitive username match in `commands.allowlist`. `localOnly` commands are never accepted from chat.

This is an authorization convenience, not identity security on an offline-mode server. With `online-mode=false`, the server does not prove that a connection owns its username. Anyone who can reach that server can claim an allowlisted name. The safe default is therefore to bind the game server and dashboard to `127.0.0.1`. If remote players are required, use authenticated Minecraft mode or a separately secured network and re-evaluate every trust assumption.

## Task and cancellation model

Movement, mining, fighting, farming, building, transfers, crafting, smelting, and similar physical work run through a single `TaskManager`.

- Only one managed task runs at a time.
- A second action is rejected with `TaskBusyError` unless it accepts `--replace` and that flag is supplied.
- Replacement first aborts the old task and waits for its promise to settle before beginning the new worker.
- Each task receives an `AbortSignal`, `checkpoint()`, and abort-aware `sleep()`.
- `safety.maxTaskSeconds` creates a hard wall-clock cancellation request.
- `stop` aborts the task and calls runtime cleanup: clear the pathfinder goal, stop digging, clear controls, deactivate the held item, and close an open window.

Cancellation is cooperative. A network packet, plugin operation, or server response already in flight may finish before cleanup is observed. Treat `stop` as rapid best effort, verify the bot's state, and disconnect or stop the server if the physical outcome is safety-critical.

## Domain services

### Navigation

Navigation validates dimensions, uses near/dynamic/avoid goals, and provides coordinate travel, player following, patrols, bounded wandering, block location, and fleeing. Commands cannot path to an unloaded world as though it were a global map. Saved coordinates preserve the dimension so accidental cross-dimension routing is rejected.

### Resources and inventory

Resource work validates registry names, count/radius limits, digging policy, protected blocks, health, empty-slot capacity before breaks, and available recipes or windows. It covers direct bounded block and vein mining, dropped-item pickup, recipe inspection, crafting, furnace smelting, and fishing. Inventory work groups slots, equips/holds/eats, drops or gives items, and uses the nearest supported container for inspection and transfers.

These services are conservative rather than transactional. Minecraft provides no database rollback: if a task is cancelled after mining three of five blocks or depositing half a stack, those completed world changes remain.

### Farming and building

Farming scans known vanilla crop definitions, checks growth state, requires an empty slot before each break, directly digs mature crops, follows nearby observed drops, and replants when possible. Building first generates a bounded plan for a block, floor, wall, or hollow/solid box; it checks inventory, replaceability, protected blocks, distance, and placement support as it executes. Farming and building both stop at 6 health or lower.

Plans depend on the current loaded snapshot. Another player, gravity, fluids, falling blocks, entity collision, claims plugins, spawn protection, or a server-side rollback can change the result after preflight.

### Combat

Combat filters and summarizes nearby entities, supports explicit mob attacks/hunts, guards against a conservative hostile-name set, and can flee. It is implemented with core Mineflayer attacks plus pathfinder rather than a shared-listener combat plugin: the service selects a carried sword/axe, bounds chase distance, aborts pursuit/attacks at low health, stops after 15 seconds without pathing progress, and enforces optional guard leashes. Low-health abort does not itself find shelter. Player attack requires both a local control source and explicit PvP configuration. Entity detection is limited to what the server has sent to the client.

## Dashboard

`src/dashboard.ts` is a dependency-free Node HTTP server serving static files from `public/` and four JSON endpoints:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | `GET` | Dashboard process health and uptime |
| `/api/status` | `GET` | Bot status, task, players, and inventory |
| `/api/logs?after=<id>&limit=<n>` | `GET` | Bounded in-memory log polling |
| `/api/command` | `POST` | Execute `{ "command": "status" }` through the router |

Static assets are public so the browser can display its token prompt. API routes require `Authorization: Bearer <token>` whenever `dashboard.authToken` is set. With an empty token, API requests are accepted only through a loopback hostname. A non-loopback bind requires at least a 32-character token, and failed authentication is rate-limited per remote address. Security headers, request-size limits, method checks, and JSON validation reduce accidental exposure; they do not turn this into an internet-facing administration product.

## State and logs

`StateStore` persists `.brobot-data/state.json` by default. It stores:

- case-normalized waypoints;
- named patrol routes as coordinate arrays;
- the last observed bot death position;
- an update timestamp.

Writes are serialized and use a temporary file followed by rename. Newly written state uses owner-only mode where the platform supports POSIX permissions. Do not edit the file while the process is running; an in-memory state update can overwrite manual edits.

The logger writes at or above the configured level to the terminal and retains up to `logging.maxEntries` entries in memory for dashboard polling. It is not a rotating logfile and is cleared when the process exits.

## Extending the bot

For a new capability:

1. Put game mechanics in a service under `src/services/` and accept a `TaskContext` for physical or long-running work.
2. Add cancellation checkpoints before and after important Mineflayer/plugin calls and inside loops.
3. Enforce configuration limits and registry validation in the service even when the command handler already validates input.
4. Register a small command definition in `src/commands/register.ts`, with exact usage, allowed flags, source restrictions, and spawn requirements.
5. Add parser/service tests and run `npm run check`.
6. Update `docs/COMMANDS.md` and any affected safety notes.

Avoid calling a new capability “safe” merely because its normal path is bounded. Document partial completion, server-side permission failures, version dependence, and what cancellation can leave behind.

## Deliberate non-goals

- Bedrock Edition and Bedrock protocol bridges
- bot farms or multi-account orchestration
- bypassing authentication, anti-cheat, claims, bans, or server rules
- a global world map or guaranteed route completion
- autonomous goals chosen by a cloud model
- internet exposure of the offline-mode server or dashboard
- redistributing Minecraft or Paper server jars

Use the bot only on a world/server you own or where the operator permits automation.
