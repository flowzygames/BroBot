import type { Bot } from 'mineflayer'
import type { Item } from 'prismarine-item'
import { describe, expect, it } from 'vitest'
import { equipBestArmor } from '../src/armor.js'

function item(name: string, enchants: Array<{ name: string, lvl: number }> = []): Item {
  return {
    name,
    displayName: name,
    enchants,
    maxDurability: 100,
    durabilityUsed: 0
  } as unknown as Item
}

describe('equipBestArmor', () => {
  it('uses armor values and refuses Curse of Binding', async () => {
    const equipped: Array<{ name: string, slot: string }> = []
    const items = [
      item('chainmail_chestplate'),
      item('iron_chestplate'),
      item('diamond_chestplate', [{ name: 'binding_curse', lvl: 1 }]),
      item('leather_boots')
    ]
    const slots: Array<Item | null> = Array.from({ length: 50 }, () => null)
    const bot = {
      inventory: { items: () => items, slots },
      getEquipmentDestSlot: (slot: string) => ({ head: 5, torso: 6, legs: 7, feet: 8 })[slot],
      equip: async (selected: Item, slot: string) => { equipped.push({ name: selected.name, slot }) }
    } as unknown as Bot
    await equipBestArmor(bot)
    expect(equipped).toContainEqual({ name: 'iron_chestplate', slot: 'torso' })
    expect(equipped).not.toContainEqual({ name: 'diamond_chestplate', slot: 'torso' })
  })

  it('never downgrades armor already equipped in version-resolved inventory slots', async () => {
    const equipped: Array<{ name: string, slot: string }> = []
    const slots: Array<Item | null> = Array.from({ length: 50 }, () => null)
    slots[6] = item('diamond_chestplate')
    const bot = {
      inventory: { items: () => [item('leather_chestplate')], slots },
      getEquipmentDestSlot: (slot: string) => ({ head: 5, torso: 6, legs: 7, feet: 8 })[slot],
      equip: async (selected: Item, slot: string) => { equipped.push({ name: selected.name, slot }) }
    } as unknown as Bot

    await equipBestArmor(bot)
    expect(equipped).toEqual([])
  })
})
