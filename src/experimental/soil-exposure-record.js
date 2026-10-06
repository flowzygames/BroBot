// In-process provenance only. JSON or a copied result cannot create a receipt.
// This is a read-only planning prerequisite, never permission to mine a block.
const exposures = new WeakMap()
const sessions = new WeakMap()
function sessionFor(bot) {
  let session = sessions.get(bot)
  if (!session) {
    session = { epoch: 0 }
    sessions.set(bot, session)
    // One bounded listener set per bot, retained to revoke between-call receipts.
    for (const event of ['spawn','respawn','end','terrainUntrusted']) bot.on(event, () => { session.epoch++ })
  }
  return session
}
export const RETIRE_TEMPORARY_SOIL_LANDINGS = Symbol('one observed stone removal may retire private soil arrivals')
export function recordSoilExposure(result, { bot, origin, home, protectedPositions, temporaryLandings }) {
  const points = values => values.map(p => Object.freeze([p.x, p.y, p.z]))
  const session = sessionFor(bot)
  exposures.set(result, Object.freeze({
    session, epoch: session.epoch,
    bot, entity: bot.entity, client: bot._client, world: bot.world, registry: bot.registry,
    pathfinder: bot.pathfinder, dimension: bot.game?.dimension,
    origin: Object.freeze([...origin]), home: Object.freeze([...home]),
    target: Object.freeze([...result.exposed_stone]),
    protectedPositions: Object.freeze(points(protectedPositions)),
    temporaryLandings: Object.freeze(points(temporaryLandings))
  }))
  return result
}
export function readSoilExposure(bot, result) {
  const record = result && typeof result === 'object' ? exposures.get(result) : null
  return record && record.session.epoch === record.epoch && record.bot === bot && record.entity === bot.entity && record.client === bot._client
    && record.dimension === bot.game?.dimension && record.world === bot.world && record.registry === bot.registry && record.pathfinder === bot.pathfinder ? record : null
}
