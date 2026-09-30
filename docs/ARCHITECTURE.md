# Architecture

BroBot has one physical Minecraft client, a local dashboard, and an optional OpenAI planner. The planner receives a fresh observation and the recent action results, chooses one tool, and then waits for that tool's actual result before making another decision.

```text
Bedrock client ── Geyser + ViaVersion ──┐
Java 1.21.8 client ────────────────────┼── Paper 1.21.8 local world
                                      └── Mineflayer / BroBot
                                             │
                            dashboard / terminal / owner chat
                                             │
                                      serialized actions
                                             │
                                   optional OpenAI planner
```

## Modules

| File | Responsibility |
| --- | --- |
| `src/runtime.js` | Connections, owner authorization, command routing, snapshots, low-health pause, idle eating |
| `src/brain.js` | Responses API requests, one decision at a time, recent history, budget accounting, pause/completion state |
| `src/planner-guards.js` | Conservative whole-goal completion contracts, runtime evidence, canonical action signatures and observed partial progress |
| `src/runner.js` | Exclusive action lock, deadlines, stop signal, draining before reuse |
| `src/actions.js` | Ordinary Mineflayer navigation, inventory, gathering, building, and combat operations |
| `src/progression.js` | Portal operations, observed eye bearings, bow trajectory calculations, bounded End combat |
| `src/memory.js` | Atomic JSON saves, waypoints, notes, usage, and rotated event logs |
| `src/commands.js` | Direct command parsing and owner-only prefixed in-game commands |
| `src/web.js` | Loopback HTTP dashboard, bounded JSON requests, origin/host checks and per-process request token |
| `scripts/server.js` | Versioned downloads, hashes, Java discovery/install, EULA, local server configuration |
| `scripts/play.js` | Combined server/bot lifecycle and graceful world shutdown |
| `scripts/smoke.js` | Isolated live Minecraft fixture tests |

## Planning and execution

The model cannot run arbitrary code, shell commands, or Minecraft operator commands. Its action vocabulary is the same inventory-backed tool set exposed in the dashboard. Tools use strict Responses function schemas; all schema properties are required, with nullable values for optional choices where appropriate.

Each request includes the owner's goal, current world snapshot, and up to eight recent action results. Requests use `store: false` and disable parallel tool calls. A response containing multiple function calls, malformed arguments, or an incomplete response status is rejected before game actions run. Thrown errors and returned `completed: false`, blocked, or unfired outcomes count toward retry limits when they contain no recognized progress. Action-specific checks also recognize unresolved pickup drops, blocked-crystal dragon attempts with no shots/melee, melee timeouts with no attacks, and unrecorded stronghold bearings. Combat movement permits recovery; active combat is not labeled zero progress simply because no kill occurred. After two failures of an equivalent action, another unchanged repetition pauses before execution; JSON key order cannot evade this limit. Three unsuccessful decisions without intervening recognized progress also pause, even if arguments change. Inspection, chat, and ambient snapshot changes do not reset these counters. Explicit runtime evidence of partial mining, pickups, placement, or other supported progress permits recovery; a partial result is not automatically a failure. Step and API limits still bound the overall run.

Direct commands skip model reasoning. Natural-language goals require an API key. An explicit `goal` requires a tool decision until the planner finishes or reports a blocker; it cannot silently complete after a planning sentence. `ask` allows an ordinary conversation response. No API request is sent merely because the bot starts.

### Completion verification

Only the following **whole-goal forms** have deterministic checks. Matching is case-insensitive, with optional leading `please` and a final `.` or `!`:

- `collect|gather|obtain|get|have [at least] N ITEM`: checks the **current inventory total**, including existing items, summed across stacks. `N` is a positive integer or one through sixteen. It does not claim those items were newly acquired during this goal. Use an exact snake_case item identifier or a `minecraft:`-prefixed identifier. Friendly aliases cover logs/planks (including wood-specific names), cobblestone, stone, coal, charcoal, obsidian, dirt, sand, glass, apples, diamonds, iron/gold ingots, ender pearls/eyes, blaze rods, sticks, crafting tables, and wooden/stone/iron/diamond pickaxes. Example: `Collect four oak logs`.
- `go to|travel to|enter [the] nether|end|overworld`: checks the current destination dimension, not an assumed portal success.
- `defeat|kill|beat [the] [ender] dragon`: requires a dragon-death event reported by `fight_dragon`, `attack`, or an identified-dragon `shoot` action during this goal. Old memory, inventory, End arrival, an exit portal, and entity disappearance do not qualify. A ranged kill whose target was absent from the bounded pre-action snapshot remains unverified.

The runtime supplies the contract and its current assessment in every model request. A `finish_goal` completion request is checked against a **fresh** snapshot after the response. Missing/contradictory evidence is returned to the planner for recovery; repeated premature claims hit the same bounded retry safeguards. Verified completion uses a runtime-generated evidence summary rather than repeating an unchecked model success claim. Persistent/recognized action goals cannot bypass this check through a text-only response. Ordinary conversation can still return text without tools.

Other wording, crafting/building goals, and compound goals such as `Gather four logs and craft a table` have no deterministic whole-goal verifier. When the model calls `finish_goal` with `complete` for one, its status is **unverified**, and its report is explicitly labeled as such. This avoids incorrectly requiring prerequisite logs that a compound plan legitimately consumed. Unverified is a terminal report for review, not proof of success or failure. `finish_goal` with a blocked outcome still stops and reports the problem directly. In automatic/`ask` conversation mode, unsupported wording may instead receive an ordinary text response with status `replied`; its prose is not deterministically verified. Use explicit `goal` mode to require tool-based decisions and terminal reports. The planner does not claim to verify arbitrary natural-language goals.

`ActionRunner` holds the physical-action lock until the underlying operation settles. A stop aborts its signal and releases movement, mining, item use, and windows. It does not pretend an inventory transaction vanished instantaneously. New physical work must wait while the old transaction drains. Death and disconnection stop the goal; reconnecting does not silently resume it.

Movement avoids automatic digging and scaffold placement. Construction is explicit. Actions inspect actual inventory, loaded blocks, coordinates, and server updates. Collection distinguishes mined blocks from items actually obtained. A returned partial result does not mean the full request succeeded.

## Progression details

`observeProgression(snapshot)` derives preparation guidance from observed equipment and inventory. It always labels full-game completion unverified. Inventory cannot prove that a fortress was explored or the dragon was defeated.

- `build_nether_portal`: validates a clear, supported 4×5 frame footprint, uses up to 14 owned obsidian, ignites with flint and steel, then checks for active portal blocks. A failed attempt reports partial construction; existing obsidian can be reused.
- `enter_portal`: finds an active nearby portal and waits for the dimension to change. End portals have no solid walking surface, so the bot approaches a clear, supported rim and takes a bounded step into the verified opening. Walking near a portal is insufficient confirmation.
- `locate_stronghold`: throws one owned eye, captures the new eye entity's movement, and persists a bearing. Separated throws feed a least-squares ray intersection. Nearly parallel, inconsistent, or backward intersections are refused. The estimate is a stronghold search location, not a portal room coordinate. Reset old bearings after changing worlds.
- `activate_end_portal`: identifies all 12 frames with inward-facing orientation before spending eyes. It checks inventory sufficiency, approaches from outside the opening, clicks visible top faces, observes eye state updates, and checks for active portal blocks.
- `shoot`: fully charges a bow, simulates an arrow path with drag and gravity, rejects blocked or unloaded trajectories, and reports observed results. It refuses player targets and shooting nearby explosive crystals.
- `fight_dragon`: bounded crystal shooting and perched-body melee, with food/health checks and dragon-breath avoidance. Multipart melee is restricted to Java 1.21.8. The body-part ID offset was checked against the actual server bytecode. Protected crystals can still require deliberate climbing and bar removal before this controller can continue.

Trajectory calculations are approximations. Bow spread, target movement, latency, server conditions, and geometry can cause misses. The controller reports attacks sent separately from observed entity death. A missing dragon is not accepted as proof of victory.

## State and budgets

`.brobot/memory.json` stores notes, waypoints by dimension, owner name, recent goal status, eye bearings, and cumulative API counters. Writes use a temporary file followed by rename. The current world is the server's `.server/world` data; bot memory is not a world save and should not be copied between unrelated worlds without reviewing its waypoints and bearings.

Before a request, the planner reserves input/output allowances. Successful responses reconcile the allowance using API-reported token usage. Failed or cancelled requests retain their reservation. Limits survive restarts and are reset only through an explicit user action. Token estimates and cached-input pricing mean these counters should not be treated as an exact bill.

The event journal rotates around 5 MB. It contains game observations and conversations; the runtime redacts its configured API key from emitted logs. `.env`, `.brobot`, `.server`, and dependencies are ignored by Git.

## Local networking

The prepared Java server, Bedrock bridge, and dashboard bind to `127.0.0.1`. Java/offline authentication is intentional for this private same-computer setup. This configuration is not a public-server deployment recipe. Owner names are a local control convenience, not an authentication substitute for an internet-exposed offline-mode server.

Geyser translates Bedrock clients onto the Java server, and ViaVersion handles the bridge's Java protocol compatibility. A successful UDP status response verifies that Geyser is listening and advertises a Bedrock protocol; it does not verify every client login or gameplay feature.

Account-free local play requires both Java offline mode and Geyser's `advanced.bedrock.validate-bedrock-login: false`. Setup writes both settings while forcing the two game listeners onto `127.0.0.1`. Java offline mode alone does not turn off the Bedrock identity check. This uses Geyser's existing configuration option, with no plugin patch or stored Microsoft credentials. Player names are local identities, so the configured owner identifies a local player rather than a verified Xbox account. The installed Minecraft client's signed-out menu behavior is a separate compatibility concern.

## Extension boundaries

A reliable fresh-world completion agent still requires repeated survival runs, obstacle-specific recovery, long-range exploration, fortress and stronghold strategies, and robust crystal-cage handling. New skills should have bounded scope, explicit cancellation, clear failure results, and real postcondition checks. A stronger model alone cannot repair a missing physical capability or a false success signal.
