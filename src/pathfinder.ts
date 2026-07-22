/**
 * mineflayer-pathfinder publishes CommonJS in a shape that Node cannot expose
 * as reliable synthetic named ESM exports. Keep that compatibility quirk in
 * one adapter so the rest of this ESM project can use normal named imports.
 */
import * as namespace from 'mineflayer-pathfinder'

type PathfinderModule = typeof import('mineflayer-pathfinder')

const packageExports = (
  (namespace as unknown as { default?: PathfinderModule }).default ?? namespace
) as PathfinderModule

export const pathfinder = packageExports.pathfinder
export type Movements = import('mineflayer-pathfinder').Movements
export const Movements = packageExports.Movements
export const goals = packageExports.goals
