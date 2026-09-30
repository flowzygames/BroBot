# BroBot

A local Minecraft companion you can talk to, send gathering and building jobs, or control directly. BroBot runs in a Java 1.21.8 world; Geyser lets Minecraft for Windows / Bedrock join that same world. The OpenAI agent chooses from bounded game actions and sees their actual results.

**Autonomously beating a fresh Minecraft world is experimental and has not been demonstrated by this project.** The bot has survival and End progression tools, but difficult terrain, combat, and long plans can still stop it. [Validation details](docs/VALIDATION.md) distinguish tested behavior from implemented features.

## Start playing

You need a licensed Minecraft client and [Node.js](https://nodejs.org/en/download) **22.9 or newer**. Java 21 is downloaded into this project when a compatible installation is not found. The server and bot can run on Windows, Linux, or macOS; Bedrock availability depends on your device.

Open a terminal in this folder:

```sh
npm ci
npm run setup
npm run play
```

Setup asks for your exact player name and an optional OpenAI API key. Enter the key in the local setup prompt, where it is hidden. It is saved in the ignored `.env` file. You can leave it blank and use direct commands.

`npm run play` asks you to review and accept the [Minecraft EULA](https://www.minecraft.net/en-us/eula), prepares the local server, then starts BroBot. First launch downloads server files and may take a minute. Open the dashboard at **[http://127.0.0.1:3000](http://127.0.0.1:3000)**.

Join the world from Minecraft:

| Your client | Connection |
| --- | --- |
| Minecraft for Windows / Bedrock | Play → Servers → Add Server; name `BroBot`, address `127.0.0.1`, port `19132` |
| Minecraft Java | Use a **1.21.8** installation, then Multiplayer → Direct Connection → `127.0.0.1:25565` |

The local server accepts Bedrock connections **without a Microsoft/Xbox sign-in**, and BroBot does not need an account. Setup disables Geyser's Bedrock login validation as well as Java authentication, and keeps both listeners bound to `127.0.0.1`. You still need your installed, licensed Minecraft client. Client launch and signed-out menu behavior are separate from server authentication; see [validation details](docs/VALIDATION.md).

After joining, set **Your name on this server** in the dashboard. Use the connected name shown there; a Bedrock name may differ from your gamertag. Then try `follow me` or `come here` in the dashboard, terminal, or `!bro follow me` in Minecraft chat.

The default setup accepts connections from this computer only. **No router port forwarding is needed.** Another device cannot join `127.0.0.1` on your computer using these defaults.

Use **Stop everything**, type `stop`, or say `!bro stop` to interrupt work. To finish the session, click **Close BroBot** in the dashboard, type `quit`, or press Ctrl+C in the launcher terminal. With `npm run play`, closing BroBot also saves and stops the world. With standalone `npm start`, it closes only the bot; stop the separate server in its own terminal.

An idle bot remains vulnerable to mobs and environmental hazards in survival. Close the session when you are away; stopping its work does not pause the Minecraft world.

### If Bedrock cannot connect

Run `npm run doctor` while the server is running. It checks Java, the Java TCP port, the Bedrock UDP response, and Windows loopback configuration. Some Minecraft for Windows installations require this one-time command in an **Administrator terminal**:

```powershell
CheckNetIsolation.exe LoopbackExempt -a -n="Microsoft.MinecraftUWP_8wekyb3d8bbwe"
```

This permits the Windows app to reach a server on the same computer. See [Geyser's connection guide](https://geysermc.org/wiki/geyser/fixing-unable-to-connect-to-world/). If the server disconnects you with “Please log into Xbox to join this server,” close BroBot and run `npm run server:setup`, then `npm run play` to apply the account-free configuration. The generated Geyser configuration has `advanced.bedrock.validate-bedrock-login: false`. A sign-in prompt in Minecraft's own menu, before connecting, is a separate client limitation.

If Bedrock updates and reports an outdated server, close BroBot first, then run `npm run server:update-bridge` followed by `npm run play`. This refreshes the bridge downloads and verifies their published checksums while keeping the Java world on 1.21.8. Check [validation limits](docs/VALIDATION.md) before assuming a newly updated client has been tested.

## Talk or give direct commands

With an API key, write a goal such as:

```text
goal Follow me while I explore. Keep some distance and tell me if you get stuck.
goal Gather nearby oak logs and craft a crafting table and wooden pickaxe.
goal Help me build a small shelter using the materials we have. Tell me what is missing.
```

Natural language uses paid OpenAI API calls. `OPENAI_MODEL` in `.env` must name a model available to your API account. The configured default is not proof that your account can access it. ChatGPT subscriptions and API billing are separate. No live OpenAI request was made during the build validation because no API key was available.

The Minecraft world is local. Initial installation downloads and OpenAI reasoning require internet access. **Direct commands do not call OpenAI**; a totally disconnected natural-language assistant would need a separate local-model integration, which this version does not include. Offline startup of individual Minecraft clients may also depend on their saved account session.

These commands work without an API key:

| Command | Behavior |
| --- | --- |
| `status`, `inventory`, `help` | Read the current state |
| `follow me`, `follow NAME` | Follow a visible player for up to one minute |
| `come here`, `come NAME` | Walk to a currently visible player |
| `goto X Y Z` | Walk to nearby coordinates |
| `remember home`, `home` | Save and return to a waypoint in the same dimension |
| `stop` | Cancel current work; wait for any in-flight inventory operation to settle |
| `action NAME {JSON}` | Run one tool directly; the dashboard lists all arguments |

For example:

```text
action inspect {"radius":16}
action collect {"block":"oak_log","count":4,"radius":24}
action craft {"item":"oak_planks","count":8}
action craft {"item":"crafting_table","count":1}
action progression_status {}
```

Craft counts mean **desired output items**, not recipe repetitions. Collect counts mean blocks mined; the result separately reports actual item pickups. Blocks and item names must match Minecraft registry names. Jobs use owned inventory and ordinary survival interactions; the bot is not given operator privileges.

Floor, wall, and hollow-box building are supported. Builds need sufficient materials, existing support, and reachable placement faces. BroBot refuses to overwrite occupied blocks. Choose coordinates after inspecting your actual terrain; these tools do not provide a general architectural editor or automatically clear a site.

Only the configured owner can issue in-game commands, with the `!bro` prefix. The local dashboard and terminal remain available if the owner field is blank.

## What to expect

The action set includes navigation, following, exploration, observed gathering, targeted digging, crafting, furnace use, equipment, eating, sleeping, giving items, block interaction, and simple construction. Combat actions have time limits and stop on low health. Stops, deaths, disconnects, and API budgets interrupt work instead of leaving an unbounded loop running.

Progression tools can construct and light an obsidian portal, wait for a real portal transition, observe eye-of-ender throws and triangulate bearings, fill a correctly oriented End portal, shoot a bow, and attempt bounded dragon combat. They report missing materials, obstructions, failed paths, and unconfirmed outcomes. Fortress exploration, stronghold excavation, crystal cages, and a reliable full-game strategy still need substantial live-world validation.

The planner pauses repeated no-progress failures, including unsuccessful results that do not throw errors. Partial mining or building can still count as progress. Simple whole-goal inventory, dimension, and dragon-death requests have runtime completion checks; `finish_goal` completion claims for other wording and compound goals produce an explicitly **unverified** report. See [completion verification](docs/ARCHITECTURE.md#completion-verification) for supported forms and limitations. Ordinary conversation remains available.

Default API limits persist across restarts: 30 requests, 120,000 input tokens, and 30,000 output tokens. The agent reserves a conservative allowance before each request, so it may stop before those reported totals are fully consumed. The dashboard shows usage and an explicit reset button. Resetting allows more paid requests; these are token/request limits, not a dollar guarantee.

## Files and troubleshooting

- `.env`: your local configuration and optional API key; never commit it.
- `.server/`: downloaded Java/server/plugins, the world, configuration, and logs.
- `.server/launcher.log`: server output from `npm run play`.
- `.brobot/`: persistent notes, waypoints, API usage, and bounded event logs.
- [Architecture and tools](docs/ARCHITECTURE.md): how planning, execution, memory, and cancellation fit together.
- [Validation and limitations](docs/VALIDATION.md): exact test coverage and what remains unverified.

If the server is already running, use `npm start` to launch only the bot. For separate terminals, use `npm run server:setup`, then `npm run server`, and run `npm start` in another terminal. Do not run two server processes against the same world.

Run `npm run doctor` for connection/setup checks, `npm test` for local tests, `npm run check` for source syntax checks, and `npm run test:live` for an isolated game-server integration test. The live test creates a separate fixture world and does not use the normal play world.

If an action fails, read its result before retrying. Common causes are missing materials, unloaded chunks, an inaccessible block face, the wrong player name, a full inventory, or insufficient food. Model-access or API-key errors do not disable direct controls.

## Version choice

The Java world is deliberately pinned to **1.21.8**. Mineflayer's advertised protocol support extends further, but upstream reports identify movement regressions on newer versions. See [Mineflayer's tested versions](https://github.com/PrismarineJS/mineflayer/blob/master/lib/version.js) and [the pathfinder report](https://github.com/PrismarineJS/mineflayer-pathfinder/issues/366). Paper, Geyser, and ViaVersion downloads are recorded with their hashes in `.server/manifest.json`; Bedrock protocol support follows the installed bridge, not the Java world version.

This rebuild replaces the application files while retaining the repository's Git history.
