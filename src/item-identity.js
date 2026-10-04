import { isDeepStrictEqual } from 'node:util';

// Java max_stack_size is an integer from 1 through 99. A removed/default-
// unknown capacity cannot safely predict a left-click and is refused.
export function itemStackCapacity(item) {
  if (!item) return 0;
  const added=item.components ?? [], removed=item.removedComponents ?? [];
  if (!Array.isArray(added) || !Array.isArray(removed)) return 0;
  for (const entries of [added,removed]) {
    if (!entries.every(c=>c && typeof c.type==='string') || new Set(entries.map(c=>c.type)).size!==entries.length) return 0;
  }
  if (removed.some(c=>!c || c.type==='max_stack_size')) return 0;
  const overrides=added.filter(c=>c?.type==='max_stack_size');
  if (overrides.length>1) return 0;
  const capacity=overrides.length ? overrides[0].data : item.stackSize;
  return Number.isSafeInteger(capacity) && capacity>=1 && capacity<=99 ? capacity : 0;
}

// Only compare authoritative identity fields; count, slot and componentMap are
// not identity. Array order differences are conservatively non-compatible.
// Never normalize nested NBT/component data, where array order can matter.
export function sameItemIdentity(a, b) {
  if (!a || !b || a.type !== b.type || a.metadata !== b.metadata) return false;
  const validComponents = value => value == null || (Array.isArray(value)
    && value.every(c => c && typeof c.type === 'string')
    && new Set(value.map(c => c.type)).size === value.length);
  if (![a.components,b.components,a.removedComponents,b.removedComponents].every(validComponents)) return false;
  return isDeepStrictEqual(a.nbt ?? null,b.nbt ?? null)
    && isDeepStrictEqual(a.components ?? [],b.components ?? [])
    && isDeepStrictEqual(a.removedComponents ?? [],b.removedComponents ?? []);
}
