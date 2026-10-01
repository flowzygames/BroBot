// Mineflayer 4.39's modern metadata handler updates bot.oxygenLevel for other
// entities too. Read only our player metadata whenever the registry maps air.
export function ownOxygenLevel (bot) {
  const keys = bot.registry?.entitiesByName?.[bot.entity?.name ?? 'player']?.metadataKeys
  const index = keys?.indexOf('air_supply') ?? -1
  if (index >= 0) {
    const supply = bot.entity?.metadata?.[index]
    return typeof supply === 'number' && Number.isFinite(supply) ? Math.round(supply / 15) : null
  }
  // Older Mineflayer breath handling explicitly filters the player's entity id.
  return Number.isFinite(bot.oxygenLevel) ? bot.oxygenLevel : null
}
