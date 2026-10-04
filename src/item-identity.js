import { isDeepStrictEqual } from 'node:util';

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
