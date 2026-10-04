# Component-aware cursor storage — October 4, 2026

## Fix

Cursor storage selected a merge destination by item type and metadata only.
A renamed stack of the same material was therefore treated as compatible with
ordinary crafted output. Server-side behavior swaps incompatible stacks, so the
action could fail with the renamed stack on the cursor despite empty slots.

The new identity helper compares type, metadata, NBT, added components and removed
components. It uses deep equality, preserving binary/BigInt values and nested
array order, and rejects malformed or duplicate component types. Counts and
derived component maps are not identity. Different top-level component order is
conservatively treated as incompatible. Storage uses an empty slot if no known
compatible stack is available; its post-click check also verifies identity.

## Verification

- Frozen source and harness: `d646e93d31ed08fa81709ab8d5f452824d3dd2df`
- 535 aggregate syntax/automated checks passed on the integrated application
- Five added tests cover named-stack crafting, changed server output identity,
  modern component additions/removals, array ordering, NBT and malformed data
- The named-stack regression failed on the old implementation and passed after
  the fix; focused read-only review independently repeated the tests
- `tested-files.json` records changed application/test/harness hashes

## Controlled Minecraft proof

`named-stack.json` records Java 1.21.8 with console-supplied inventory:
one named oak plank in slot 9 and two ordinary logs in slot 36. One actual craft
produced four ordinary planks in slot 10, preserved the named stack unchanged,
left one log in slot 36 and left the cursor empty. Recorded clicks were
36, 1, 36, 0 and 10; slot 9 was never clicked. No cleanup errors occurred.

The normal prepared integration suite also passed **17/17 phases** on this frozen
source (`prepared-17.json`), including crafting and smelting. Its raw format has
no commit field; source provenance is established by the frozen worktree and
file equivalence. This is separate from the named-stack-specific fixture.

## Limits

This is cursor destination selection and confirmation, not general custom-item
support. It does not repair component-insensitive optimistic clicks inside the
upstream inventory library, custom maximum-stack-size handling, or choose which
named ingredients the user wishes to preserve. There is no new natural-world
benchmark, public download update, or stable 1.0 claim.
