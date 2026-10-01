// These are deliberately narrow, whole-goal contracts, not a natural-language
// verifier. Compound goals and unrecognized wording must stay unverified.
const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak'];
const LOGS = WOODS.map(wood => `${wood}_log`);
const PLANKS = [...WOODS, 'bamboo', 'crimson', 'warped'].map(wood => `${wood}_planks`);
const QUANTITIES = Object.fromEntries(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen'].map((word, i) => [word, i + 1]));
const aliases = new Map([['log', LOGS], ['logs', LOGS], ['plank', PLANKS], ['planks', PLANKS]]);
for (const item of [...LOGS, ...PLANKS, 'cobblestone', 'stone', 'coal', 'charcoal', 'obsidian', 'dirt', 'sand', 'glass', 'apple', 'diamond', 'iron_ingot', 'gold_ingot', 'ender_pearl', 'ender_eye', 'blaze_rod', 'stick', 'crafting_table', 'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe']) {
  const words = item.replaceAll('_', ' ');
  aliases.set(words, [item]);
  aliases.set(`${words}s`, [item]);
}

export function completionContract(goal) {
  const text = goal.trim().toLowerCase().replace(/^please\s+/, '').replace(/[.!]$/, '').trim();
  const inventory = /^(?:collect|gather|obtain|get|have) (?:at least )?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen) ([a-z_: ]+)$/.exec(text);
  if (inventory) {
    const count = /^\d+$/.test(inventory[1]) ? Number(inventory[1]) : QUANTITIES[inventory[1]];
    const noun = inventory[2];
    // Exact registry identifiers are supported; prose with extra clauses is not.
    const items = aliases.get(noun) ?? (/^(?:minecraft:[a-z][a-z0-9_]*|[a-z][a-z0-9]*_[a-z0-9_]+)$/.test(noun) ? [noun.replace(/^minecraft:/, '')] : null);
    if (items && Number.isSafeInteger(count) && count > 0) return { type: 'inventory', items, count };
  }
  const dimension = /^(?:(?:go|travel) to|enter) (?:the )?(nether|end|overworld)$/.exec(text);
  if (dimension) return { type: 'dimension', dimension: dimension[1] };
  if (/^(?:defeat|kill|beat) (?:the )?(?:ender )?dragon$/.test(text)) return { type: 'dragon_death' };
  return null;
}

export function verifyCompletion(contract, state, evidence = {}) {
  if (!contract) return { status: 'unverified', reason: 'This goal has no deterministic completion check. The model report is unverified.' };
  if (!state.connected) return { status: 'unmet', reason: 'Minecraft is disconnected; fresh completion evidence is unavailable.' };
  if (contract.type === 'inventory') {
    if (!Array.isArray(state.inventory)) return { status: 'unmet', reason: 'Current inventory observation is unavailable.' };
    const count = state.inventory.filter(item => contract.items.includes(item?.name) && Number.isSafeInteger(item.count) && item.count > 0).reduce((total, item) => total + item.count, 0);
    return { status: count >= contract.count ? 'verified' : 'unmet', reason: `Observed inventory holds ${count} of the required ${contract.count} ${contract.items.join(' / ')}.` };
  }
  if (contract.type === 'dimension') {
    const dimension = String(state.dimension ?? 'unknown').replace(/^minecraft:/, '').replace(/^the_/, '');
    return { status: dimension === contract.dimension ? 'verified' : 'unmet', reason: `Observed dimension is ${dimension}; required ${contract.dimension}.` };
  }
  if (contract.type === 'dragon_death') {
    const verified = evidence.dragonDeathObserved === true;
    return { status: verified ? 'verified' : 'unmet', reason: verified ? 'A dragon death event was observed during this goal.' : 'No dragon death event was observed during this goal. Inventory, the End, an exit portal, or a missing dragon cannot prove a kill.' };
  }
  return { status: 'unverified', reason: 'Unknown completion contract.' };
}

// Only runtime results contribute to this per-goal evidence. Saved notes and
// model-provided arguments cannot certify a death in this play session.
export function recordCompletionEvidence(evidence, name, args, result, before) {
  if ((name === 'fight_dragon' && result?.dragonDeathObserved === true) ||
      (name === 'attack' && result?.mob === 'ender_dragon' && result.killed === true) ||
      (name === 'shoot' && result?.deathObserved === true && before.entities?.some(entity => entity.id === args.entity_id && entity.name === 'ender_dragon'))) {
    evidence.dragonDeathObserved = true;
  }
}

// Canonicalize argument order so reordering JSON keys cannot evade the retry cap.
export function actionSignature(name, args) {
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  return JSON.stringify([name, stable(args)]);
}

export function unsuccessfulResult(name, result) {
  if (!result) return false;
  if (result.completed === false || result.blocked || result.status === 'blocked' || result.outcome === 'blocked' || result.fired === false) return true;
  // Match the actual runtime contracts; these tools do not return a generic
  // completed/blocked flag. Combat attempts are not proof of damage, but they
  // also cannot be classified as zero progress merely because no kill occurred.
  switch (name) {
    case 'pickup': return Boolean(result.remaining_drops?.length || result.unreachable?.length);
    case 'fight_dragon': return result.dragonDeathObserved === false && result.arrowsFired === 0 && result.meleeAttempts === 0 && Boolean(result.blockedCrystals?.length);
    case 'attack': return result.killed === false && result.timed_out === true && result.attacks_sent === 0;
    case 'locate_stronghold': return result.bearingRecorded === false;
    default: return false;
  }
}

const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const moved = (before, after) => {
  const a = before.position, b = after.position;
  return Boolean(a && b && Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) >= 0.5);
};
const gains = result => result?.inventory_changes && Object.values(result.inventory_changes).some(positive);

// Credit explicit per-call runtime observations, not generic "changed" flags,
// elapsed time, ambient world changes, or successful reads/chat. Partial mining
// and building are progress even though the full action was not completed.
export function actionMadeProgress(name, result, before, after) {
  if (!result) return false;
  switch (name) {
    case 'collect': case 'dig_at': return positive(result.mined) || Boolean(gains(result));
    case 'pickup': return Boolean(gains(result));
    case 'build': case 'build_nether_portal': return positive(result.placed);
    case 'place': return result.placed === true;
    case 'craft': return positive(result.crafted);
    case 'smelt': return positive(result.smelted);
    case 'activate_end_portal': return positive(result.inserted);
    case 'enter_portal': return result.transitioned === true && result.from !== result.to;
    case 'shoot': return positive(result.shots) || result.deathObserved === true;
    case 'attack': return result.killed === true || moved(before, after);
    case 'fight_dragon': return result.dragonDeathObserved === true || moved(before, after);
    case 'locate_stronghold': return result.bearingRecorded === true;
    case 'explore': return result.explored === true && positive(result.distance);
    case 'go_to': case 'go_to_waypoint': return result.arrived === true && moved(before, after);
    case 'eat': return after.food > before.food || after.health > before.health;
    case 'equip': return JSON.stringify(before.equipment) !== JSON.stringify(after.equipment) || before.held_item !== after.held_item;
    case 'sleep': return !before.sleeping && after.sleeping === true;
    default: return false;
  }
}
