// A failed mining receipt can leave Mineflayer's predicted air in its cache.
// Trust is scoped to the bot object, not an action instance or respawn. There
// is intentionally no reset: recovery requires a fresh connection and world.
const quarantined = new WeakMap();

export function terrainTrustStatus(bot) {
  const record = quarantined.get(bot);
  return record ? Object.freeze({ trusted: false, reason: record.reason, at: record.at }) : Object.freeze({ trusted: true });
}

export function assertTerrainTrusted(bot) {
  const record = quarantined.get(bot);
  if (record) throw Object.assign(new Error(`Minecraft terrain is unverified: ${record.reason}. Reconnect before continuing.`), { code: 'TERRAIN_UNTRUSTED' });
}

export function quarantineTerrain(bot, reason) {
  if (quarantined.has(bot)) return terrainTrustStatus(bot);
  const message = reason instanceof Error ? reason.message : String(reason || 'Mining was not confirmed by the server');
  quarantined.set(bot, Object.freeze({ reason: message, at: new Date().toISOString() }));
  // Publish the quarantine before any callbacks: reentrant actions must fail.
  // A broken cleanup hook must not prevent later shutdown attempts.
  let quitRequested = false;
  const attempts = [
    () => bot.pathfinder?.setGoal(null),
    () => bot.clearControlStates?.(),
    () => bot.stopDigging?.(),
    () => bot.emit?.('terrainUntrusted', Object.assign(new Error(message), { code: 'TERRAIN_UNTRUSTED' })),
    () => { if (typeof bot.quit === 'function') { bot.quit('Unconfirmed terrain edit; reconnect before continuing'); quitRequested = true; } },
    () => { if (!quitRequested) bot._client?.end?.('Unconfirmed terrain edit'); }
  ];
  for (const attempt of attempts) {
    try { attempt(); } catch { /* Quarantine remains set; try remaining stops. */ }
  }
  return terrainTrustStatus(bot);
}
