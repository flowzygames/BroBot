interface RegistryBlock {
  id: number
  name: string
}

type BlockRegistry = Record<string, RegistryBlock | undefined>

export const SUPPORTED_WOOD_NAMES = [
  'oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak',
  'mangrove', 'cherry', 'pale_oak', 'crimson_stem', 'warped_stem'
] as const

export function availableBedIds(blocks: BlockRegistry): number[] {
  return Object.values(blocks)
    .filter((block): block is RegistryBlock => Boolean(block && (block.name === 'bed' || block.name.endsWith('_bed'))))
    .map((block) => block.id)
}

export function resolveChopBlockNames(blocks: BlockRegistry, requested: string): string[] {
  if (requested === 'any') {
    return [...new Set([
      'log', 'log2',
      ...SUPPORTED_WOOD_NAMES.map((name) => name.endsWith('_stem') ? name : `${name}_log`)
    ].filter((name) => Boolean(blocks[name])))]
  }
  if (blocks[requested]) return [requested]
  const modern = requested.endsWith('_log') || requested.endsWith('_stem') ? requested : `${requested}_log`
  if (blocks[modern]) return [modern]
  const legacy = ['oak', 'spruce', 'birch', 'jungle'].includes(requested)
    ? 'log'
    : ['acacia', 'dark_oak'].includes(requested) ? 'log2' : undefined
  return legacy && blocks[legacy] ? [legacy] : [modern]
}
