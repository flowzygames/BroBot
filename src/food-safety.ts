export const UNSAFE_FOODS = [
  'chicken',
  'chorus_fruit',
  'poisonous_potato',
  'pufferfish',
  'rotten_flesh',
  'spider_eye',
  'suspicious_stew'
] as const

export const UNSAFE_FOOD_SET: ReadonlySet<string> = new Set(UNSAFE_FOODS)

export const ALWAYS_CONSUMABLE_FOOD_SET: ReadonlySet<string> = new Set([
  'golden_apple',
  'enchanted_golden_apple'
])
