// Starter-only short deferrals, not a permanent item blacklist. A remote route
// change may be outside this observed halo, so every entry expires after 30s.
export class DropRetryCache {
  constructor(bot,{now=()=>performance.now(),ttlMs=30000,limit=128}={}){this.bot=bot;this.now=now;this.ttlMs=ttlMs;this.limit=limit;this.scope=null;this.records=new Map()}
  fingerprint(entity, itemPosition=entity?.position, botPosition=this.bot.entity?.position){
    const p=itemPosition,b=botPosition;
    if(!p||!b||!['x','y','z'].every(k=>Number.isFinite(p[k])&&Number.isFinite(b[k])))return null;
    const cells=new Map();
    for(const [center,radius]of [[p,2],[b,1]])for(let x=-radius;x<=radius;x++)for(let y=-radius;y<=radius;y++)for(let z=-radius;z<=radius;z++){
      const q=center.floored().offset(x,y,z),block=this.bot.blockAt(q);
      cells.set(q.toString(),block?[block.stateId??null,block.name,Boolean(block.isWaterlogged)]:null);
    }
    return JSON.stringify([...cells].sort(([a],[b])=>a.localeCompare(b)));
  }
  setScope(scope){if(typeof scope!=='string'||!scope)return false;if(this.scope!==scope){this.records.clear();this.scope=scope}return true}
  current(entity,scope){
    if(!this.setScope(scope))return null;
    const r=this.records.get(entity.id);if(!r)return null;
    if(r.entity!==entity||r.name!==entity.name||r.dimension!==this.bot.game?.dimension||this.now()>=r.expires||!entity.position||!this.bot.entity?.position||!['x','y','z'].every(k=>Number.isFinite(entity.position[k])&&Number.isFinite(this.bot.entity.position[k]))||entity.position.distanceTo(r.itemPosition)>=1||this.bot.entity.position.distanceTo(r.botPosition)>=4||this.fingerprint(entity,r.itemPosition,r.botPosition)!==r.terrain){this.records.delete(entity.id);return null}
    return r;
  }
  deferred(entity,scope){const r=this.current(entity,scope);return r?.failures>=3?{id:entity.id,reason:r.reason,failures:r.failures,retry_after_ms:Math.max(0,Math.ceil(r.expires-this.now()))}:null}
  failed(entity,scope,reason){
    if(!this.setScope(scope)||!Number.isSafeInteger(entity?.id))return;
    const terrain=this.fingerprint(entity);if(terrain===null)return;
    const previous=this.current(entity,scope),now=this.now();
    this.records.delete(entity.id);
    this.records.set(entity.id,{entity,name:entity.name,dimension:this.bot.game?.dimension,itemPosition:previous?.itemPosition??entity.position.clone(),botPosition:previous?.botPosition??this.bot.entity.position.clone(),terrain:previous?.terrain??terrain,failures:(previous?.failures??0)+1,expires:now+this.ttlMs,reason:String(reason).slice(0,300)});
    while(this.records.size>this.limit)this.records.delete(this.records.keys().next().value);
  }
  succeeded(entity,scope){if(this.setScope(scope))this.records.delete(entity.id)}
}
