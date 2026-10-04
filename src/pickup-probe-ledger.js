// Negative route evidence lives only within one pickup invocation. Every
// observed collision-input change invalidates it; it is not a blacklist.
export const PICKUP_PROBE_EVENTS = Object.freeze(['blockUpdate','chunkColumnLoad','chunkColumnUnload','entitySpawn','entityGone','entityMoved','entityUpdate']);
export class PickupProbeLedger {
  constructor(bot) {
    this.bot=bot;this.revision=0;this.entries=new Map();
    this.changed=()=>{this.revision++};
    for(const event of PICKUP_PROBE_EVENTS)bot.on(event,this.changed);
  }
  context(target) {
    const p=this.bot.entity?.position,q=target?.position;
    const coordinates=[p?.x,p?.y,p?.z,q?.x,q?.y,q?.z];
    return coordinates.every(Number.isFinite) ? JSON.stringify([this.bot.game?.dimension??null,this.bot.entity?.onGround??null,...coordinates,this.revision]) : null;
  }
  entry(target,context) {
    const entry=this.entries.get(target);
    return context!==null && entry?.context===context ? entry : null;
  }
  failed(target,context,cell) {
    if(context===null)return;
    let entry=this.entry(target,context);
    if(!entry){
      if(!this.entries.has(target)&&this.entries.size>=64)this.entries.delete(this.entries.keys().next().value);
      entry={context,cells:new Set(),spent:false};this.entries.set(target,entry);
    }
    if(entry.cells.size<3)entry.cells.add(cell.toString());
  }
  tried(target,context,cell) { return this.entry(target,context)?.cells.has(cell.toString())??false; }
  exhaust(target,context) { const entry=this.entry(target,context);if(entry)entry.spent=true; }
  spent(target) { return this.entry(target,this.context(target))?.spent??false; }
  dispose() { for(const event of PICKUP_PROBE_EVENTS)this.bot.removeListener(event,this.changed);this.entries.clear(); }
}
