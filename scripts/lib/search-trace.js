// Diagnostic-only attribution. Never imported by production actions or Runtime.
// Wrappers preserve return values/errors and do not change any lease decision.
export function installSearchTrace(Continuation, write, {limit=2000, now=()=>performance.now()}={}) {
 const methods=['begin','retain','dispatch','finishedCleanup','release','clear']
 const original=new Map(methods.map(name=>[name,Continuation.prototype[name]]))
 const wrappers=new Map(),contexts=new WeakMap(),bots=new Map(),ids=new WeakMap()
 let sequence=0,nextId=0,closed=false
 const id=value=>{if(!value||typeof value!=='object')return null;if(!ids.has(value))ids.set(value,++nextId);return ids.get(value)}
 const point=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k]))?{x:p.x,y:p.y,z:p.z}:null
 const emitRecord=data=>{if(closed||sequence>=limit)return;try{write({sequence:++sequence,at:now(),...data,limitReached:sequence===limit})}catch{}}
 const fields=state=>{
  const bot=state.bot,e=bot.entity
  const current=[e?.position?.x,e?.position?.y,e?.position?.z,e?.velocity?.x,e?.velocity?.y,e?.velocity?.z,e?.yaw,e?.pitch,e?.onGround,bot.game?.dimension,bot.game?.minY,bot.game?.height]
  const prior=state.lease?.snapshot;let previous=[]
  try{const p=JSON.parse(prior?.state??'null');if(p)previous=[...p[0],...p.slice(1)]}catch{}
  const names=['x','y','z','velocityX','velocityY','velocityZ','yaw','pitch','onGround','dimension','minY','height']
  return {changes:names.flatMap((name,i)=>Object.is(previous[i],current[i])?[]:[{field:name,before:previous[i]??null,after:current[i]??null}]),
   identityChanges:prior?['entity','client','world','registry'].filter(k=>prior[k]!==({entity:e,client:bot._client,world:bot.world,registry:bot.registry})[k]):[]}
 }
 const trackBot=(bot,state)=>{
  if(bots.has(bot)){bots.get(bot).states.add(state);return}
  const prior=bot.emit,entry={prior,descriptor:Object.getOwnPropertyDescriptor(bot,'emit'),trigger:null,states:new Set([state])};bots.set(bot,entry)
  entry.wrapper=function(name,...args){
   const old=entry.trigger
   const watched=['blockUpdate','chunkColumnLoad','chunkColumnUnload','physicsTick','move','spawn','respawn','end','terrainUntrusted'].includes(name)
   if(watched){try{entry.trigger={name,oldPosition:point(args[0]?.position),newPosition:point(args[1]?.position),column:point(args[0])}}catch{entry.trigger={name,geometryMalformed:true}}}
   const pending=[]
   if(!closed&&sequence<limit&&['blockUpdate','chunkColumnLoad','chunkColumnUnload'].includes(name)){
    for(const state of entry.states)if(state.lease?.pending)pending.push([state,state.lease])
   }
   try{return prior.call(this,name,...args)}finally{
    try{for(const [state,lease]of pending)emitRecord({event:'terrain_observed',leaseId:id(lease),cursorId:id(lease.cursor),trigger:entry.trigger,
     leaseStillOwned:state.lease===lease&&!lease.invalid,terrainDependency:lease.terrainDependency?{origin:lease.terrainDependency.origin,radius:lease.terrainDependency.radius}:null})}catch{}
    entry.trigger=old
   }
  }
  bot.emit=entry.wrapper
 }
 for(const name of methods){
  const wrapped=function(...args){
   let context=contexts.get(this)
   if(!context){context=[];contexts.set(this,context)}
   try{trackBot(this.bot,this)}catch{}
   const lease=this.lease,caller=context.at(-1)??null
   context.push(name)
   if(!closed&&sequence<limit&&name==='clear'&&lease){
    try{emitRecord({event:'clear',caller,leaseId:id(lease),cursorId:id(lease.cursor),pending:lease.pending,
     expired:lease.pending?this.now()>=lease.expires:false,parentAborted:lease.parentSignal.aborted,actionAborted:lease.actionSignal.aborted,
     trigger:bots.get(this.bot)?.trigger??null,...fields(this),
     cursor:{section:point(lease.cursor?.section),cell:lease.cursor?.cell,visited:lease.cursor?.visited?.size,resumable:lease.cursor?.resumable},
     stack:new Error().stack.split('\n').slice(2,6).join('\n').slice(0,900)})}catch{}
   }
   let result
   try{result=original.get(name).apply(this,args);return result}
   finally{
    if(!closed&&sequence<limit&&(name==='begin'||name==='retain')){
     try{const current=this.lease;emitRecord({event:name,leaseId:id(current),cursorId:id(current?.cursor),resumed:current?.resumed??false,pending:current?.pending??false,
      accepted:name==='retain'?result===true:Boolean(result),previousLeaseId:id(lease),keyMatches:name==='begin'&&lease?lease.key===args[0]?.key:null,
      parentMatches:name==='begin'&&lease?lease.parentSignal===args[0]?.parentSignal:null,
      cursor:{section:point(current?.cursor?.section),cell:current?.cursor?.cell,visited:current?.cursor?.visited?.size,resumable:current?.cursor?.resumable}})}catch{}
    }
    context.pop()
   }
  }
  wrappers.set(name,wrapped);Continuation.prototype[name]=wrapped
 }
 return()=>{
  closed=true
  for(const [name,wrapped]of wrappers)if(Continuation.prototype[name]===wrapped)Continuation.prototype[name]=original.get(name)
  for(const [bot,entry]of bots)if(bot.emit===entry.wrapper){if(entry.descriptor)Object.defineProperty(bot,'emit',entry.descriptor);else delete bot.emit}
  bots.clear()
 }
}
