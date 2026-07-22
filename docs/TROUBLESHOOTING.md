# Troubleshooting

Start with three observations:

1. Read the terminal line immediately before and after the failure.
2. Run `status` from the bot terminal or dashboard.
3. Decide which layer failed: Node application, dashboard, Minecraft connection, command validation, pathfinding/plugin action, or server-side permission.

The bot logs in ISO timestamps with a scope such as `minecraft`, `commands`, or `dashboard`. Set `logging.level` to `debug` temporarily for more application detail. The in-memory log buffer is bounded and disappears when the process stops.

## Installation and startup

### `npm ci` or `npm install` cannot reach the registry

The first dependency installation requires internet access. Check DNS, proxy, firewall, and npm registry configuration. If `node_modules` is already complete on the same platform, routine runtime operation does not download packages; otherwise reconnect to the internet and run:

```sh
npm ci
```

Do not delete a working `node_modules` directory while intentionally offline. The bot itself is cloud-free at runtime, but a local Minecraft server jar and all Node dependencies must already exist.

### Node reports an unsupported engine or syntax/module error

This project requires Node.js 22 or newer.

```sh
node --version
npm --version
```

Java and Node are different runtimes: `node --version` validates the bot requirement; `java -version` validates the Minecraft server requirement. Installing one does not install the other.

### `Cannot find module .../dist/src/index.js`

`npm start` runs compiled output. Build first:

```sh
npm run build
npm start -- --config ./config.json
```

For interactive uncompiled operation, use `npm run dev -- --config ./config.json` instead. `npm run dev:watch -- --config ./config.json` is intended only while changing source: its watch supervisor can intercept terminal input and restarts the bot after watched files change, so do not use it for normal bot control. If the build fails, run `npm run typecheck` to get the TypeScript error without emitting files.

### The config file cannot be opened or parsed

Confirm the path is relative to the directory where you launched the process, not the source file. JSON does not permit comments or trailing commas.

```sh
cp config.example.json config.json
node -e "JSON.parse(require('node:fs').readFileSync('config.json','utf8')); console.log('valid JSON')"
```

Common validation failures:

- `commands.prefix` must be exactly one character.
- Ports must be integers from 1 through 65535.
- `minecraft.auth` must be `offline` or `microsoft`.
- reconnect maximum delay cannot be below the initial delay.
- count/radius/task limits must fall inside the ranges named by the error.
- `logging.level` must be `debug`, `info`, `warn`, or `error`.

Environment variables override the JSON file. Check `MC_HOST`, `MC_PORT`, `MC_USERNAME`, `MC_AUTH`, and `DASHBOARD_TOKEN` when the effective settings seem surprising.

## Local Minecraft server

### The server immediately creates files and exits

That is the expected first run. It creates `eula.txt` and stops. Read the [Minecraft EULA](https://www.minecraft.net/eula) yourself; only if you agree, change `eula=false` to `eula=true`. This repository intentionally does not include or preaccept that file.

### `Unable to access jarfile`

Run Java from the directory containing the downloaded jar and use its actual filename. This repository does not redistribute Vanilla or Paper jars.

```sh
cd local-server
ls
java -Xms1G -Xmx2G -jar server.jar nogui
```

Rename your legitimately downloaded jar to `server.jar`, or change the command. On Windows PowerShell use `Get-ChildItem` instead of `ls` if preferred.

### `UnsupportedClassVersionError` or Paper refuses the Java version

The server's Java requirement is independent of the bot's Node requirement. Use the Java version required by the exact server version. Paper's compatibility table lists Java 21 for Paper 1.20 through 1.21.11; newer Paper releases may require a newer Java runtime. Verify with:

```sh
java -version
```

See [Paper's current requirements](https://docs.papermc.io/paper/getting-started/) or the instructions accompanying the Vanilla jar.

### The human player or bot gets `You are not white-listed on this server`

The supplied server-properties example enables the whitelist. Add both exact offline-mode names from the server console:

```text
whitelist add BroBot
whitelist add YourMinecraftName
whitelist list
```

`BroBot` must match `minecraft.username`. Restart or use `whitelist reload` after editing whitelist files manually; the console command is safer.

### The server says a username is already connected

Offline-mode identity is the username. The bot cannot use the same name as your client or another bot. Give every connection a distinct valid Java username and restart the bot.

### The client/server version is incompatible

The pinned Mineflayer 4.37.1 advertises Minecraft: Java Edition support through 1.21.11. It does not claim support for 26.1 or later. Set `minecraft.version` to `auto` first; if detection is ambiguous, set the exact server version, such as `"1.21.11"`.

Use a server release inside the supported range. Do not assume the current “latest” Vanilla or Paper download is compatible. The game client also needs a version accepted by that server unless a server-side compatibility plugin intentionally changes this.

### The bot says `Failed to verify username`, `Invalid session`, or authentication failed

Match both sides:

- For the isolated local setup, set the server to `online-mode=false` and bot config to `"auth": "offline"`.
- For an authenticated server, leave `online-mode=true` and configure `"auth": "microsoft"`; complete any device/account prompts in the terminal. Microsoft authentication is not runtime-offline and may contact Microsoft services.

Never solve an internet-server authentication failure by casually disabling `online-mode`. Offline mode permits username impersonation.

### Nobody can connect after copying the example properties

`server-ip=127.0.0.1` intentionally allows connections only from the same computer. Use `127.0.0.1:25565` from the local client and keep the bot's host at `127.0.0.1`.

If you genuinely need LAN access, changing the bind address expands the security boundary. With `online-mode=false`, any reachable client can claim any username, including an allowlisted bot operator. Prefer `online-mode=true`. Do not port-forward this offline-mode example, and keep OS firewall rules restrictive.

## Bot connection and lifecycle

### `ECONNREFUSED`, `Connection refused`, or endless reconnect messages

Check, in order:

- the Minecraft server is running and has reached `Done`;
- `minecraft.host` and `minecraft.port` match `server-ip` and `server-port`;
- no environment override points somewhere else;
- the server process is listening on the expected IP family;
- the OS firewall permits local loopback traffic;
- the server version is supported.

The configured host and port must be the actual TCP endpoint. BroBot uses a direct connector so it can cancel every socket; it does not perform Minecraft DNS SRV discovery. If a friendly domain works in the game only because of an SRV record, configure that record's real target and port instead.

The bot uses exponential reconnect delay up to `minecraft.reconnect.maxDelayMs`. `maxAttempts: 0` means it will keep trying until you stop the process.

### Status remains `connecting` or commands say the bot has not spawned

Connection is not the same as world spawn. Look for a kick reason, whitelist error, resource-pack prompt/plugin behavior, server overload, version mismatch, or a world-generation stall in both terminals. Commands marked as requiring spawn are intentionally rejected until the `spawn` event. The pre-spawn network watchdog cancels an attempt after 30 seconds and normal reconnect policy then applies; repeated 30-second timeouts usually indicate an unreachable/misconfigured endpoint or a stalled protocol negotiation.

### Reconnect happens after an intentional server stop

That is expected when automatic reconnect is enabled. Stop the bot process too, disable `minecraft.reconnect.enabled`, or bound `maxAttempts` if you do not want indefinite attempts.

### The bot died and stopped its work

Death records the last observed position in persisted state, but the interrupted task is not resumed. After respawn, inspect `status` and inventory, then use `recover` if the position is in the current dimension and reachable. A death position is a coordinate, not proof dropped items still exist.

## Commands and permissions

### Should terminal/dashboard commands include `!`?

No prefix is needed outside Minecraft chat. Use:

```text
status
```

For convenience, the current entry point also strips one leading configured prefix from terminal/dashboard input, so `!status` works there too. In Minecraft chat, the prefix is required:

```text
!status
```

### The bot ignores in-game chat

Verify the message starts with the exact one-character `commands.prefix`. The bot ignores its own messages. Some servers/plugins transform chat or whispers; test ordinary public chat first and inspect bot logs for a received/accepted command.

### `Not authorized for that command`

Chat permissions are command-specific:

- names in `commands.publicCommands` are usable by any chat identity;
- other non-local commands require the sender in `commands.allowlist`;
- local-only commands are always refused from chat.

Offline-mode allowlists do not authenticate identity. Fix server reachability/authentication rather than treating the bot allowlist as a security perimeter.

### The parser consumes an argument as a flag value

Both `--flag value` and `--flag=value` are supported. A bare flag consumes the following non-flag token, so use the explicit form when the next positional argument could be ambiguous. Use `--` to stop parsing flags.

```text
say -- "--this begins with dashes"
goto ~ ~1 ~ --range=2
```

Quote names/messages containing spaces. Backslash escapes the next character. An unmatched quote or trailing backslash is rejected.

### `Task is busy` / another task is already running

Only one managed physical task runs at a time. Choose one:

```text
status
stop
goto 10 64 10 --replace
```

`--replace` is accepted only by action commands that document it. Replacement cancels and waits for the old task before starting the new one.

### `stop` returned but the last action partly happened

Cancellation cannot roll back world changes. A block already broken, item already tossed, or stack already transferred stays changed. Mineflayer/plugin calls already in flight can settle just after cancellation. Confirm status and surroundings; disconnect the bot or stop the server if immediate physical isolation is required.

## Movement and world sensing

### `No path to the goal`, pathfinder timeout, or the bot oscillates

Mineflayer routes through loaded blocks, not a complete server map. Check:

- target and bot are in the same dimension;
- chunks around the route are loaded;
- doors, fences, trapdoors, water, lava, scaffolding, powdered snow, boats, and unusual blocks are not confusing the route;
- the target is not sealed behind blocks when route digging is disabled;
- another entity/player is not continuously blocking the path;
- the requested `--range` is realistic;
- server lag is not delaying movement acknowledgements.

Try a nearer intermediate coordinate, a larger goal range, or manually create a walkable route. General navigation intentionally disables parkour, one-by-one towers, and digging.

### `locate` says no block exists even though one exists farther away

`locate` searches loaded block data inside the configured/requested radius. It is not the server's `/locate` command and does not search unexplored chunks. Move closer or increase `--radius` up to `safety.maxSearchDistance`.

### A saved waypoint or death location refuses cross-dimension travel

Coordinates retain their dimension. The bot does not autonomously find and traverse portals for a coordinate command. Enter the correct dimension first, then retry.

### `come`, `follow`, `give`, `look`, or `guard <player>` cannot find a player

The player must be visible to the bot as an entity, usually in the same dimension and inside server tracking distance. Username matching is case-insensitive in navigation, but use the exact visible name to avoid ambiguity.

## Mining, inventory, crafting, and farming

### Mining is disabled or a protected block is rejected

Set `safety.allowDigging=true` only on a world where digging is permitted. Names in `safety.protectedBlocks` are deliberately refused. The default list protects common containers/furnaces, spawners, TNT/respawn anchors, fire/portals/end gateways, and command/structure/jigsaw blocks. Legacy pairs are equivalent, so configuring either `furnace`/`lit_furnace` or `spawner`/`mob_spawner` protects both names. Expand the list for valuables or modded/plugin-provided blocks; name matching cannot infer ownership.

Server spawn protection, claims plugins, adventure mode, or anti-cheat can also deny a break even when bot configuration permits it.

### Mining, chopping, or drop collection stops below the requested count

The requested count is a ceiling, not a guarantee. Work is limited by loaded matching blocks/entities, search radius, inventory space, health checks, tool/dig time, cancellation, task timeout, and path availability. Mining and chopping conservatively require at least one empty inventory slot before each direct break; free a slot even if a stack might otherwise merge. Completion and per-item failure summaries are written to logs.

### Inventory shows a different count after a transfer

Minecraft window updates are asynchronous. A cancellation, server plugin, full destination, stale container view, or item metadata mismatch can produce partial movement. Close/reopen the container and rerun `inventory`, `count`, or `container inspect`. The service matches registry item names; differently enchanted/named items can still have the same base name.

### Container commands cannot find a chest

The service chooses the nearest supported, loaded container in range. Verify it is accessible, not blocked, not already open by a conflicting plugin, and not a protected/custom container type. `container` commands are local-only because they can move valuable items.

### `recipe` says missing ingredients/table, or `craft` fails

Recipes depend on the negotiated Minecraft registry and bot inventory. Some recipes require a crafting table within `--radius`; the bot must be able to reach and open it. The command does not recursively craft ingredients. Use `recipe <item> <count>` to inspect candidate recipes, then gather prerequisites explicitly.

### `smelt` cannot find a furnace or times out

Smelting deliberately uses a nearby empty furnace to avoid mixing with existing jobs. Ensure:

- an ordinary supported furnace is loaded and reachable;
- its input, fuel, and output slots are empty;
- the bot carries the input and a known fuel, or provide `--fuel <item>`;
- `safety.maxTaskSeconds` is long enough for the requested count;
- another player/plugin is not changing the window.

A timeout may leave input, fuel, or output in the furnace. Inspect it manually before retrying.

### Fishing fails immediately or never catches anything

The bot needs a fishing rod in inventory and a valid cast location. Stand it beside sufficiently open water with line of sight. Weather, server tick rate, plugin mechanics, obstruction, and task timeout affect results.

### Farm scan finds zero crops

The scan sees only loaded blocks within radius and only the crop types printed by `help farm`. Growth-state representation is version-dependent. Move the bot into the field, increase `--radius`, or scan `all`. Harvesting also needs digging enabled and at least one empty inventory slot before each crop break. Replanting requires the correct seed/plant item and suitable unchanged soil/space. Harvest/tend stop at 6 health or lower.

## Building

### `Building is disabled` or a plan exceeds the limit

Set `safety.allowBuilding=true` to permit placement. A plan may contain width × depth, width × height, or many box-shell/volume coordinates; every plan is capped by `safety.maxBuildBlocks`. Reduce dimensions or raise the cap intentionally after considering inventory and task duration.

### The bot has blocks but cannot place them

Placement needs a reachable position, a replaceable target, a solid neighboring support face, adequate reach, and permission from the server. Air-only floating structures often fail because there is no support. Build from supported lower layers outward. Fluids, snow, plants, entities, gravity-affected blocks, spawn protection, and claims can alter placement.

### A build partially completes

Plans preflight against a snapshot, but the world can change during execution. The builder skips occupied targets rather than destroying arbitrary existing blocks, and it reports skipped/failed counts in logs. It stops at 6 health or lower and does not roll back placed blocks. Reinspect the area and use smaller follow-up plans.

## Combat and survival

### `pvp` is refused

Both controls are intentional:

- `safety.allowPvp` must be `true`;
- the command must come from terminal or dashboard, never in-game chat.

The target must be an exact visible player in range. Do not enable PvP without the server owner's and target player's permission.

### `attack` will not attack a player

That command filters players out. Use the explicitly guarded `pvp` command if and only if authorized. `hunt` targets matching non-player mobs.

### Auto-eat does not eat

Check `autoeat status`, hunger, and available safe foods. Background eating is hunger-only and begins below 15 food points; low health alone does not trigger it. Raw `chicken`, `rotten_flesh`, `pufferfish`, `chorus_fruit`, `poisonous_potato`, `spider_eye`, and `suspicious_stew` are banned. At full hunger, name `golden_apple` or `enchanted_golden_apple` explicitly with `autoeat now` or `eat`. `autoeat off` cancels the plugin's current eating, while `eat [food]` is a separate managed action. The plugin intentionally does not restore the previously held item after eating, so food can remain selected until the next hand-owning action equips what it needs.

### Sleep fails despite a nearby bed

The bed must be a loaded registry bed in range, reachable, usable in the current dimension/time, and not obstructed or occupied. Modern colored bed names and the legacy `bed` name are recognized. The server decides whether sleep is allowed.

## Dashboard and API

### The dashboard page does not open

Confirm `dashboard.enabled=true`, read the logged listening URL, and check for `EADDRINUSE`. The default is [http://127.0.0.1:8765](http://127.0.0.1:8765). Change the port if another process owns it.

On a remote browser, `127.0.0.1` means the browser's computer, not the bot host. The dashboard is intentionally local by default.

### API returns `401`

A non-empty `dashboard.authToken` requires a bearer token on every `/api/*` request. Enter the token in the dashboard prompt or use:

```sh
curl -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:8765/api/status
```

Do not paste a real token into logs, screenshots, shell history shared with others, or bug reports. `DASHBOARD_TOKEN` overrides the JSON value, including when it is unexpectedly set.

### API returns `403` with an empty token

Tokenless API use is loopback-only. Use a loopback hostname/address and keep `dashboard.host` on `127.0.0.1`. The server refuses a non-loopback bind without a token of at least 32 characters. Tokens cannot have leading/trailing whitespace or control characters, and repeated failures are rate-limited. Adding a token is necessary but not sufficient to make internet exposure safe; use an authenticated private network and a proper reverse proxy only if you understand the risk.

### `POST /api/command` returns `400`, `413`, or `415`

Send JSON, include `Content-Type: application/json`, and keep the body/command within limits:

```sh
curl \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"command":"status"}' \
  http://127.0.0.1:8765/api/command
```

The API command string has no chat prefix. A syntactically valid command can still return a command result with `ok: false`.

## Persistent state

### Waypoints/routes disappeared

By default, state lives in `.brobot-data/state.json`, resolved relative to the config file's directory when a config path is supplied. Starting with a different config path or working directory can therefore select a different data directory. If upgrading from an earlier build that used `.bot-data`, move that directory to `.brobot-data` once before starting BroBot. Use an absolute `storage.dataDirectory` if you need a fixed location.

### `state.json` is corrupt or unreadable

Stop the bot before editing. Back up the entire data directory. A malformed existing JSON file causes startup to fail rather than silently discard data. Restore a known-good copy, or move the corrupt file aside and restart to create empty state. Preserve evidence if filesystem/storage failure is suspected.

### `EACCES`, `EPERM`, or rename errors while saving

Ensure the process account can create files and rename within the data directory. Avoid read-only/network-synchronized folders that interfere with atomic rename. Check disk space and antivirus/backup software. Do not run two bot processes against the same state directory.

## Deeper diagnostics

Use protocol debug output only briefly; it is noisy and may include server/account metadata.

macOS/Linux:

```sh
DEBUG=minecraft-protocol npm run dev -- --config ./config.json
```

PowerShell:

```powershell
$env:DEBUG='minecraft-protocol'
npm run dev -- --config ./config.json
```

For a useful problem report, include Node version, Java version, exact Minecraft server implementation/version, bot config with tokens/user-identifying values removed, the exact command, and the smallest relevant log excerpt. Do not include Microsoft auth caches, bearer tokens, public IPs, world files, or other secrets.
