# Five-minute player check

This is a manual checklist, not a claim that these client steps have already
passed. Automated Windows checks and headless Minecraft tests do not replace a
real player joining from the Windows/Bedrock or Java client.

## Join and take control

1. Download and extract the development ZIP. Start `Start-BroBot.cmd` on Windows,
   or run `sh start-brobot.sh` on macOS/Linux. Node.js 22.9+ is required.
2. Review the Minecraft EULA when prompted. Leave the optional OpenAI key blank
   for this offline check.
3. Open `http://127.0.0.1:3000`. Join Java 1.21.8 at `127.0.0.1:25565`, or a
   supported Bedrock client on this same computer at `127.0.0.1:19132`.
4. Set the dashboard owner to the exact player name displayed by the server.
   In-game messages from other names should not control BroBot.

## Try the basics

Use the dashboard or prefix in-game commands with `!bro`.

| Try | Look for |
|---|---|
| `follow me` | BroBot approaches the visible owner; it does not dig through walls |
| `stop` | Movement stops; the current action may briefly show “Stopping” while it drains |
| `collect 4 oak logs` | The backpack count reflects actual collected logs, not just broken blocks |
| `craft 4 oak planks` | One carried oak log becomes four planks |
| `craft a crafting table` | Those four planks become a table; missing prerequisites produce an explicit message |
| `remember home`, move away, `home` | It attempts a loaded, bounded route to the saved location |

Do not run the starter from a treetop or a treeless biome for a first demo. Choose
a dry, open area with nearby trees and exposed stone. The difficult-terrain limits
remain visible in the benchmark records. If you move BroBot to a better area, stop
the old job and start a new starter job there: Resume keeps the old starting
point. A direct `follow me` may help relocate it when a valid route exists.

## Try the bounded starter

1. Start `survive starter` and watch the inventory checklist.
2. Press Stop during work. The job should stay paused; restarting the app must
   not silently start it again.
3. Review the reason and surroundings before `survive resume`. Same-session
   dropped-item recovery should remain scoped; a reconnect must not blindly trust
   old entity IDs.
4. A successful job requires both a stone pickaxe and furnace, plus an observed
   return to its starting area. Tools alone do not count as completion.

The starter does not produce food, build shelter, survive the night indefinitely
or finish Minecraft. A paused job does not pause the world itself.

## Close and reopen

Use the dashboard shutdown button or Ctrl+C in the launcher. Wait for the server
to save before closing its window. Reopen the launcher and check that the local
world and saved waypoints remain, with any unfinished starter paused.

## If something goes wrong

Save the exact command, dashboard message and whether the bot was connected.
For movement trouble, include the visible terrain and starting position. Do not
post your `.env`, API key, Microsoft sign-in details or authentication cache.
If sharing logs, review them first for player names or other information you do
not want public. Report what actually happened; a blocked route is not a success.
