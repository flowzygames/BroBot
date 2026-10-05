import { STARTER_SUPPORT_PROTECTED } from './starter-leaf-support.js';
import { MINING_NO_GOAL_SPACE } from './mining-goal-space.js';
import { STARTER_FOODS } from './starter-foods.js';
import { STARTER_MOVEMENT_RADIUS, STARTER_STOP_RADIUS, STARTER_SCOUT_LIMIT, STARTER_LEG_RADIUS, STARTER_MIN_HEALTH } from './starter-limits.js';
import { randomUUID } from 'node:crypto';
import { recordScoutObservation, rankScouts, SCOUT_GOAL_POLICY } from './scout-coverage.js';
import { setTimeout as sleep } from 'node:timers/promises';

export const STARTER_LOG_RADIUS = 48;
const LOW_AIR_MESSAGE = 'Air is low. Work stopped, but the world keeps running. Bring BroBot above water before resuming.';
const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak'];
const countItems = state => Object.fromEntries((state.inventory ?? []).map(i => [i.name, (state.inventory ?? []).filter(j => j.name === i.name).reduce((n, j) => n + j.count, 0)]));
const inventoryKey = state => JSON.stringify(Object.entries(countItems(state)).sort(([a],[b])=>a.localeCompare(b)));
const distance = (a, b) => a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : Infinity;
const sameTravelCell = (a,b) => a && b && ['x','y','z'].every(k=>Number.isFinite(a[k]) && Number.isFinite(b[k]) && Math.floor(a[k])===Math.floor(b[k]));
const dimension = d => String(d).replace(/^minecraft:/, '');
const action = (name, args, reason) => ({ name, args, reason });

const travelCellKey = p => ['x','y','z'].map(k=>Math.floor(p[k])).join(',');
const validTravelPoint = p => p && ['x','y','z'].every(k=>Number.isFinite(p[k]));
const validTravelArrival = (arrival, home) => validTravelPoint(arrival?.target) && validTravelPoint(arrival?.position)
  && ['x','y','z'].every(k=>Number.isInteger(arrival.target[k])) && [1,2].includes(arrival.radius)
  && distance(arrival.position,{x:arrival.target.x+.5,y:arrival.target.y,z:arrival.target.z+.5})<=arrival.radius+1.2
  && distance(arrival.position,home)<=STARTER_MOVEMENT_RADIUS;
export function retainedTravelArrivals(job) {
  const waypointCells = new Set((Array.isArray(job.observedPositions)?job.observedPositions:[]).filter(validTravelPoint).slice(-64).map(travelCellKey));
  // Intermediate return requests use radius 1. A wider table arrival is not
  // evidence for the tighter request, even when the nominal cell matches.
  const arrivals = new Map();
  const retain = arrival => { if(arrival?.radius===1 && validTravelArrival(arrival,job.home.position) && waypointCells.has(travelCellKey(arrival.target))) arrivals.set(travelCellKey(arrival.target),{target:{...arrival.target},position:{...arrival.position},radius:arrival.radius}); };
  for(const arrival of (Array.isArray(job.travelArrivals)?job.travelArrivals:[]).slice(-64))retain(arrival);
  for(const entry of (Array.isArray(job.history)?job.history:[]).slice(-32)) {
    const args=entry?.args,result=entry?.result;
    if(entry?.action!=='go_to' || args?.returnable!==true || result?.arrived!==true || !validTravelPoint(args) || !validTravelPoint(result.target))continue;
    if(!['x','y','z'].every(k=>Number.isInteger(args[k]) && result.target[k]===args[k]) || result.radius!==(args.radius??1))continue;
    retain({target:result.target,position:result.position,radius:result.radius});
  }
  return [...arrivals.values()];
}

// Long returns use actually observed intermediate positions, not invented
// straight-line points in potentially unloaded terrain. Each leg is certified.
function starterTravel(state, job, target, reason, waypointKind) {
  const valid = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]));
  const arrivals = new Map(retainedTravelArrivals(job).map(a=>[travelCellKey(a.target),a.position]));
  const observedArrival = waypoint => arrivals.get(travelCellKey(waypoint)) ?? waypoint;
  // Graph representatives use observed successful arrivals. Execution still
  // targets the original waypoint region; home/table goals are never moved.
  const nodes = [{ ...state.position }, { ...target }], waypoints = [{...state.position},{...target}];
  for (const p of (Array.isArray(job.observedPositions) ? job.observedPositions : []).slice(-64)) {
    if(!valid(p) || distance(p,job.home.position)>STARTER_MOVEMENT_RADIUS)continue;
    const arrival=observedArrival(p);
    if (!nodes.some(q => distance(arrival,q) <= 2)) {nodes.push({...arrival});waypoints.push({...p});}
  }
  const excluded = (Array.isArray(job.ignoredTravelEdges) ? job.ignoredTravelEdges : []).filter(e => valid(e?.from) && valid(e?.to)).slice(-128);
  // A standing cell absorbs arrival jitter without treating distinct nearby
  // cells as one failed region.
  const rejected = (a,b) => excluded.some(e => (sameTravelCell(a,e.from) && sameTravelCell(b,e.to)) || (sameTravelCell(a,e.to) && sameTravelCell(b,e.from)));
  // This bounded graph chooses a candidate chain, not a terrain safety proof.
  // The action executor certifies each actual leg. BFS can retrace U-shaped
  // walks that must temporarily move farther from home.
  const queue = [0], parents = new Map([[0,null]]);
  for (let cursor=0; cursor<queue.length && !parents.has(1); cursor++) {
    const current=queue[cursor];
    const neighbors=nodes.map((p,i)=>i).filter(i=>!parents.has(i) && distance(nodes[current],nodes[i])<=STARTER_LEG_RADIUS && distance(nodes[current],Object.fromEntries(Object.entries(waypoints[i]).map(([k,v])=>[k,Math.floor(v)])))<=STARTER_LEG_RADIUS && !rejected(nodes[current],nodes[i]))
      .sort((a,b)=>distance(nodes[a],target)-distance(nodes[b],target));
    for(const i of neighbors){parents.set(i,current);queue.push(i);}
  }
  if (!parents.has(1)) return { blocked: 'No unspent observed waypoint chain remains for a bounded return. Review the route before resuming.' };
  let first=1;while(parents.get(first)!==0)first=parents.get(first);
  const next=nodes[first], requested=waypoints[first];
  return { ...action('go_to', { x: Math.floor(requested.x), y: Math.floor(requested.y), z: Math.floor(requested.z), radius: first===1 && waypointKind==='table' ? 2 : 1, returnable: true }, reason), travelOrigin:{...state.position}, travelTarget:{...next}, finalTravelLeg:first===1, ...(waypointKind ? { waypointKind, waypointTarget:{...target} } : {}) };
}

// An explicit offline controller, not a substitute label for an untested LLM.
// Every decision is recomputed from observed inventory/world state. No assumed
// recipe success, granted items, teleport, seed lookup, or console commands.
export function nextStarterStep(state, job, observation = {}) {
  const items = countItems(state);
  const has = name => (items[name] ?? 0) > 0;
  if (!state.connected || !state.position) return { blocked: 'Minecraft is disconnected.' };
  if (dimension(state.dimension) !== dimension(job.home.dimension)) return { blocked: 'The world dimension changed. Start a new job in the intended world.' };
  if (Number.isFinite(state.oxygen) && state.oxygen <= 10) return { blocked: LOW_AIR_MESSAGE };
  if (observation.powderSnowContact === true) return { blocked: 'Powder snow is touching BroBot. Work stopped, but freezing continues. Move BroBot onto dry solid ground before resuming.' };
  if (observation.lavaContact === true) return { blocked: 'Lava is detected at BroBot’s position. Work stopped, but the world keeps running. Move BroBot to dry ground before resuming.' };
  if (state.health <= STARTER_MIN_HEALTH) return { blocked: 'Health is too low to continue gathering safely.' };
  if (distance(state.position, job.home.position) > STARTER_STOP_RADIUS) return { blocked: `The starter job reached its ${STARTER_STOP_RADIUS}-block travel boundary.` };
  if (state.food != null && state.food <= 10) {
    const food = STARTER_FOODS.find(has);
    return food ? action('eat', { item: food }, 'Recover hunger before working.') : { blocked: 'Food is low and no supported safe food is carried.' };
  }
  if ((state.entities ?? []).some(e => e.type === 'hostile' && e.distance < 6)) return { blocked: 'A hostile mob is too close for unarmored starter gathering.' };
  if (has('stone_pickaxe') && has('furnace')) {
    if (distance(state.position, job.home.position) <= 2.5) return { complete: true, evidence: { stone_pickaxe: items.stone_pickaxe, furnace: items.furnace, homeDistance: distance(state.position, job.home.position) } };
    return starterTravel(state, job, job.home.position, 'Return to the job starting point with the starter kit.', 'home');
  }
  const ensurePlanks = wanted => {
    if (WOODS.some(w => (items[`${w}_planks`] ?? 0) >= wanted)) return null;
    const wood = WOODS.find(w => has(`${w}_log`));
    if (wood) return action('craft', { item: `${wood}_planks`, count: Math.min(wanted - (items[`${wood}_planks`] ?? 0), items[`${wood}_log`] * 4) }, 'Turn carried logs into the needed planks.');
    if (!observation.wood) return { scout: 'No supported tree logs are visible nearby.' };
    const startingTools = !['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'].some(has);
    // Initial empty inventory needs nine planks (table, sticks, pickaxe), but
    // later observations may already contain most prerequisites. Do not fetch
    // another full three-log batch for a one-plank deficit.
    const bestPlanks = Math.max(0, ...WOODS.map(w => items[`${w}_planks`] ?? 0));
    const prerequisitePlanks = (has('crafting_table') || observation.tableInReach ? 0 : 4) + ((items.stick ?? 0) >= 2 ? 0 : 2) + 3;
    const missingPlanks = startingTools ? prerequisitePlanks - bestPlanks : wanted - bestPlanks;
    const logCount = Math.max(1, Math.min(3, Math.ceil(missingPlanks / 4)));
    return action('collect', { block: `${observation.wood}_log`, count: logCount, radius: STARTER_LOG_RADIUS }, startingTools ? 'Gather one bounded batch for the table, sticks and first pickaxe.' : 'Gather only the wood currently needed.');
  };
  const table = has('crafting_table') || observation.tableInReach;
  const ensureTable = () => {
    const ignored = job.ignoredTables ?? [];
    const known = (job.tables ?? []).filter(p => distance(p, job.home.position) <= STARTER_MOVEMENT_RADIUS).filter(p => !ignored.some(q => distance(p, q) < 1)).sort((a, b) => distance(a, state.position) - distance(b, state.position));
    for (const table of known) {
      const route = starterTravel(state, job, table, 'Return to an observed crafting table instead of searching for more wood.', 'table');
      if (!route.blocked) return route;
    }
    return ensurePlanks(4) ?? action('craft', { item: 'crafting_table', count: 1 }, 'Make a portable crafting table.');
  };
  const hasMiningTool = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'].some(has);
  if (!hasMiningTool) {
    if (!table) return ensureTable();
    if ((items.stick ?? 0) < 2) return ensurePlanks(2) ?? action('craft', { item: 'stick', count: 4 }, 'Make pickaxe handles.');
    return ensurePlanks(3) ?? action('craft', { item: 'wooden_pickaxe', count: 1 }, 'Craft the first mining tool.');
  }
  if (!has('stone_pickaxe') && (items.stick ?? 0) < 2) return ensurePlanks(2) ?? action('craft', { item: 'stick', count: 4 }, 'Prepare stone-pickaxe handles.');
  // If the table is elsewhere, gather the full kit before making a return trip.
  // Upgrade immediately when a usable table is already nearby.
  const requiredStone = has('stone_pickaxe') ? 8 : table ? 3 : 11;
  if ((items.cobblestone ?? 0) < requiredStone) {
    const needed = requiredStone - (items.cobblestone ?? 0);
    return action('collect', { block: 'stone', count: Math.min(needed, 4), radius: 32 }, 'Collect a bounded batch of stone and verify its drops.');
  }
  if (!table) return ensureTable();
  return has('stone_pickaxe') ? action('craft', { item: 'furnace', count: 1 }, 'Craft a furnace from eight verified cobblestone.') : action('craft', { item: 'stone_pickaxe', count: 1 }, 'Upgrade to a stone pickaxe.');
}

export class SurvivalJob {
  constructor({ memory, snapshot, observe, execute, stopActions, context, session = null, recoverFromHostile = null, now = () => performance.now(), log = () => {}, maxSteps = 96, maxDurationMs = 600000, intervalMs = 150 }) {
    Object.assign(this, { memory, snapshot, observe, execute, stopActions, context, log, maxSteps, maxDurationMs, intervalMs });
    this.active = null;
    this.recoverFromHostile=recoverFromHostile;this.now=now;this.hostileRecovery=null;
    this.session = session ?? (() => this);
    this.dropRecoverySession = null;
    this.job = memory.get('survivalJob', null);
    if (this.job && (this.job.version !== 1 || typeof this.job.context !== 'string' || !Array.isArray(this.job.history) || !Number.isSafeInteger(this.job.steps) || this.job.steps < 0 || !Number.isSafeInteger(this.job.scouts) || this.job.scouts < 0 || !this.job.home?.position || !['x', 'y', 'z'].every(k => Number.isFinite(this.job.home.position[k])) || !['running', 'paused', 'blocked', 'complete'].includes(this.job.status))) throw new Error('Saved starter job is invalid. Restore its record before resuming.');
    if (Object.hasOwn(this.job ?? {}, 'canopyDescentAttempts') && (!Array.isArray(this.job.canopyDescentAttempts)
      || this.job.canopyDescentAttempts.length > 4 || this.job.canopyDescentAttempts.some(p=>!p || !['x','y','z'].every(k=>Number.isSafeInteger(p[k]))))) throw new Error('Saved canopy recovery history is invalid.');
    if (Object.hasOwn(this.job ?? {},'travelArrivals') && (!Array.isArray(this.job.travelArrivals) || this.job.travelArrivals.length>64 || this.job.travelArrivals.some(a=>!validTravelArrival(a,this.job.home.position)))) throw new Error('Saved travel arrival evidence is invalid.');
    if(Object.hasOwn(this.job??{},'scoutGoalPolicy')&&![0,SCOUT_GOAL_POLICY].includes(this.job.scoutGoalPolicy))throw Error('Saved scout goal policy is unsupported');
    if (this.job?.status === 'running') { this.job.status = 'paused'; this.job.reason = 'Process restarted. Resume explicitly after checking the world.'; this.save(); }
  }
  save() {
    if (this.job) {
      const arrivals = retainedTravelArrivals(this.job);
      if (arrivals.length || this.job.travelArrivals) this.job.travelArrivals = arrivals;
    }
    this.memory.set('survivalJob', this.job);
  }
  state() { return this.job ? structuredClone({ ...this.job, history: this.job.history.slice(-8), stopping: Boolean(this.active?.signal.aborted) }) : null; }
  stop(reason = 'Paused by player') { this.active?.abort(new Error(reason)); this.stopActions(reason); }
  requestHostileRecovery(source) {
    if(!this.active || this.active.signal.aborted || !this.job || typeof this.recoverFromHostile!=='function'
      || source?.type!=='hostile' || !Number.isSafeInteger(source.id) || source.id<0)return false;
    if(this.hostileRecovery?.controller===this.active){
      if(this.hostileRecovery.phase==='recovering'){
        this.hostileRecovery.phase='stopping';
        this.stopActions('Another hostile hit occurred during recovery; no further escape leg will start.');
      }
      return true;
    }
    const started=this.now();if(!Number.isFinite(started))return false;
    // Latch first: aborting an uncertain dig may synchronously quarantine the
    // connection and abort the parent job. Never undo that stronger stop.
    const request=this.hostileRecovery={controller:this.active,job:this.job,jobId:this.job.id,session:this.session(),phase:'requested',
      source:{id:source.id,type:'hostile',name:typeof source.name==='string'?source.name:null},at:new Date().toISOString(),started,deadline:started+8000};
    this.job.hostileRecovery={at:this.hostileRecovery.at,source:this.hostileRecovery.source,status:'requested',result:null};
    this.stopActions('Hostile attack observed: interrupting starter work for one bounded recovery check.');
    // Initiate cancellation before synchronous persistence. A restart while
    // the old physical action drains must not resurrect an earlier success.
    if(this.hostileRecovery===request&&this.active===request.controller&&this.job===request.job){
      try{this.save();}catch(error){
        request.controller.abort(Error(`Cannot persist hostile recovery request: ${error.message}`));
      }
    }
    return true;
  }
  checkHostileRecovery() {
    if(this.hostileRecovery?.controller===this.active)throw Object.assign(new Error('Hostile recovery requested'),{code:'HOSTILE_RECOVERY_REQUESTED'});
  }
  checkRecoveryState(request,controller) {
    controller.signal.throwIfAborted();
    if(this.active!==controller || this.job!==request.job || this.job.id!==request.jobId || this.session()!==request.session)throw Error('Hostile recovery cancelled: play session changed.');
    if(request.phase==='stopping')throw Error('Hostile recovery interrupted by another hit; separation is unverified.');
    const now=this.now();
    if(!Number.isFinite(now)||now>=request.deadline)throw Error('Hostile recovery deadline expired.');
    const state=this.snapshot(),p=state.position;
    if(state.connected!==true || dimension(state.dimension)!==dimension(this.job.home.dimension))throw Error('Hostile recovery unavailable: connection or dimension changed.');
    if(state.terrainTrust?.trusted!==true)throw Error('Hostile recovery unavailable: terrain is not trusted.');
    if(!Number.isFinite(state.health)||state.health<=STARTER_MIN_HEALTH)throw Error('Hostile recovery unavailable: health is too low or unknown.');
    if(Number.isFinite(state.oxygen)&&state.oxygen<=10)throw Error('Hostile recovery unavailable: air is too low.');
    if(!p || !['x','y','z'].every(k=>Number.isFinite(p[k])) || distance(p,this.job.home.position)>STARTER_MOVEMENT_RADIUS)throw Error('Hostile recovery unavailable: position is outside the starter boundary.');
    // Nearby hostiles are the reason for recovery, not the ordinary gathering
    // rule that would reject it. The movement executor validates threat routes.
  }
  async finishHostileRecovery(controller) {
    const request=this.hostileRecovery;
    if(!request || request.controller!==controller)return false;
    // Do not mutate a replacement job or launch a continuation for it.
    if(this.active!==controller || this.job!==request.job)return true;
    let reason;
    try{
      this.checkRecoveryState(request,controller);
      request.phase='recovering';
      const result=await this.recoverFromHostile(request,controller.signal);
      this.checkRecoveryState(request,controller);
      this.job.hostileRecovery={at:request.at,finished:new Date().toISOString(),source:request.source,status:result?.separated===true?'verified':'unverified',result:structuredClone(result??null)};
      reason=result?.separated===true ? 'Observed a grounded retreat with separation. Starter work remains paused; the world keeps running.' : 'Hostile recovery did not verify separation. Starter work remains paused; the world keeps running.';
    }catch(error){
      reason=controller.signal.aborted ? (controller.signal.reason?.message??error.message) : error.message;
      if(this.active===controller && this.job===request.job)this.job.hostileRecovery={at:request.at,finished:new Date().toISOString(),source:request.source,status:'unverified',result:null,reason};
    }
    if(this.active===controller && this.job===request.job){this.job.status='paused';this.job.reason=reason;this.log('survival',`Starter job paused: ${reason}`);}
    return true;
  }
  checkAir() {
    const oxygen = this.snapshot().oxygen;
    if (this.active && Number.isFinite(oxygen) && oxygen <= 10) this.stop(LOW_AIR_MESSAGE);
  }
  start({ resume = false } = {}) {
    if (this.active) throw new Error('A starter job is already running or stopping.');
    const state = this.snapshot();
    if (!state.connected || !state.position) throw new Error('Connect to Minecraft before starting.');
    if (resume) {
      if (!this.job || !['paused', 'blocked'].includes(this.job.status)) throw new Error('No paused starter job to resume.');
      if (this.job.context !== this.context || dimension(state.dimension) !== dimension(this.job.home.dimension)) throw new Error('Saved job belongs to another connection or dimension. Start a new job.');
    } else {
      this.job = { version: 1, scoutGoalPolicy:SCOUT_GOAL_POLICY,id: randomUUID(), goal: 'starter', context: this.context, home: { position: { ...state.position }, dimension: state.dimension }, steps: 0, scouts: 0, clearings: 0, excluded: {}, history: [], started: new Date().toISOString() };
    }
    // An exact-column failure does not prove the new bounded landing region
    // unreachable. Preserve successes, observations and every work counter.
    if(resume&&this.job.scoutGoalPolicy!==SCOUT_GOAL_POLICY){
      this.job.scoutAttempts=(Array.isArray(this.job.scoutAttempts)?this.job.scoutAttempts:[]).filter(a=>a?.status!=='unverified'||a?.goalPolicy===SCOUT_GOAL_POLICY);
      this.job.scoutGoalPolicy=SCOUT_GOAL_POLICY;
    }
    // Resume is explicit: re-inspect and certify the route instead of treating
    // earlier unverified graph edges as permanent world geometry.
    if (resume) this.job.ignoredTravelEdges = [];
    if (!resume || this.dropRecoverySession !== this.session()) this.job.recoverDropIds = [];
    this.job.status = 'running'; this.job.reason = null; this.save();
    this.log('survival', `${resume ? 'Resuming' : 'Starting'} offline starter kit: stone pickaxe, furnace, then return to start.`);
    const deadline=this.now()+this.maxDurationMs;
    if(!Number.isFinite(deadline))throw Error('Starter job deadline is invalid');
    const controller = new AbortController(); this.active = controller;
    const timer = setTimeout(() => { controller.abort(new Error('Starter job time budget reached.')); this.stopActions('Starter job time budget reached.'); }, this.maxDurationMs); timer.unref?.();
    this.promise = this.loop(controller.signal,deadline).catch(async error => {
      if(await this.finishHostileRecovery(controller))return;
      this.job.status = controller.signal.aborted ? 'paused' : 'blocked'; this.job.reason = controller.signal.aborted ? (controller.signal.reason?.message || error.message) : error.message;
      this.log('survival', `Starter job ${this.job.status}: ${this.job.reason}`);
    }).finally(() => {
      clearTimeout(timer);
      try{this.save();}finally{
        if(this.hostileRecovery?.controller===controller)this.hostileRecovery=null;
        if(this.active===controller)this.active=null;
      }
    });
    return { started: true, mode: 'offline-observation-driven', goal: 'stone pickaxe and furnace, then return to start', id: this.job.id };
  }
  async loop(signal,deadline) {
    const failures = new Map(), craftFailureContexts = new Map(), travelFailurePositions = new Map(), blockedWorkstations = new Map();
    const observationKey = (observation, retryKind) => JSON.stringify(retryKind === 'tree-clearance'
      ? { foliage: observation.foliage ?? null, powderSnowContact: observation.powderSnowContact, lavaContact: observation.lavaContact }
      : retryKind === 'craft'
      ? { tableInReach: observation.tableInReach, tables: (observation.tables ?? []).map(p=>[p.x,p.y,p.z]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]), craftGeometry: observation.craftGeometry ?? observation.localTerrain ?? [], powderSnowContact: observation.powderSnowContact, lavaContact: observation.lavaContact }
      : observation);
    const retryContext = (state, observation, retryKind = null) => ({retryKind,inventoryKey:inventoryKey(state),observationKey:observationKey(observation,retryKind),position:{...state.position}});
    const sameContext = (saved, state, observation) => saved && inventoryKey(state)===saved.inventoryKey && observationKey(observation,saved.retryKind)===saved.observationKey && distance(state.position,saved.position)<=0.1;
    const firstStep = this.job.steps;
    let recovery = this.job.recoverDropIds?.length ? action('pickup', { radius: 16, entity_ids: [...this.job.recoverDropIds] }, 'Recover still-observed drops from this play session after resuming.') : null;
    const excludeFailures = (decision, result) => {
      if (decision.name !== 'collect' || !result?.failures) return;
      this.job.excluded ??= {};
      const old = this.job.excluded[decision.args.block] ?? [];
      const positions = result.failures.filter(f => f.position && f.code !== 'COLLECTION_PLANNING_LIMIT' && (f.code === STARTER_SUPPORT_PROTECTED || f.code === MINING_NO_GOAL_SPACE || /route|reach|planning|obstruct/i.test(f.error ?? ''))).map(f => f.position);
      const unique = new Map([...old, ...positions].map(p => [JSON.stringify(p), p]));
      this.job.excluded[decision.args.block] = [...unique.values()].slice(-128);
    };
    const remember = entry => { this.job.history.push({ at: new Date().toISOString(), ...entry }); this.job.history = this.job.history.slice(-32); this.save(); };
    while (this.job.steps - firstStep < this.maxSteps) {
      signal.throwIfAborted();
      this.checkHostileRecovery();
      if (this.now() >= deadline) throw new Error('Starter job time budget reached. Review progress before resuming.');
      const arrivals = retainedTravelArrivals(this.job);
      if(arrivals.length || this.job.travelArrivals)this.job.travelArrivals=arrivals;
      const before = this.snapshot();
      // Check lifecycle/health before any further inspection or movement.
      let decision = nextStarterStep(before, this.job, {});
      if (decision.blocked) throw new Error(decision.blocked);
      const observation = await this.observe(signal);
      signal.throwIfAborted();
      this.checkHostileRecovery();
      this.job.observedPositions = recordScoutObservation(this.job.observedPositions, this.snapshot().position);
      if (Array.isArray(observation.tables)) this.job.tables = observation.tables.slice(0, 8);
      decision = nextStarterStep(this.snapshot(), this.job, observation);
      if (decision.blocked) throw new Error(decision.blocked);
      if (decision.complete) { this.job.status = 'complete'; this.job.evidence = decision.evidence; this.job.reason = 'Observed a stone pickaxe and furnace in inventory, alive and back at the start.'; this.log('survival', this.job.reason); return; }
      // Freshly observed completion prerequisites outrank stale gathering
      // recovery (including queued scouts and leaf clearance). The route still
      // goes through the normal safety checks and certified walking executor.
      if (decision.waypointKind === 'home' || decision.name === 'eat') recovery = null;
      const intendedAction = decision.name ? JSON.stringify([decision.name,decision.args]) : null;
      if (decision.name==='craft' && craftFailureContexts.has(intendedAction) && !sameContext(craftFailureContexts.get(intendedAction),this.snapshot(),observation)) {
        const previous = craftFailureContexts.get(intendedAction), current = this.snapshot();
        this.log('survival', 'Craft retry evidence changed', {
          inventory_changed: inventoryKey(current) !== previous.inventoryKey,
          position_changed: distance(current.position, previous.position) > 0.1,
          workstation_observation_changed: observationKey(observation, 'craft') !== previous.observationKey
        });
        failures.delete(intendedAction);craftFailureContexts.delete(intendedAction);blockedWorkstations.delete(intendedAction);
      }
      if (decision.name === 'go_to' && travelFailurePositions.has(intendedAction)
        && !sameTravelCell(travelFailurePositions.get(intendedAction), this.snapshot().position)) {
        failures.delete(intendedAction); travelFailurePositions.delete(intendedAction);
      }
      if (recovery?.scout && Object.hasOwn(recovery,'sourceIntent')) {
        const current=this.snapshot();
        if(!(decision.scout || ['collect','craft'].includes(decision.name)) || intendedAction!==recovery.sourceIntent || !sameContext(recovery,current,observation)) recovery=null;
      }
      if (recovery?.name === 'dig_at' && Object.hasOwn(recovery,'sourceIntent')
        && (intendedAction !== recovery.sourceIntent || !sameContext(recovery,this.snapshot(),observation))) recovery = null;
      if (recovery?.name === 'descend_notch' && (observation.canopyGrounded !== true
        || intendedAction !== recovery.sourceIntent || !sameContext(recovery,this.snapshot(),observation))) recovery = null;
      if (recovery?.name === 'pickup') {
        // A clearance action may already collect the tracked materials. Never
        // turn its stale continuation into an unscoped trip after other litter.
        const remaining = new Set(this.job.recoverDropIds ?? []);
        recovery.args.entity_ids = (recovery.args.entity_ids ?? []).filter(id => remaining.has(id));
        if (!recovery.args.entity_ids.length) recovery = null;
      }
      if (recovery) {
        // Fresh inventory may already satisfy the next prerequisite. Do not
        // chase leftover drops instead of crafting or taking a finished kit home.
        if (recovery.name !== 'pickup' || decision.name === 'collect' || decision.scout) decision = recovery;
        recovery = null;
      }
      if (decision.name === 'pickup' && observation.pickupClearance && (this.job.clearanceDigs ?? 0) < 8) {
        this.job.clearanceDigs = (this.job.clearanceDigs ?? 0) + 1;
        decision = action('dig_at', observation.pickupClearance, 'Open safe headroom above an observed drop, then pick it up.');
        recovery = action('pickup', { radius: 16, entity_ids: [...(this.job.recoverDropIds ?? [])] }, 'Pick up the materials after opening headroom.');
      }
      if (decision.scout) {
        if (this.job.scouts >= STARTER_SCOUT_LIMIT) throw new Error(`Exploration budget exhausted: ${decision.scout}`);
        const origin = this.snapshot().position;
        const choices = rankScouts({ position: origin, home: this.job.home.position, index: this.job.scouts,
          observations: this.job.observedPositions, attempts: this.job.scoutAttempts, lastSuccess: this.job.lastScoutSuccess });
        if (!choices.length) throw new Error('No bounded exploration target remains inside the job area.');
        this.job.scouts++;
        decision = { ...action('explore', { ...choices[0], alternatives: choices.slice(1).map(c => c.direction) }, decision.scout), scoutOrigin: { ...origin }, retryKind: decision.retryKind ?? null, sourceIntent:Object.hasOwn(decision,'sourceIntent')?decision.sourceIntent:intendedAction };
      }
      const signature = JSON.stringify([decision.name, decision.args]);
      if (decision.name === 'collect' && this.job.excluded?.[decision.args.block]?.length) decision.args.skip_positions = this.job.excluded[decision.args.block];
      if ((failures.get(signature) ?? 0) >= 2) {
        if (decision.name === 'go_to') {
          if (decision.travelOrigin && decision.travelTarget) {
            this.job.ignoredTravelEdges = [...(Array.isArray(this.job.ignoredTravelEdges) ? this.job.ignoredTravelEdges : []), {from:decision.travelOrigin,to:decision.travelTarget}].slice(-128);
            // Keep other observed ways home available; never blacklist a table
            // merely because one intermediate shortcut could not be verified.
            if (decision.waypointKind==='table' && decision.finalTravelLeg===true) {
              this.job.ignoredTables ??=[];this.job.ignoredTables.push(decision.waypointTarget);
            }
            failures.delete(signature);this.save();continue;
          }
          if (decision.waypointKind !== 'table') throw new Error('Cannot verify a route home after two attempts. Starter kit is not marked complete.');
          this.job.ignoredTables ??= [];
          this.job.ignoredTables.push(decision.waypointTarget ?? { x: decision.args.x, y: decision.args.y, z: decision.args.z });
          failures.delete(signature); continue;
        }
        const supportRefused = this.job.history.slice(-4).some(entry => entry.action === 'collect' && entry.args?.block === decision.args.block && entry.result?.failures?.some(f => f.code === STARTER_SUPPORT_PROTECTED));
        const canopyPosition = this.snapshot().position;
        const canopyCell = {x:Math.floor(canopyPosition.x),y:Math.floor(canopyPosition.y),z:Math.floor(canopyPosition.z)};
        const canopyAttempts = Array.isArray(this.job.canopyDescentAttempts) ? this.job.canopyDescentAttempts : [];
        if (decision.name === 'craft' && (blockedWorkstations.get(signature) ?? 0) >= 2 && observation.tableInReach !== true && observation.canopyGrounded === true && this.snapshot().health >= 12 && this.snapshot().food >= 10
          && canopyAttempts.length < 4 && !canopyAttempts.some(p=>distance(p,canopyCell)<.1)) {
          recovery = {...action('descend_notch', {}, 'Try one certified leaf step after repeated blocked workstation crafting.'),sourceIntent:signature,...retryContext(this.snapshot(),observation,'craft')};
        } else if (decision.name === 'collect' && !supportRefused && /_log$/.test(decision.args.block) && observation.foliage && (this.job.clearings ?? 0) < 4) {
          recovery = {...action('dig_at', observation.foliage, 'Clear one observed leaf obstruction in front of a needed tree.'),treeClearance:true,sourceIntent:signature,...retryContext(this.snapshot(),observation,'tree-clearance')};
        } else recovery = { scout: `Repeated ${decision.name} failure. Look for a different approach.`, sourceIntent:signature, ...retryContext(this.snapshot(),observation,decision.name) };
        // Scout decisions are resolved on the next pass; keep a bounded retry cap
        // even when environment changes, instead of silently clearing failures.
        failures.delete(signature);
        continue;
      }
      let scoutRecorded = false;
      const rememberScout = result => {
        if (decision.name !== 'explore' || scoutRecorded) return;
        scoutRecorded = true;
        const allowed = [decision.args.direction, ...(decision.args.alternatives ?? [])];
        const tried = Array.isArray(result?.directions_tried) ? result.directions_tried.filter(d => allowed.includes(d)).slice(0, 4) : [decision.args.direction];
        let completedEndpoint = null, completedNovel = false;
        if (result?.explored === true && Number.isFinite(result.distance) && result.distance >= decision.args.distance - 2) {
          const endpoint = this.snapshot().position;
          if (endpoint && ['x','y','z'].every(k => Number.isFinite(endpoint[k])) && distance(endpoint, decision.scoutOrigin ?? before.position) >= decision.args.distance - 2) {
            completedEndpoint = { ...endpoint };
            completedNovel = !(this.job.observedPositions ?? []).some(p => distance(p, endpoint) <= 4);
            this.job.lastScoutSuccess = { completed: true, adaptive: decision.args.distance < Math.min(64, 12 * (1 + Math.floor((this.job.scouts - 1) / 2))), endpoint: { ...endpoint }, distance: decision.args.distance,
              novel: completedNovel };
          }
        }
        const outcomes = Array.isArray(result?.route_attempts) ? result.route_attempts.filter(a => a && typeof a === 'object') : [];
        const exhausted = allowed.every(direction => outcomes.some(a => a.direction === direction && a.status === 'unverified'))
          && !outcomes.some(a => a.status === 'verified' || a.status === 'cancelled');
        this.job.scoutAttempts = [...(Array.isArray(this.job.scoutAttempts) ? this.job.scoutAttempts : []),
          ...tried.map(direction => ({ goalPolicy:SCOUT_GOAL_POLICY,origin: { ...(decision.scoutOrigin ?? before.position) }, direction,
            distance: decision.args.distance, status: outcomes.find(a => a.direction === direction)?.status ?? 'unknown', exhausted,
            ...(completedEndpoint && direction === (result.direction ?? decision.args.direction) ? {completed:true,novel:completedNovel,endpoint:completedEndpoint} : {}) }))].slice(-STARTER_SCOUT_LIMIT * 4);
      };
      if (decision.name === 'descend_notch') {
        const p = this.snapshot().position;
        const cell = {x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)};
        const attempts = this.job.canopyDescentAttempts ?? [];
        if (attempts.length >= 4 || attempts.some(previous=>distance(previous,cell)<.1)) throw new Error('Canopy recovery attempt budget reached at this position.');
        this.job.canopyDescentAttempts = [...attempts,cell];
      }
      if(this.now()>=deadline)throw Error('Starter job time budget reached. Review progress before resuming.');
      if (decision.treeClearance === true) this.job.clearings = (this.job.clearings ?? 0) + 1;
      this.job.steps++; this.save();
      const actionStartContext = retryContext(this.snapshot(),observation,decision.name);
      try {
        const result = await this.execute(decision.name, decision.args, signal,{jobDeadline:deadline});
        if(!signal.aborted)this.checkHostileRecovery();
        rememberScout(result);
        signal.throwIfAborted();
        const after = this.snapshot();
        excludeFailures(decision, result);
        const initialItems = countItems(before), finalItems = countItems(after);
        const gained = Object.entries(finalItems).some(([name, count]) => count > (initialItems[name] ?? 0));
        const terrainCleared = (decision.name === 'dig_at' && result.mined === 1) || (decision.name === 'descend_notch' && result.completed === true && result.mined === 1 && result.descended_blocks === 1 && Math.abs(before.position.y-after.position.y-1)<=.1);
        if (terrainCleared) {
          // A verified local terrain change can invalidate an earlier blocked
          // approach. Retry nearby resources while retaining distant failures.
          for (const [block, positions] of Object.entries(this.job.excluded ?? {})) {
            this.job.excluded[block] = positions.filter(p => distance(p, decision.name === 'descend_notch' ? after.position : decision.args) > 6);
          }
          this.job.ignoredTables = (this.job.ignoredTables ?? []).filter(p => distance(p, decision.name === 'descend_notch' ? after.position : decision.args) > 6);
        }
        const progress = gained || terrainCleared || (decision.name === 'explore' && distance(before.position, after.position) > 1) || (decision.name === 'go_to' && distance(after.position, decision.args) < distance(before.position, decision.args) - 1) || (after.food ?? 0) > (before.food ?? 0);
        remember({ action: decision.name, args: decision.args, reason: decision.reason, result, progress });
        if (gained || terrainCleared) {
          // Real material/terrain progress can make previously spent local
          // probes useful again. Ordinary walking must not reopen a scout loop.
          this.job.scoutAttempts = [];
          this.job.lastScoutSuccess = null;
        }
        if (progress) { failures.clear();craftFailureContexts.clear();travelFailurePositions.clear();blockedWorkstations.clear(); }
        else { failures.set(signature, (failures.get(signature) ?? 0) + 1);if(decision.name==='craft')craftFailureContexts.set(signature,actionStartContext);if(decision.name==='go_to')travelFailurePositions.set(signature,actionStartContext.position); }
        if (Array.isArray(result.remaining_drops)) {
          this.job.recoverDropIds = result.remaining_drops.map(d => d.id).filter(Number.isSafeInteger).slice(0, 24);
          this.dropRecoverySession = this.session();
        }
        if (decision.name === 'collect' && result.remaining_drops?.length) recovery = action('pickup', { radius: 16, entity_ids: [...(this.job.recoverDropIds ?? [])] }, 'Recover observed dropped materials before mining more.');
      } catch (error) {
        if(!signal.aborted)this.checkHostileRecovery();
        if(error.code==='MINING_DEADLINE_INSUFFICIENT'){
          remember({action:decision.name,args:decision.args,error:error.message,code:error.code,result:error.result});
          this.stop(error.message);throw error;
        }
        rememberScout(error.result);
        signal.throwIfAborted(); failures.set(signature, (failures.get(signature) ?? 0) + 1);
        excludeFailures(decision, error.result);
        remember({ action: decision.name, args: decision.args, error: error.message, code: error.code ?? null, result: error.result });
        if (error.code === 'PICKUP_UNSAFE_SETTLEMENT' || error.code === STARTER_SUPPORT_PROTECTED) throw error;
        const after=this.snapshot(), routes=error.result?.route_attempts;
        if(decision.name==='craft'){
          craftFailureContexts.set(signature,actionStartContext);
          if(error.code==='WORKSTATION_EGRESS_UNVERIFIED' && error.workstation==='crafting_table')blockedWorkstations.set(signature,(blockedWorkstations.get(signature) ?? 0)+1);else blockedWorkstations.delete(signature);
        }
        if(decision.name==='go_to')travelFailurePositions.set(signature,actionStartContext.position);
        if(decision.name==='explore' && Array.isArray(routes) && routes.length && routes.every(r=>r?.status==='unverified')
          && distance(before.position,after.position)<=0.1 && inventoryKey(before)===inventoryKey(after)) {
          // The failed probe changed no material or position. Try an unspent
          // scout instead of paying for identical failed mining/crafting attempts.
          // Fresh resources, tables, inventory or movement invalidate this hint.
          recovery={scout:'The last route probe left gathering conditions unchanged. Try another bounded approach.',afterFailedScout:true,
            sourceIntent:decision.sourceIntent??null,...retryContext(after,observation,decision.retryKind)};
        }
      }
      await sleep(this.intervalMs, undefined, { signal });
    }
    signal.throwIfAborted();this.checkHostileRecovery();
    const final = nextStarterStep(this.snapshot(), this.job, {});
    if (final.complete) { this.job.status = 'complete'; this.job.evidence = final.evidence; this.job.reason = 'Observed the complete starter kit back at the start on the final allowed step.'; return; }
    throw new Error('Starter job step budget reached. No completion claimed.');
  }
}
