// The pinned registry advertises the old numeric entity_action mapping for
// Java1.21.8 despite its shortened enum. Physics queries this feature at each
// sprint control change. Correct it per connection, never in shared registry.
const installed=new WeakSet();
export function pinnedSprintCompatibility(bot) {
  if(bot.version!=='1.21.8'||installed.has(bot))return;
  if(typeof bot.supportFeature!=='function')throw Error('Protocol compatibility requires initialized feature support');
  const original=bot.supportFeature.bind(bot);
  installed.add(bot);
  if(original('entityActionUsesStringMapper'))return;
  bot.supportFeature=name=>name==='entityActionUsesStringMapper'?true:original(name);
}
