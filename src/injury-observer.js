// Hurt animations and health packets are independent observations. Never infer
// one damage amount/cause by joining them, or label an absent source as harmless.
export function observeOwnInjuries(bot, { isCurrent = () => true, log = () => {}, action = () => null, onHealth = () => {}, onHurt = () => {} } = {}) {
  let previousHealth = null, records = [], disposed = false;
  const current = () => !disposed && isCurrent();
  const context = () => {
    const p = bot.entity?.position;
    return { action: action(), position: p && ['x','y','z'].every(k => Number.isFinite(p[k])) ? {x:p.x,y:p.y,z:p.z} : null,
      dimension: bot.game?.dimension ?? null };
  };
  const remember = (data, message) => {
    const record = { at: new Date().toISOString(), ...data };
    records.push(record); records = records.slice(-8);
    log('injury', message, record);
  };
  // Initial spawn precedes health, but respawn's health update precedes spawn.
  // Reset at respawn, then preserve the new health baseline when spawn follows.
  const respawn = () => { if (current()) { previousHealth = null; records = []; } };
  const spawn = () => { if (current()) records = []; };
  const health = () => {
    if (!current()) return;
    // Safety response precedes diagnostics and their journal writes.
    onHealth();
    const value = bot.health;
    if (!Number.isFinite(value) || value < 0) { previousHealth = null; return; }
    if (previousHealth != null && value < previousHealth) {
      const ctx = context();
      remember({kind:'health_loss', before:previousHealth, after:value, loss:previousHealth-value, cause:'unattributed', ...ctx},
        `Health fell ${previousHealth.toFixed(1)} → ${value.toFixed(1)}${ctx.action ? ` during ${ctx.action}` : ''}. Damage cause is unconfirmed.`);
    }
    previousHealth = value;
  };
  const hurt = (entity, source) => {
    if (!current() || !Number.isSafeInteger(bot.entity?.id) || entity?.id !== bot.entity.id) return;
    const ctx = context();
    // Do not retain player usernames or mutable/circular entity objects.
    const from = source ? {id:Number.isSafeInteger(source.id)?source.id:null,
      name:typeof source.name==='string'?source.name:null, type:typeof source.type==='string'?source.type:null} : null;
    // Preserve the original action context, then respond before journal I/O.
    onHurt(from);
    const label = from ? `${from.name || from.type || 'an observed entity'}${from.id == null ? '' : ` #${from.id}`}` : 'an unavailable source';
    remember({kind:'hurt_observation', entityId:entity.id, source:from, sourceStatus:from?'observed_entity':'unavailable',
      health_observed:Number.isFinite(bot.health)?bot.health:null, healthTiming:'May precede or follow the injury; not a damage amount.', ...ctx},
      `Hurt observed from ${label}${ctx.action ? ` during ${ctx.action}` : ''}. Health and hurt packets are separate observations.`);
  };
  const dispose = () => {
    if (disposed) return; disposed = true;
    bot.removeListener('respawn',respawn);bot.removeListener('spawn',spawn);bot.removeListener('health',health);bot.removeListener('entityHurt',hurt);bot.removeListener('end',dispose);
  };
  bot.on('respawn',respawn);bot.on('spawn',spawn);bot.on('health',health);bot.on('entityHurt',hurt);bot.once('end',dispose);
  return { recent:()=>structuredClone(records), dispose };
}
