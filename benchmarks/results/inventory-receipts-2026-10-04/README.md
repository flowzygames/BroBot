# Custom capacities and actual crafting output — October 4, 2026

## Two fixes

1. Cursor storage now uses the exact validated `max_stack_size` component when
   present, for both destination selection and transfer arithmetic. The valid
   Java range is 1–99. Removed, malformed or unknown capacity is refused before
   clicking. Registry capacity is used only without an override. An increased
   limit must not be clamped to 64: the server may transfer more than predicted.
2. The synchronized crafting path counts verified newly produced output from
   each batch. Restoring preexisting cursor or grid contents no longer counts
   toward the user's requested production. A receipt is returned only after
   confirmed output storage, grid cleanup and final synchronization.

Before the second fix, two logs plus four old planks on the cursor could satisfy
a request for eight with only one craft: four genuinely new planks were made,
but eight were reported. The same issue affected named cursor items and grid
contents.

## Verified source

Frozen application and harnesses:
`00f213a7532ef20afddd202f095d72e589ea93fc`.
The aggregate syntax/automated run passed **543 checks**. The capacity and
accounting regressions failed on their respective old implementations and
passed with the fixes. Read-only review checked the production paths, focused
tests and controlled harnesses. `tested-files.json` identifies changed files.

## Actual Minecraft controls

Both fixtures used clean frozen source, Java 1.21.8, a prepared peaceful world
and console-supplied items. All inventory transfers and crafting were real.

`stack-capacity.json` contains three cases:

- Full capacity 16: existing 16 plus cursor 1 became separate stacks 16 and 1
- Partial capacity 16: existing 15 plus cursor 2 became stacks 16 and 1
- Increased capacity 99: existing 60 plus cursor 20 became one stack of 80

Every case preserved the custom component and total cobblestone, cleared the
cursor, crafted four ordinary planks and left one of its two supplied logs.

`craft-accounting.json` covers ordinary cursor planks, named cursor planks and
preexisting crafting-grid planks. In every case four old planks plus two logs
became twelve total planks: eight genuinely new planks in two batches. Logs were
exhausted, cursor/grid were empty and the four named planks retained their exact
components. No cleanup errors were recorded in either controlled run.

The normal prepared integration suite also passed **17/17 phases** on this frozen
source (`prepared-17.json`). Its raw format has no commit field; the clean
execution checkout and matching source files establish provenance. These normal
controls are separate from the specific capacity and accounting fixtures.

## Limits

This is prepared inventory/crafting verification, not autonomous gathering or a
new natural-world score. The legacy native `bot.craft` fallback retains its
previous inventory-delta accounting; the real synchronized path uses receipts.
Unknown capacity fails closed and may require the player to resolve their
cursor. This does not establish general custom-item compatibility or repair
every upstream optimistic-click behavior. No public ZIP update or stable 1.0
claim follows from these checks.
