# Command reference

BroBot has one command language exposed through three control surfaces. These are bot commands, not Minecraft `/commands`.

| Surface | Enter | Example | Authorization |
|---|---|---|---|
| Bot terminal | command; prefix may be omitted | `status` | local operator |
| Dashboard or `POST /api/command` | command; prefix may be omitted | `goto ~5 ~ ~ --range 2` | local operator; dashboard API rules still apply |
| Minecraft chat or whisper | configured one-character prefix plus command | `!status` | public-command/allowlist checks; local-only commands rejected |

The examples below use the default chat prefix `!`. The definitive live summary is `help`; use `help <command>` for the registered usage string.

## Notation and parser rules

- `<value>` is required; `[value]` is optional; `a|b` means choose one.
- Command and flag names are case-insensitive. Minecraft registry identifiers and stored names are normalized to lowercase.
- Use vanilla registry identifiers such as `oak_log`, `iron_ingot`, or `minecraft:stone`. Spaces and hyphens are not item/block identifier substitutes.
- Separate arguments with whitespace. Single and double quotes keep spaces together: `say "meet at the north gate"`.
- Backslash escapes the next character. A trailing backslash or unmatched quote is an error.
- Flags support `--name value` and `--name=value`. Boolean values accept `true/false`, `yes/no`, and `1/0`; a bare boolean flag means true when it is last or followed by another flag. Put bare booleans after positional arguments so they do not consume the next token.
- `--` stops flag parsing: `say -- "--not-a-flag"`.
- Duplicate, malformed, unknown, or valueless numeric flags are rejected.
- Coordinates may be decimals, absolute values, or Minecraft-style relative values: `~`, `~5`, `~-2.5`. They are relative to the bot's position when the command is accepted.
- Coordinates are bounded to ±30,000,000. Commands also impose smaller radius, count, and plan bounds.
- Router input is limited to 1,000 characters. Replies are control-character stripped and truncated per line.

## Tasks, limits, and completion

Most physical actions start a managed task and immediately reply with a task number. Successful completion, partial counts, and detailed failures are written to the terminal/dashboard logs; use `status` to see active work.

Only one managed task runs at a time. `--replace` tells an action that supports it to cancel the old task, wait for cleanup, and begin the new one. `stop` cancels current work and clears movement, digging, held-item use, open windows, and combat pursuit. All tasks are cancelled when they exceed `safety.maxTaskSeconds`.

Configured caps are hard ceilings:

- `safety.maxGatherCount` bounds mining, items, recipes, farming, transfers, and fishing counts.
- `safety.maxBuildBlocks` bounds the total placements in a build plan.
- `safety.maxSearchDistance` bounds most searches.
- `safety.allowDigging`, `allowBuilding`, and `allowPvp` gate destructive capabilities.
- `safety.protectedBlocks` prevents the resource/builder/pathfinder layers from intentionally breaking configured block names.

Any listed search-radius default (such as 16 or 24) is automatically reduced when `safety.maxSearchDistance` is smaller.

Cancellation is not rollback. Already broken/placed blocks and completed inventory transfers remain changed.

## Chat permissions

Terminal and dashboard callers are local operators. In-game chat follows this order:

1. A `localOnly` command is always rejected.
2. A command whose primary name is in `commands.publicCommands` is allowed for any sender.
3. Otherwise, the sender's username must match `commands.allowlist` case-insensitively.

Aliases do not create separate permission names; list the primary command name. The default example makes `help` and `status` public.

Every communication, survival, sensing, navigation, combat, inventory, resource, crafting, farming, and building command requires the bot to be spawned, except the core lifecycle/status commands explicitly described above. The router returns `NOT_READY` before any spawn-dependent handler runs.

On an offline-mode server, username matching is not authentication. Anyone who can reach the server can claim an allowlisted name. Keep the server on loopback, or use authenticated server mode before trusting chat authorization.

## Core and communication

### `help [command]`

Aliases: `commands`

Lists primary command names grouped by category, or prints summary, usage, aliases, spawn requirement, and local-only status for one command.

```text
help
help veinmine
```

### `capabilities`

Aliases: `features`

Prints the bot's feature groups. This is a description, not a readiness test; use `status` and the relevant sensing command before an action.

### `status`

Aliases: `stats`

Shows connection/spawn state, server/version, position/vitals when spawned, other online-player and carried-item totals, and the active task.

### `stop`

Aliases: `cancel`

Cancels the active managed task. If already idle, it still clears physical controls. `stop` itself does not disconnect the bot.

### `reconnect`

Local-only. Cancels work, intentionally disconnects, resets reconnect state, and starts a new connection immediately.

### `connect`

Local-only. Starts a connection after `disconnect` (or when otherwise disconnected). Calling it while a bot connection object already exists is a no-op at runtime but still replies that connection started.

### `disconnect`

Local-only. Cancels work and disconnects without automatic reconnect. The Node process, terminal, and dashboard stay running; use `connect` to return.

### `safety`

Shows active digging/building/PvP gates, gather/build/search/task limits, and protected block names. It is available to allowlisted chat users but is not public by default.

### `shutdown`

Aliases: `quit`, `exit`. Local-only. Cancels work, closes terminal input, stops the dashboard, disconnects without reconnecting, and lets the Node process exit cleanly. `Ctrl+C`/`SIGTERM` use the same shutdown path.

### `say <message>`

Requires spawn. Sends one ordinary Minecraft chat message. Arguments are joined with spaces, CR/LF are replaced, and the sent message is capped at 230 characters. A message beginning `/` is rejected so `say` cannot proxy server commands.

```text
say "I finished the west wall"
```

## Survival and sensing

### `autoeat <on|off|status|now> [food] [--replace]`

- `on` enables hunger-triggered background eating.
- `off` disables it and cancels its current eating action.
- `status` shows enable/eating state and hunger.
- `now [food]` starts a managed eating task; without an item the plugin chooses food.

The runtime uses saturation priority and starts background eating only below 15 hunger; health alone does not trigger it. Automatic and manual eating share this unsafe-food list: raw `chicken`, `rotten_flesh`, `pufferfish`, `chorus_fruit`, `poisonous_potato`, `spider_eye`, and `suspicious_stew`. At full hunger, only an explicitly named `golden_apple` or `enchanted_golden_apple` may be consumed with `autoeat now`. The auto-eat plugin's return-to-old-item behavior is disabled internally to prevent a delayed hand swap from racing the next action, so food may remain selected afterward.

### `armor [--replace]`

Starts a task using BroBot's armor scorer to equip the strongest carried helmet, chestplate, leggings, and boots. It compares armor points, toughness, protection enchantments, and remaining durability; Curse of Binding pieces and elytra are not auto-equipped.

### `sleep [--radius N] [--replace]`

Finds the nearest loaded bed and walks within interaction range before sleeping. It recognizes modern colored beds and the legacy `bed` registry name. Radius defaults to 24 and is bounded from 2 through `safety.maxSearchDistance`. The server still decides whether sleep is legal.

### `wake`

Leaves the current bed, or reports that the bot is not sleeping.

### `environment`

Alias: `world`

Shows dimension, day/time tick, daytime/night, rain state, and difficulty.

### `locate <block> [--radius N]`

Alias: `find`

Returns the nearest loaded block of that registry type and its distance. Radius defaults to `safety.maxSearchDistance`; allowed range is 1 through that limit. This does not search unexplored chunks.

### `nearby <players|mobs|hostiles|items|all> [--radius N]`

Lists up to 20 nearest matching loaded entities with entity ID, normalized name, type, distance, and position. Radius defaults to 24 and ranges from 1 through `safety.maxSearchDistance`.

`hostiles` uses a conservative built-in name set rather than trusting arbitrary server classifications.

## Navigation

### `goto <x> <y> <z> [--range N] [--replace]`

Alias: `go`

Walks to absolute or relative coordinates. Goal range defaults to 1 and may be 1–16.

```text
goto 120 64 -35
goto ~10 ~ ~-4 --range=2 --replace
```

### `come [player] [--range N] [--replace]`

Walks to a currently visible player. In Minecraft chat, omitting `player` uses the sender; terminal/dashboard callers must name the player. Goal range defaults to `behavior.followDistance` and may be 1–16. This captures the player's position once; use `follow` for a moving target.

### `follow <player> [--distance N] [--replace]`

Continuously follows a visible player with a dynamic goal. Distance defaults to `behavior.followDistance` and may be 1–16. Continues until stopped, replaced, timed out, disconnected, or failed.

### `look <player>` / `look <x> <y> <z>`

Turns the bot toward a visible player's eye area or an absolute/relative coordinate. This is an immediate action rather than a managed movement task.

### `waypoint ...`

Alias: `wp`. Waypoint and route names use 1–32 lowercase-normalized letters, digits, `_`, or `-`.

```text
waypoint set <name>
waypoint set <name> <x> <y> <z>
waypoint go <name> [--range N] [--replace]
waypoint list
waypoint remove <name>
```

`set` without coordinates stores the bot's current position. `go` range defaults to 1 and may be 1–16. Stored coordinates include dimension.

### `home <set|go> [--replace]`

Convenience wrapper around the persistent `home` waypoint. `home set` records the current position. `home go` uses goal range 1.

### `route ...`

Named routes contain stored coordinate snapshots copied from waypoints.

```text
route save <name> <waypoint> <waypoint> [...]
route list
route run <name> [--loops N] [--replace]
route remove <name>
```

Save requires 2–32 existing waypoints. Run defaults to one loop; `--loops` may be 1–100. The bot pauses `behavior.patrolPauseMs` at each point.

### `patrol <waypoint> <waypoint> [...] [--loops N] [--replace]`

Runs 2–32 existing waypoints without saving a named route. Loops default to 1 and may be 1–100. Continues point-by-point and rejects cross-dimension goals.

### `wander [--radius N] [--hops N] [--replace]`

Chooses bounded random points around the starting position. Radius defaults to 16 and ranges from 3 through `safety.maxSearchDistance`; hops default to 5 and range from 1–100. It is not an unbounded exploration mode.

### `recover [--range N] [--replace]`

Walks to the persisted last-death position. Range defaults to 2 and may be 1–16. No item pickup or task resumption is implied.

### `flee [entity-name] [--distance N] [--radius N] [--replace]`

Paths away from the nearest exact matching entity, or the nearest valid non-self entity when no name is provided. Search radius defaults to 24 (2 through `safety.maxSearchDistance`); flee distance defaults to 16 (3–64).

## Combat

### `attack <mob|entity-id> [--radius N] [--replace]`

Attacks the nearest exact matching non-player entity/name or exact numeric entity ID. Radius defaults to 24 and ranges from 1 through `safety.maxSearchDistance`. The bot equips a recognized sword/axe, pauses auto-eat during combat, and stops pursuit/attacks at 6 health or lower; it does not automatically path to a safe shelter.

### `hunt <mob> [count] [--radius N] [--replace]`

Repeatedly finds and attacks a matching non-player mob around the starting anchor. Count defaults to 1 and ranges 1–32. Radius defaults to 24 and ranges from 2 through `safety.maxSearchDistance`.

### `guard [here|player] [--radius N] [--replace]`

Continuously guards the bot's current point or a visible player's captured position. Radius defaults to `behavior.guardRadius` and may be 2–64. It attacks only names in the built-in hostile set, returns toward its anchor, and continues until stopped/failed/timed out. A named player's anchor does not move with that player.

### `pvp <player> [--radius N] [--replace]`

Local-only. Requires `safety.allowPvp=true`, an exact visible player name, and terminal/dashboard control. Radius defaults to the smaller of 24 and `safety.maxSearchDistance`, and may range from 1 through the smaller of 48 and that configured limit. Use only with explicit server/operator/player permission.

## Inventory and containers

### `inventory [filter]`

Alias: `inv`

Lists grouped base registry names and counts, with total item and empty-slot counts. A lowercase substring filter limits displayed groups.

### `count <item>`

Shows the total carried count of one registry item name.

### `hold <item> [--replace]`

Starts a task to equip one carried item in the main hand.

### `equip <item> [hand|off-hand|head|torso|legs|feet] [--replace]`

Equips a carried item to the requested destination. When omitted, the inventory service infers a slot from the item.

### `eat [food] [--replace]`

Eats the named carried food, or chooses the best recognized available food. It rejects raw `chicken`, `chorus_fruit`, `poisonous_potato`, `pufferfish`, `rotten_flesh`, `spider_eye`, and `suspicious_stew`. Normal food requires missing hunger; an explicitly named `golden_apple` or `enchanted_golden_apple` can be consumed at full hunger.

### `drop <item> [count] [--replace]`

Local-only. Tosses a carried item stack count at the bot's position. Count defaults to 1 and ranges from 1 through `safety.maxGatherCount`.

### `give <player> <item> [count] [--replace]`

Local-only. Walks near a visible player, looks toward them, and tosses items. Count defaults to 1 and is bounded by `safety.maxGatherCount`. Tossing does not guarantee the intended player picks the entities up.

### `container ...`

Alias: `chest`. Local-only. Chooses the nearest loaded supported container in range. Supported defaults are chests, trapped chests, barrels, ender chests, generic/colored shulker boxes.

```text
container inspect [--radius N] [--replace]
container deposit <item> [count] [--radius N] [--replace]
container withdraw <item> [count] [--radius N] [--replace]
```

Radius defaults to 16 and ranges from 2 through `safety.maxSearchDistance`. Transfer count defaults to 1 and is bounded by `safety.maxGatherCount`. Operations can partially complete and are not rolled back.

## Resources and crafting

### `mine <block[,block...]> [count] [--radius N] [--replace]`

Alias: `gather`

Finds loaded matching diggable blocks and collects up to count. Count defaults to 1 and is bounded by `safety.maxGatherCount`; radius defaults to `safety.maxSearchDistance` and ranges from 2 through that limit. Digging must be enabled and every requested registry name must exist and be unprotected.

BroBot handles each target directly: it requires at least one empty inventory slot, paths without ordinary route digging, validates the exact block and flow/falling-block safeguards, equips a carried harvesting tool, digs through core Mineflayer, then follows only drop entities observed beside that block for a bounded pickup window. A successful break does not guarantee every drop reaches inventory.

```text
mine stone 16
mine coal_ore,deepslate_coal_ore 12 --radius 48
```

### `veinmine <block> [count] [--radius N] [--gap 1..3] [--replace]`

Alias: `vein`

Starts at the nearest matching loaded block and performs BroBot's bounded flood search over loaded matching blocks before using the same direct path/tool/dig/drop-pickup worker as `mine`. Count defaults to 32 and is bounded by `safety.maxGatherCount`. Radius uses the same bounds/default as `mine`. `--gap` controls neighbor flood radius, defaults to 1, and may be 1–3; larger gaps can join blocks that are not a natural single vein.

### `chop [wood|any] [count] [--radius N] [--replace]`

Alias: `woodcut`

Collects logs/stems using the mining service. Type defaults to `any`; count defaults to 16 and is bounded by `safety.maxGatherCount`; radius uses the mining defaults/bounds.

Recognized convenience bases are `oak`, `spruce`, `birch`, `jungle`, `acacia`, `dark_oak`, `mangrove`, `cherry`, `pale_oak`, `crimson_stem`, and `warped_stem`. You may pass an explicit `_log` or `_stem` name. Legacy registries are supported: the first four overworld types resolve to `log`, and `acacia`/`dark_oak` resolve to `log2` when modern names are absent. On an older registry, prefer an explicit available wood type if `any` includes a block introduced after that version.

### `drops [item[,item...]] [count] [--radius N] [--replace]`

Alias: `pickup`

Collects nearby loaded dropped-item entities, optionally filtered by base item names. The count is a maximum number of entities, not total items; it defaults to `safety.maxGatherCount` and is bounded by that value. A sole numeric argument is treated as the count (`drops 5` collects any item type), while `drops iron_ingot 5` filters first. Radius defaults to `safety.maxSearchDistance` and ranges from 2 through it.

### `recipe <item> [count]`

Shows whether the item has registry recipes, whether a recipe appears craftable now, and up to eight candidate ingredient summaries. Count defaults to 1 and is bounded by `safety.maxGatherCount`. This command does not craft or recursively resolve prerequisites.

### `craft <item> [count] [--radius N] [--replace]`

Crafts at least the requested output using carried ingredients and, when required, a nearby loaded crafting table. Minecraft recipes create whole batches, so `craft stick 1` produces the recipe's four sticks. Both the requested count and the rounded batch output must stay within `safety.maxGatherCount`; table radius defaults to the smaller of 16 or `safety.maxSearchDistance` and ranges from 2 through that configured limit.

### `smelt <item> [count] [--fuel item] [--radius N] [--replace]`

Uses a nearby empty furnace for a bounded input count. Count defaults to 1 and is capped by `safety.maxGatherCount`; radius defaults to 16 and ranges from 2 through `safety.maxSearchDistance`.

When no fuel is named, the conservative automatic list is coal, charcoal, coal block, dried kelp block, blaze rod, then lava bucket, subject to inventory. The service waits for output within the task timeout and may leave items/fuel in the furnace after failure or cancellation.

### `fish [count] [--replace]`

Makes a bounded number of casts with a carried fishing rod. Count defaults to 1 and ranges through `safety.maxGatherCount`. A valid open-water cast is still the operator's responsibility.

## Farming

### `farm <scan|harvest|tend> [crop|all] [--radius N] [--limit N] [--replant bool] [--replace]`

Supported crops are `wheat`, `carrots`, `potatoes`, `beetroots`, and `nether_wart`. Crop defaults to `all`. Radius defaults to `behavior.farmRadius` and ranges from 2 through `safety.maxSearchDistance`; limit defaults to `safety.maxGatherCount` and ranges from 1 through it.

- `scan` is immediate/read-only and summarizes growth states.
- `harvest` gathers mature crops without replanting.
- `tend` gathers and replants by default; use `--replant=false` to disable replanting.

Replanting needs the correct seed/item and unchanged supported soil (`farmland` or `soul_sand`). Harvest/tend require digging permission and at least one empty inventory slot before each crop is broken. `--replace` applies to the managed harvest/tend actions; scan does not create a task.

Harvest and tend stop when health is 6 or lower. This guard prevents starting or continuing routine farming work at three hearts; it does not heal or move the bot to shelter.

## Building

Building uses carried blocks, never intentionally clears occupied targets, and requires placement support. `x y z` is the minimum-corner/origin. The coordinate parser accepts `~` relative syntax, but every resolved build coordinate must be a whole number; because a standing bot position is often fractional, explicit integer coordinates are the least surprising choice. Width/depth grow in positive axes; height grows upward.

### `place <block> <x> <y> <z> [--replace]`

Places exactly one carried block at an explicit air target. The position must be within `safety.maxSearchDistance` of the bot and have a usable neighboring support face.

### `build floor <block> <x> <y> <z> <width> <depth> [--replace]`

Creates a horizontal rectangle growing +X by width and +Z by depth.

### `build wall <block> <x> <y> <z> <width> <height> [--axis x|z] [--replace]`

Creates a vertical rectangle. Width grows +X by default or +Z with `--axis z`; height grows +Y.

### `build box <block> <x> <y> <z> <width> <height> <depth> [--hollow bool] [--replace]`

Creates a rectangular prism growing +X/+Y/+Z. `--hollow` defaults to true; false requests the complete volume.

Every dimension is a positive integer. More importantly, the calculated number of placements (floor/wall area, hollow shell, or solid volume) may not exceed `safety.maxBuildBlocks`. Every target must be within `safety.maxSearchDistance`, loaded, air, and supported when its turn is executed. The bot must have enough matching inventory for all initially empty targets before placement begins.

Placement and every build plan stop when health is 6 or lower. Already placed blocks remain in the world.

## Examples by surface

Terminal:

```text
waypoint set quarry
mine stone 32 --radius=48
stop
build wall cobblestone 102 64 -20 8 3 --axis=z --replace
```

Minecraft chat (default prefix):

```text
!come
!follow YourMinecraftName --distance 3
!farm scan wheat --radius 20
!status
!stop
```

Dashboard/API command strings omit the prefix:

```json
{ "command": "inventory iron" }
```

Because offline-mode chat identity is forgeable, prefer terminal/dashboard for valuable, destructive, or combat actions even when a command is not technically local-only.
