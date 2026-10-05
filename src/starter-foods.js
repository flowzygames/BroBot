// Foods the offline starter controller can actually select for recovery.
export const STARTER_FOODS = Object.freeze(['cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken', 'cooked_salmon', 'cooked_cod', 'bread', 'baked_potato', 'carrot', 'apple'])
export const hasStarterFood = items => items.some(item => STARTER_FOODS.includes(item.name) && Number.isFinite(item.count) && item.count > 0)
