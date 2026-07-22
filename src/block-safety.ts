const PROTECTION_EQUIVALENTS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['furnace', 'lit_furnace']),
  new Set(['spawner', 'mob_spawner'])
]

export function normalizeBlockName(value: string): string {
  return value.trim().toLowerCase().replace(/^minecraft:/u, '')
}

/** Match configured protection intent across legacy and modern registries. */
export function isProtectedBlockName(name: string, configuredNames: readonly string[]): boolean {
  const normalized = normalizeBlockName(name)
  const configured = new Set(configuredNames.map(normalizeBlockName))
  if (configured.has(normalized)) return true
  if (normalized.endsWith('_shulker_box') && configured.has('shulker_box')) return true
  return PROTECTION_EQUIVALENTS.some((group) => group.has(normalized) && [...group].some((alias) => configured.has(alias)))
}
