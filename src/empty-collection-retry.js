import { randomUUID } from 'node:crypto';
import { normalizeDependency, relevantTerrainEvent } from './empty-search-continuation.js';

// A scheduling hint only: a completed empty scan may remain empty after a
// stationary refused scout. This never caches a route, candidate or dig permit.
export class EmptyCollectionRetry {
  constructor(bot, { boundary = () => null, now = () => performance.now(), ttlMs = 30000 } = {}) {
    this.bot = bot; this.boundary = boundary; this.now = now;
    this.ttlMs = Math.min(30000, Math.max(1, ttlMs)); this.lease = null;
  }
  snapshot() {
    try {
      const b=this.bot, p=b.entity?.position;
      if (!b.entity || !b._client || !b.world || !b.registry || b.entity.onGround !== true
        || !['x','y','z'].every(k=>Number.isFinite(p?.[k]))) return null;
      return {entity:b.entity,client:b._client,world:b.world,registry:b.registry,
        value:JSON.stringify([p.x,p.y,p.z,b.game?.dimension,b.game?.minY,b.game?.height,this.boundary()])};
    } catch { return null; }
  }
  valid(lease=this.lease) {
    const current=this.snapshot(), saved=lease?.snapshot;
    return Boolean(lease && lease===this.lease && !lease.parentSignal.aborted && this.now()<lease.expires
      && current && saved && current.entity===saved.entity && current.client===saved.client
      && current.world===saved.world && current.registry===saved.registry && current.value===saved.value);
  }
  clear() {
    const lease=this.lease; if(!lease)return;
    this.lease=null; clearTimeout(lease.timer);
    for(const [event,handler] of lease.listeners)this.bot.removeListener(event,handler);
    lease.parentSignal.removeEventListener('abort',lease.invalidate);
  }
  dispatch(name,signal) {
    if(this.lease && (!['inspect','explore'].includes(name) || signal!==this.lease.parentSignal || !this.valid()))this.clear();
  }
  begin({origin,radius,block,parentSignal}) {
    this.clear();
    const scope=normalizeDependency({origin,radius:radius+1}), snapshot=this.snapshot();
    if(!scope || !snapshot || typeof block!=='string' || !(parentSignal instanceof AbortSignal) || parentSignal.aborted)return null;
    const lease={scope,snapshot,block,radius,parentSignal,key:randomUUID(),confirmed:false,expires:this.now()+this.ttlMs,listeners:[]};
    this.lease=lease;
    lease.invalidate=()=>{if(this.lease===lease)this.clear();};
    for(const event of ['blockUpdate','chunkColumnLoad','chunkColumnUnload','spawn','respawn','end','terrainUntrusted']) {
      const handler=(...args)=>{let relevant=true;try{relevant=relevantTerrainEvent(scope,event,args);}catch{}if(relevant)lease.invalidate();};
      lease.listeners.push([event,handler]);
    }
    const moved=()=>{if(!this.valid(lease))lease.invalidate();};
    for(const event of ['move','physicsTick'])lease.listeners.push([event,moved]);
    for(const [event,handler] of lease.listeners)this.bot.on(event,handler);
    parentSignal.addEventListener('abort',lease.invalidate,{once:true});
    lease.timer=setTimeout(lease.invalidate,this.ttlMs);lease.timer.unref?.();
    if(!this.valid(lease)){this.clear();return null;}return lease;
  }
  confirm(lease,evidence) {
    const p=evidence?.origin, origin=lease?.scope.origin;
    if(!this.valid(lease) || evidence?.complete_empty!==true || evidence.source!=='cursor'
      || evidence.coverage_complete!==true || evidence.context_stable!==true || evidence.termination!=='traversal_complete'
      || evidence.observed_candidates!==0 || evidence.query_skipped_positions!==0 || !Number.isSafeInteger(evidence.skipped_positions) || evidence.skipped_positions<0 || evidence.unloaded_columns!==0 || evidence.unknown_cells!==0
      || evidence.block!==lease.block || evidence.radius!==lease.radius
      || !['x','y','z'].every(k=>p?.[k]===origin?.[k])) {
      if(this.lease===lease)this.clear();return false;
    }
    lease.confirmed=true;return true;
  }
  key() {
    if(!this.valid()){this.clear();return null;}
    return this.lease.confirmed?this.lease.key:null;
  }
}
