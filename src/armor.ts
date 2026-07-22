import type { Bot, EquipmentDestination } from 'mineflayer'
import type { Item } from 'prismarine-item'

export interface EquippedArmor {
  destination: EquipmentDestination
  name: string
  displayName: string
}

const ARMOR_POINTS: Record<string, Record<string, number>> = {
  leather: { head: 1, torso: 3, legs: 2, feet: 1 },
  golden: { head: 2, torso: 5, legs: 3, feet: 1 },
  chainmail: { head: 2, torso: 5, legs: 4, feet: 1 },
  iron: { head: 2, torso: 6, legs: 5, feet: 2 },
  diamond: { head: 3, torso: 8, legs: 6, feet: 3 },
  netherite: { head: 3, torso: 8, legs: 6, feet: 3 }
}

function destination(item: Item): EquipmentDestination | undefined {
  if (item.name.endsWith('_helmet') || item.name === 'turtle_helmet') return 'head'
  if (item.name.endsWith('_chestplate')) return 'torso'
  if (item.name.endsWith('_leggings')) return 'legs'
  if (item.name.endsWith('_boots')) return 'feet'
  return undefined
}

function material(item: Item): string | undefined {
  if (item.name === 'turtle_helmet') return 'turtle'
  return /^(leather|golden|chainmail|iron|diamond|netherite)_/u.exec(item.name)?.[1]
}

function armorScore(item: Item, slot: EquipmentDestination): number {
  const itemMaterial = material(item)
  if (!itemMaterial) return Number.NEGATIVE_INFINITY
  const points = itemMaterial === 'turtle' ? 2 : ARMOR_POINTS[itemMaterial]?.[slot] ?? 0
  const toughness = itemMaterial === 'netherite' ? 3 : itemMaterial === 'diamond' ? 2 : 0
  const enchantments = item.enchants ?? []
  if (enchantments.some(({ name }) => name.replace(/^minecraft:/u, '') === 'binding_curse')) {
    return Number.NEGATIVE_INFINITY
  }
  const protection = enchantments.reduce((score, enchantment) => {
    const name = enchantment.name.replace(/^minecraft:/u, '')
    if (name === 'protection') return score + enchantment.lvl * 4
    if (['blast_protection', 'fire_protection', 'projectile_protection'].includes(name)) return score + enchantment.lvl
    return score
  }, 0)
  const durability = item.maxDurability > 0
    ? Math.max(0, item.maxDurability - item.durabilityUsed) / item.maxDurability
    : 1
  return points * 100 + toughness * 10 + protection + durability
}

function hasBindingCurse(item: Item): boolean {
  return (item.enchants ?? []).some(({ name }) => name.replace(/^minecraft:/u, '') === 'binding_curse')
}

/** Equip the strongest non-binding armor available in carried inventory. */
export async function equipBestArmor(bot: Bot): Promise<EquippedArmor[]> {
  const equipped: EquippedArmor[] = []
  const slots: EquipmentDestination[] = ['head', 'torso', 'legs', 'feet']
  for (const slot of slots) {
    // Mineflayer resolves these window slots per protocol version; hard-coded
    // entity equipment indices differ between 1.8 and off-hand-era releases.
    const current = bot.inventory.slots[bot.getEquipmentDestSlot(slot)] as Item | null | undefined
    if (current && hasBindingCurse(current)) continue
    const best = bot.inventory.items()
      .filter((item) => destination(item) === slot)
      .map((item) => ({ item, score: armorScore(item, slot) }))
      .filter(({ score }) => Number.isFinite(score))
      .sort((a, b) => b.score - a.score)[0]
    if (!best) continue
    if (current && armorScore(current, slot) >= best.score) continue
    await bot.equip(best.item, slot)
    equipped.push({ destination: slot, name: best.item.name, displayName: best.item.displayName })
  }
  return equipped
}
