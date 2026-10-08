// Only callers with a proven local terrain predicate may supply this scope.
// Generic cursors remain globally invalidated by default.
const blockPosition = p => p && ['x','y','z'].every(k => Number.isSafeInteger(p[k]) && Math.abs(p[k]) <= 30000000)
export function normalizeDependency(scope) {
  try {
    const p=scope?.origin, origin={x:p?.x,y:p?.y,z:p?.z}, radius=scope?.radius
    if (!blockPosition(origin) || !Number.isFinite(radius) || radius < 1 || radius > 65) return null
    Object.freeze(origin)
    return Object.freeze({origin,radius,key:JSON.stringify([origin.x,origin.y,origin.z,radius])})
  } catch { return null }
}
export function relevantTerrainEvent(scope,event,args) {
  if (!scope) return true
  const {origin,radius} = scope, squared = radius * radius
  if (event === 'blockUpdate') {
    const positions = [args[0]?.position,args[1]?.position]
    if (!positions.every(blockPosition)) return true
    return positions.some(p => (p.x-origin.x)**2 + (p.y-origin.y)**2 + (p.z-origin.z)**2 <= squared)
  }
  if (event === 'chunkColumnLoad' || event === 'chunkColumnUnload') {
    const p = args[0]
    // Pinned prismarine-world emits block-coordinate column corners. Include
    // tangent columns and all heights; a reload can replace observed cells.
    if (!blockPosition(p) || p.y !== 0 || p.x % 16 !== 0 || p.z % 16 !== 0) return true
    const dx = Math.max(p.x-origin.x,0,origin.x-(p.x+16))
    const dz = Math.max(p.z-origin.z,0,origin.z-(p.z+16))
    return dx*dx + dz*dz <= squared
  }
  return true
}

// One short-lived geometry cursor. No candidate, path or safety decision is
// retained. Continuous observation covers the gaps between serialized actions.
export class EmptySearchContinuation {
  constructor (bot, { now = () => performance.now(), ttlMs = 5000 } = {}) {
    this.bot = bot
    this.now = now
    this.ttlMs = Math.min(5000, Math.max(1, ttlMs))
    this.lease = null
  }

  snapshot () {
    const bot = this.bot, entity = bot.entity
    if (!entity || !bot._client || !bot.world || !bot.registry || entity.onGround !== true) return null
    const values = [entity.position?.x, entity.position?.y, entity.position?.z, entity.velocity?.x, entity.velocity?.y, entity.velocity?.z, entity.yaw, entity.pitch]
    if (!values.every(Number.isFinite)) return null
    return { entity, client: bot._client, world: bot.world, registry: bot.registry, state: JSON.stringify([values, entity.onGround, bot.game?.dimension, bot.game?.minY, bot.game?.height]) }
  }

  same (a, b) {
    return Boolean(a && b && a.entity === b.entity && a.client === b.client && a.world === b.world && a.registry === b.registry && a.state === b.state)
  }

  valid (lease = this.lease) {
    return Boolean(lease && lease === this.lease && !lease.invalid && !lease.parentSignal.aborted && !lease.actionSignal.aborted && (!lease.pending || this.now() < lease.expires) && this.same(lease.snapshot, this.snapshot()))
  }

  clear () {
    const lease = this.lease
    if (!lease) return
    lease.invalid = true
    this.lease = null
    clearTimeout(lease.timer)
    for (const [event, handler] of lease.listeners) this.bot.removeListener(event, handler)
    lease.parentSignal.removeEventListener('abort', lease.invalidate)
    lease.actionSignal.removeEventListener('abort', lease.invalidate)
  }

  dispatch (name, parentSignal) {
    if (!this.lease) return
    if (!['collect', 'inspect'].includes(name) || parentSignal !== this.lease.parentSignal || !this.valid()) this.clear()
  }

  finishedCleanup () {
    if (!this.lease?.pending || !this.valid()) this.clear()
  }

  begin ({ key, parentSignal, actionSignal, createCursor, terrainDependency = null }) {
    const prior = this.lease
    const dependency = terrainDependency == null ? null : normalizeDependency(terrainDependency)
    const scopeValid = terrainDependency == null || dependency !== null
    const resumed = Boolean(scopeValid && (prior?.terrainDependency?.key ?? null) === (dependency?.key ?? null) && prior?.pending && prior.key === key && prior.parentSignal === parentSignal && this.valid(prior))
    const previousCursor = resumed ? prior.cursor : null
    this.clear()
    const snapshot = this.snapshot()
    if (!scopeValid || !snapshot || !(parentSignal instanceof AbortSignal) || !(actionSignal instanceof AbortSignal) || parentSignal.aborted || actionSignal.aborted) return null
    const lease = { key, snapshot, parentSignal, actionSignal, terrainDependency:dependency, cursor: previousCursor ?? createCursor(), resumed, pending: false, invalid: false, listeners: [] }
    this.lease = lease
    const invalidate = () => { if (this.lease === lease) this.clear() }
    lease.invalidate = invalidate
    const moved = () => { if (!this.valid(lease)) invalidate() }
    for (const event of ['blockUpdate', 'chunkColumnLoad', 'chunkColumnUnload', 'spawn', 'respawn', 'end', 'terrainUntrusted']) {
      const changed = (...args) => {
        let relevant=true
        try { relevant=relevantTerrainEvent(lease.terrainDependency,event,args) } catch {}
        if (relevant) invalidate()
      }
      lease.listeners.push([event, changed])
    }
    for (const event of ['physicsTick', 'move']) lease.listeners.push([event, moved])
    for (const [event, handler] of lease.listeners) this.bot.on(event, handler)
    parentSignal.addEventListener('abort', invalidate, { once: true })
    actionSignal.addEventListener('abort', invalidate, { once: true })
    if (!this.valid(lease)) { this.clear(); return null }
    return lease
  }

  retain (lease) {
    if (!this.valid(lease) || !lease.cursor.resumable) { if (this.lease === lease) this.clear(); return false }
    lease.pending = true
    lease.expires = this.now() + this.ttlMs
    lease.timer = setTimeout(lease.invalidate, this.ttlMs)
    lease.timer.unref?.()
    return true
  }

  release (lease) { if (this.lease === lease) this.clear() }
}
