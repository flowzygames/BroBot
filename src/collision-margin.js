// The vanilla server's float-sized player body can be microscopically wider
// than prismarine-physics' double-sized prediction. Pressing into that boundary
// can cause repeated server corrections that reset falling velocity to zero.
// Predict a slightly larger body, so ordinary movement stops on the safe side.
// This changes no server attributes, position, velocity, or movement permissions.
// Reproducer/context: https://github.com/PrismarineJS/mineflayer/issues/3913#issuecomment-5399671676
export function configureCollisionMargin (bot) {
  const physics = bot.physics
  // Keep this compatibility adjustment scoped to our live-tested server version
  // and default dimensions; never overwrite custom or already-adjusted values.
  if (bot.version !== '1.21.8' || !physics || physics.playerHalfWidth !== 0.3 || physics.playerHeight !== 1.8) return false
  physics.playerHalfWidth = 0.30000003
  physics.playerHeight = 1.80000018
  return true
}
