import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import minecraftData from 'minecraft-data'
import { Vec3 } from 'vec3'
import { createActions, definitions } from '../src/actions.js'
import { createProgression, portalBlueprint } from '../src/progression.js'
import { ActionRunner } from '../src/runner.js'

const registry = minecraftData('1.21.8')

test('foodless automatic scouting disables sprint throughout planning and execution',async()=>{
 for(const food of [20,11,undefined]){
  const bot=fakeBot();bot.food=food;const seen=[];let current;
  bot.pathfinder.setMovements=m=>{current=m;seen.push(m.allowSprinting)};
  bot.pathfinder.getPathFromTo=function*(m,start,goal){seen.push(m.allowSprinting);yield{result:{status:'success',path:[new Vec3(goal.x,goal.y??start.y,goal.z)]}}};
  bot.pathfinder.goto=async goal=>{seen.push(current.allowSprinting);bot.entity.position=new Vec3(goal.x+.5,goal.y??64,goal.z+.5)};
  await createActions(bot).execute('explore',{direction:'east',distance:8,returnable:true},undefined,{starterScope:'job/foodless'});
  assert.ok(seen.length>=4);assert.ok(seen.every(value=>value===false));
 }
});
test('only positive controller-supported food enables automatic scout sprinting',async()=>{
 for(const [name,count,expected] of [['bread',1,true],['apple',1,true],['bread',0,false],['rotten_flesh',2,false],['melon_slice',2,false],['sweet_berries',2,false]]){
  const bot=fakeBot();bot.addItem(name,count);let sprint;
  bot.pathfinder.setMovements=m=>{sprint=m.allowSprinting};
  await createActions(bot).execute('explore',{direction:'east',distance:8,returnable:true},undefined,{starterScope:'job/rations'});
  assert.equal(sprint,expected,name);
 }
});
test('cached movement policy restores direct actions and recomputes food on every scout',async()=>{
 const bot=fakeBot();let sprint;bot.pathfinder.setMovements=m=>{sprint=m.allowSprinting};
 const actions=createActions(bot),scout=()=>actions.execute('explore',{direction:'east',distance:8,returnable:true},undefined,{starterScope:'job/rations'});
 await scout();assert.equal(sprint,false);
 await actions.execute('go_to',{x:0,y:64,z:0,radius:1});assert.equal(sprint,true);
 await actions.execute('explore',{direction:'east',distance:8,returnable:true});assert.equal(sprint,true);
 const bread=bot.addItem('bread');await scout();assert.equal(sprint,true);bread.count=0;await scout();assert.equal(sprint,false);
 await actions.execute('go_to',{x:0,y:64,z:0,radius:1},undefined,{starterScope:'job/return'});assert.equal(sprint,true);
});
test('failed foodless scouting cannot leak sprint suppression into a later direct action',async()=>{
 const bot=fakeBot();let sprint;bot.pathfinder.setMovements=m=>{sprint=m.allowSprinting};
 const original=bot.pathfinder.getPathFromTo;bot.pathfinder.getPathFromTo=function*(){yield{result:{status:'noPath',path:[]}}};
 const actions=createActions(bot);
 await assert.rejects(actions.execute('explore',{direction:'east',distance:8,returnable:true,alternatives:['north','west']},undefined,{starterScope:'job/blocked'}));assert.equal(sprint,false);
 bot.pathfinder.getPathFromTo=original;await actions.execute('go_to',{x:1,y:64,z:0,radius:1});assert.equal(sprint,true);
});

test('starter collection skips a proven sealed goal pocket before global path search',async t=>{
 // Test the integration decision deterministically. Slow CI must not turn this
 // into a timing race with the production20ms unknown/fallback policy.
 t.mock.method(performance,'now',()=>1000)
 const {default:loadBlock}=await import('prismarine-block'),{default:WorldSync}=await import('prismarine-world/src/worldsync.js');
 const Block=loadBlock(registry),target=new Vec3(8,64,0),cells=new Map();
 for(let x=-2;x<=14;x++)for(let y=56;y<=71;y++)for(let z=-6;z<=6;z++){
  const p=new Vec3(x,y,z),air=p.equals(target.offset(0,1,0))||(x===0&&z===0&&(y===64||y===65));
  const b=Block.fromStateId(registry.blocksByName[air?'air':'stone'].defaultState,0);b.position=p;cells.set(p.toString(),b);
 }
 for(const starter of [false,true]){
  const bot=fakeBot();let probes=0;bot.blockAt=p=>cells.get(p.floored().toString())??null;
  bot.world={getBlock:bot.blockAt,raycast:WorldSync.prototype.raycast};
  bot.findBlocks=options=>{const b=bot.blockAt(target);if(options.useExtraInfo)options.useExtraInfo(b);return[target]};
  bot.pathfinder.getPathFromTo=function*(){probes++;yield{result:{status:'noPath',path:[]}}};
  const actions=createActions(bot,{movementBoundary:()=>({center:new Vec3(.5,64,.5),radius:256})});
  await assert.rejects(actions.execute('collect',{block:'stone',count:1,radius:12},undefined,starter?{starterScope:'fixture/stance'}:{}));
  assert.equal(probes,starter?0:1);
 }
});

test('placement refuses every replacement play session after aiming',async()=>{
 for(const mode of ['dimension','entity','client','respawn','spawn','end','round-trip']){
  const bot=fakeBot();bot.addItem('oak_planks');bot.putBlock('dirt',new Vec3(2,63,0));let packets=0;
  const counts=Object.fromEntries(['respawn','spawn','end'].map(e=>[e,bot.listenerCount(e)]));
  bot._placeBlockWithOptions=async()=>{packets++};
  bot.lookAt=async()=>{
   if(mode==='dimension')bot.game.dimension='the_nether';
   else if(mode==='entity')bot.entity={...bot.entity};
   else if(mode==='client')bot._client=new EventEmitter();
   else if(mode==='round-trip'){bot.game.dimension='the_nether';bot.emit('respawn');bot.game.dimension='overworld'}
   else bot.emit(mode);
  };
  await assert.rejects(createActions(bot).execute('place',{block:'oak_planks',x:2,y:64,z:0}),/play session changed/);
  assert.equal(packets,0);
  for(const event of Object.keys(counts))assert.equal(bot.listenerCount(event),counts[event]);
 }
});
test('navigation cannot report arrival in a replacement dimension',async()=>{
 const bot=fakeBot();bot.pathfinder.goto=async goal=>{bot.game.dimension='the_nether';bot.entity.position=new Vec3(goal.x+.5,goal.y,goal.z+.5)};
 await assert.rejects(createActions(bot).execute('go_to',{x:3,y:64,z:0,radius:1}),/play session changed/);
});
test('session invalidation stops immediately but holds the physical lock until draining',async()=>{
 const bot=fakeBot();let release,clears=0;bot.clearControlStates=()=>{clears++};
 bot.pathfinder.goto=()=>new Promise(resolve=>{release=resolve});
 const actions=createActions(bot),pending=actions.execute('go_to',{x:3,y:64,z:0,radius:1});
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 bot.emit('respawn');assert.ok(clears>0);
 await assert.rejects(actions.execute('go_to',{x:3,y:64,z:0,radius:1}),/physical action is running/);
 release();await assert.rejects(pending,/play session changed/);
 bot.pathfinder.goto=async goal=>{bot.entity.position=new Vec3(goal.x+.5,goal.y,goal.z+.5)};
 assert.equal((await actions.execute('go_to',{x:3,y:64,z:0,radius:1})).arrived,true);
 for(const event of ['respawn','spawn','end'])assert.equal(bot.listenerCount(event),0);
});
test('intentional portal entry survives child session cancellation while owner Stop wins',async()=>{
 for(const stop of [false,true]){
  const bot=fakeBot(),owner=new AbortController();bot.putBlock('nether_portal',new Vec3(2,64,0));
  bot.pathfinder.goto=async()=>{bot.game.dimension='the_nether';bot.emit('respawn');bot.emit('spawn');if(stop)owner.abort(new Error('Owner stopped entry'))};
  const progression=createProgression(bot,{actions:createActions(bot)});
  const pending=progression.execute('enter_portal',{kind:'nether',radius:8,timeout:10},owner.signal);
  if(stop)await assert.rejects(pending,/Owner stopped entry/);
  else {const result=await pending;assert.equal(result.transitioned,true);assert.equal(result.from,'overworld');assert.equal(result.to,'nether');assert.equal(owner.signal.aborted,false)}
  for(const event of ['respawn','spawn','end'])assert.equal(bot.listenerCount(event),0);
 }
});
test('late runner cleanup cannot close replacement-session inventory or release its item',async()=>{
 const bot=fakeBot();let closed=0,released=0,slots=0;
 bot.closeWindow=async()=>{closed++};bot.deactivateItem=()=>{released++};bot.setQuickBarSlot=()=>{slots++};
 bot.pathfinder.goto=async()=>{bot.game.dimension='the_nether';bot.currentWindow={id:99};bot.heldItem={name:'bow'};bot.usingHeldItem=true;bot.emit('respawn');bot.emit('spawn')};
 const actions=createActions(bot),runner=new ActionRunner();
 await assert.rejects(runner.run('go_to',signal=>actions.execute('go_to',{x:3,y:64,z:0,radius:1},signal),()=>actions.stop()),/play session changed/);
 actions.stop();assert.equal(closed,0);assert.equal(released,0);assert.equal(slots,0);assert.equal(runner.active,null);
});
test('multi-step portal construction cannot retry its old site after a world replacement',async()=>{
 const bot=fakeBot(),blueprint=portalBlueprint(0,64,0,'x'),missing=blueprint.frame.find(p=>p.y===68);
 for(let x=-3;x<8;x++)for(let z=-3;z<4;z++)bot.putBlock('stone',new Vec3(x,63,z));
 for(const p of blueprint.frame)if(p!==missing)bot.putBlock('obsidian',new Vec3(p.x,p.y,p.z));
 bot.addItem('obsidian');bot.addItem('flint_and_steel');let walks=0,edits=0;
 bot.pathfinder.goto=async goal=>{walks++;bot.entity.position=new Vec3(goal.x+.5,goal.y??64,goal.z+.5);if(walks===1){bot.game.dimension='the_nether';bot.emit('respawn');bot.emit('spawn')}};
 bot._placeBlockWithOptions=async()=>{edits++};bot.activateBlock=async()=>{edits++};
 const parent=new AbortController(),progression=createProgression(bot,{actions:createActions(bot)});
 await assert.rejects(progression.execute('build_nether_portal',{x:0,y:64,z:0,axis:'x'},parent.signal),/play session changed/);
 assert.equal(walks,1);assert.equal(edits,0);assert.equal(parent.signal.aborted,false);
 for(const event of ['respawn','spawn','end'])assert.equal(bot.listenerCount(event),0);
});
test('progression propagates same-dimension retirement between children and before child listeners',async()=>{
 for(const stage of ['equipping','drawing']){
  const bot=fakeBot();bot.addItem('bow');bot.addItem('arrow');bot.entities[2]={id:2,name:'zombie',type:'hostile',position:new Vec3(10,64,0),height:1.8};
  let closed=0,released=0,slots=0,transitioned=false;const equip=bot.equip;
  const replace=()=>{transitioned=true;bot.currentWindow={id:99};bot.usingHeldItem=true;bot.emit('respawn');bot.emit('spawn')};
  bot.closeWindow=async()=>{if(transitioned)closed++};bot.deactivateItem=()=>{if(transitioned)released++};bot.setQuickBarSlot=()=>{if(transitioned)slots++};
  bot.equip=async item=>{await equip(item);if(stage==='equipping')replace()};bot.activateItem=()=>{if(stage==='drawing')replace()};
  const actions=createActions(bot),progression=createProgression(bot,{actions}),runner=new ActionRunner();
  await assert.rejects(runner.run('shoot',signal=>progression.execute('shoot',{entity_id:2,shots:1},signal),()=>actions.stop()),/session changed/);
  actions.stop();assert.equal(closed,0,stage);assert.equal(released,0,stage);assert.equal(slots,0,stage);
  for(const event of ['respawn','spawn','end','entityDead'])assert.equal(bot.listenerCount(event),0);
 }
});
test('item-use cleanup does not release a replacement session item',async()=>{
 const bot=fakeBot();bot.heldItem=bot.addItem('bow');let releases=0;
 bot.deactivateItem=()=>{releases++};bot.activateItem=()=>{bot.game.dimension='the_nether';bot.emit('respawn');bot.emit('spawn')};
 const actions=createActions(bot);
 await assert.rejects(actions.execute('use_item',{duration:1}),/session changed/);actions.stop();assert.equal(releases,0);
});
for(const kind of ['craft','smelt'])test(`${kind} does not close a window acquired in a replacement session`,async()=>{
 const bot=fakeBot();let closed=0,clicks=0;
 const window={id:99,slots:Array(46).fill(null),inventoryStart:10,inventoryEnd:46,selectedItem:null,close:async()=>{closed++}};
 const open=async()=>{bot.currentWindow=window;bot.emit('respawn');bot.emit('spawn');return window};
 bot.closeWindow=async()=>{closed++};bot.clickWindow=async()=>{clicks++};bot._syncWindow=async()=>{};
 let args;
 if(kind==='craft'){
  bot.putBlock('crafting_table',new Vec3(2,64,0));bot.addItem('oak_planks',3);bot.addItem('stick',2);
  bot.recipesFor=()=>[{requiresTable:true,result:{id:registry.itemsByName.wooden_pickaxe.id,count:1}}];bot.openBlock=open;args={item:'wooden_pickaxe',count:1};
 }else{bot.putBlock('furnace',new Vec3(2,64,0));bot.addItem('sand');bot.addItem('coal');bot.openFurnace=open;args={item:'sand',count:1,fuel:'coal'}}
 const actions=createActions(bot);await assert.rejects(actions.execute(kind,args),/session changed/);actions.stop();
 assert.equal(closed,0);assert.equal(clicks,0);
});

test('starter returnable scouts accept a nearby certified landing while direct scouts stay exact',async()=>{
 for(const starter of [false,true]){
  const bot=fakeBot();let moves=0;
  bot.pathfinder.getPathFromTo=function*(m,start,goal){
    const endpoint=goal.y===undefined?new Vec3(7,64,0):new Vec3(0,64,0);
    yield{result:{status:goal.isEnd(endpoint)?'success':'noPath',path:[endpoint]}};
  };
  bot.pathfinder.goto=async goal=>{moves++;bot.entity.position=new Vec3(goal.x+.5,goal.y,goal.z+.5)};
  const actions=createActions(bot,{movementBoundary:()=>({center:new Vec3(.5,64,.5),radius:256})});
  const pending=actions.execute('explore',{direction:'east',distance:8,returnable:true},undefined,starter?{starterScope:'job/landing'}:{});
  if(starter){const result=await pending;assert.equal(result.explored,true);assert.equal(result.distance,7);assert.equal(moves,1)}
  else{await assert.rejects(pending,/No verified returnable/);assert.equal(moves,0)}
 }
})
test('starter scout goal rejects outside nodes and outside standing centers',async()=>{
 const {StarterScoutGoal}=await import('../src/actions.js'),home=new Vec3(.5,64,.5);
 const allowed=p=>p.distanceTo(home)<=10&&p.offset(.5,0,.5).distanceTo(home)<=10;
 const goal=new StarterScoutGoal(new Vec3(10,64,0),allowed);
 assert.equal(goal.isEnd(new Vec3(11,64,0)),false);
 assert.equal(goal.isEnd(new Vec3(10,64,1)),false);
 assert.equal(goal.isEnd(new Vec3(9,64,0)),true);
})
test('starter scouts reject an out-of-bound node in either certified path without moving',async()=>{
 for(const badDirection of ['forward','reverse']){
  const bot=fakeBot();let moved=false;
  bot.pathfinder.getPathFromTo=function*(m,start,goal){
    const forward=goal.y===undefined,endpoint=forward?new Vec3(9,64,0):new Vec3(0,64,0);
    yield{result:{status:'success',path:[...(forward===(badDirection==='forward')?[new Vec3(11,63,0)]:[]),endpoint]}};
  };
  bot.pathfinder.goto=async()=>{moved=true};
  await assert.rejects(createActions(bot,{movementBoundary:()=>({center:new Vec3(.5,64,.5),radius:10})}).execute('explore',{direction:'east',distance:10,returnable:true},undefined,{starterScope:'job/boundary'}),/unsafe node/);
  assert.equal(moved,false);
 }
})
test('starter scout cannot report success outside its actual movement boundary',async()=>{
 const bot=fakeBot();bot.entity.position=new Vec3(248.5,64,.5);
 bot.pathfinder.getPathFromTo=function*(m,start,goal){yield{result:{status:'success',path:[goal.y===undefined?new Vec3(255,64,0):new Vec3(248,64,0)]}}};
 bot.pathfinder.goto=async()=>{bot.entity.position=new Vec3(257.5,64,.5)};
 await assert.rejects(createActions(bot,{movementBoundary:()=>({center:new Vec3(.5,64,.5),radius:256})}).execute('explore',{direction:'east',distance:8,returnable:true},undefined,{starterScope:'job/boundary'}),/ended outside/);
})

test('mining uses the earliest internal deadline and rechecks the final tool estimate after aiming',async()=>{
 for(const mode of ['job','action','aim-cost']){
  const bot=fakeBot(),p=new Vec3(2,64,0);bot.putBlock('oak_log',p);let digs=0,aimed=false;bot.dig=async()=>{digs++};
  bot.lookAt=async()=>{aimed=true;if(mode==='aim-cost')bot.digTime=()=>10000};
  const soon=performance.now()+1000,later=performance.now()+30000;
  const context=mode==='job'?{jobDeadline:soon,actionDeadline:later}:mode==='action'?{jobDeadline:later,actionDeadline:soon}:{jobDeadline:performance.now()+6500};
  await assert.rejects(createActions(bot).execute('dig_at',{x:2,y:64,z:0},undefined,context),{code:'MINING_DEADLINE_INSUFFICIENT'});
  assert.equal(aimed,true);assert.equal(digs,0);
 }
})

test('collection propagates mining admission refusal with earlier confirmed progress',async()=>{
 const bot=fakeBot();bot.putBlock('oak_log',new Vec3(2,64,0));bot.putBlock('oak_log',new Vec3(3,64,0));let digs=0;
 bot.dig=async block=>{digs++;bot.removeBlock(block.position);bot.addItem('oak_log');bot.digTime=()=>10000};
 await assert.rejects(createActions(bot).execute('collect',{block:'oak_log',count:2,radius:8},undefined,{jobDeadline:performance.now()+6500}),error=>{
  assert.equal(error.code,'MINING_DEADLINE_INSUFFICIENT');assert.equal(error.result.mined,1);assert.equal(error.result.inventory_changes.oak_log,1);return true;
 });
 assert.equal(digs,1);
})

test('explicit wake emits the correct pinned protocol meaning and waits for acknowledgement',async()=>{
  const {default:protocol}=await import('minecraft-protocol');
  const serializer=protocol.createSerializer({state:'play',isServer:false,version:'1.21.8'}),deserializer=protocol.createDeserializer({state:'play',isServer:true,version:'1.21.8'});
  const bot=fakeBot();bot.isSleeping=true;let sent=0;
  bot._client.write=(name,params)=>{assert.equal(deserializer.parsePacketBuffer(serializer.createPacketBuffer({name,params})).data.params.actionId,'stop_sleeping');sent++;bot.isSleeping=false;bot.emit('wake')};
  assert.deepEqual(await createActions(bot).execute('wake',{}),{awake:true});assert.equal(sent,1);
  for(const e of ['wake','respawn','spawn','end'])assert.equal(bot.listenerCount(e),0);
})
test('wake refuses awake, unsupported and cancelled contexts without sending',async()=>{
  for(const mode of ['awake','version','cancel']){
    const bot=fakeBot();bot.isSleeping=mode!=='awake';if(mode==='version')bot.version='1.20.1';let sent=0;bot._client.write=()=>{sent++};
    await assert.rejects(createActions(bot).execute('wake',{},mode==='cancel'?AbortSignal.abort():undefined));assert.equal(sent,0);
  }
})
test('wake rejects a session change after its acknowledgement',async()=>{
  const bot=fakeBot();bot.isSleeping=true;bot._client.write=()=>{bot.isSleeping=false;bot.emit('wake');bot.emit('respawn')};
  await assert.rejects(createActions(bot).execute('wake',{}),/session changed/);
})
test('wake retains the action lock while waiting for its server acknowledgement',async()=>{
  const bot=fakeBot();bot.isSleeping=true;let sent=0;bot._client.write=()=>{sent++};
  const actions=createActions(bot),pending=actions.execute('wake',{});
  assert.equal(sent,1);await assert.rejects(actions.execute('inspect',{}),/Another physical action/);
  bot.isSleeping=false;bot.emit('wake');assert.deepEqual(await pending,{awake:true});
  assert.equal((await actions.execute('inspect',{})).sleeping,false);

})

test('pickup avoids duplicate failed destination probes while other drops still get a turn', async () => {
  const bot = fakeBot()
  for (const x of [0,1,2,5]) bot.putBlock('stone',new Vec3(x,63,0))
  bot.entities[2]={id:2,name:'item',position:new Vec3(2.5,64,.5)}
  bot.entities[3]={id:3,name:'item',position:new Vec3(5.5,64,.5)}
  const probes=[]
  bot.pathfinder.getPathFromTo=function * (movement,start) { probes.push(start.toArray());yield {result:{status:'noPath',path:[]}} }
  let moves=0;bot.pathfinder.setGoal=goal=>{if(goal)moves++}
  await createActions(bot).execute('pickup',{radius:8})
  assert.deepEqual(probes,[[2,64,0],[5,64,0],[1,64,0]])
  assert.equal(moves,0)
})

test('pickup may retry a failed cell after terrain changes during planning and removes its observers', async () => {
  const bot=fakeBot()
  bot.putBlock('stone',new Vec3(0,63,0));bot.putBlock('stone',new Vec3(2,63,0))
  bot.entities[2]={id:2,name:'item',position:new Vec3(2.5,64,.5)}
  let probes=0
  bot.pathfinder.getPathFromTo=function * () {
    probes++
    try{yield {result:{status:'noPath',path:[]}}}finally{if(probes===1)bot.emit('blockUpdate')}
  }
  await createActions(bot).execute('pickup',{radius:8})
  assert.equal(probes,2)
  for(const event of ['blockUpdate','chunkColumnLoad','chunkColumnUnload','entitySpawn','entityGone','entityMoved','entityUpdate'])assert.equal(bot.listenerCount(event),0,event)
})

function leafPickupFixture () {
  const bot = fakeBot()
  bot.putBlock('stone', new Vec3(0, 63, 0))
  bot.putBlock('oak_leaves', new Vec3(2, 63, 0))
  bot.entities[2] = { id: 2, name: 'item', position: new Vec3(2.5, 64, .5) }
  let moves = 0
  bot.pathfinder.goto = async goal => {
    moves++
    bot.entity.position = new Vec3(goal.x + .5, goal.y, goal.z + .5)
    delete bot.entities[2]
    bot.addItem('oak_log')
  }
  return { bot, moves: () => moves }
}

test('starter pickup refuses detached leaf destinations while direct pickup is unchanged', async () => {
  for (const starter of [true, false]) {
    const { bot, moves } = leafPickupFixture()
    const result = await createActions(bot).execute('pickup', { radius: 8 }, undefined, starter ? { starterScope: 'job/leaf' } : {})
    assert.equal(moves(), starter ? 0 : 1)
    assert.equal(result.inventory_changes.oak_log ?? 0, starter ? 0 : 1)
  }
})

test('starter pickup accepts a retained leaf anchor', async () => {
  const { bot, moves } = leafPickupFixture()
  bot.putBlock('oak_log', new Vec3(2, 62, 0))
  const result = await createActions(bot).execute('pickup', { radius: 8 }, undefined, { starterScope: 'job/leaf' })
  assert.equal(moves(), 1)
  assert.equal(result.landing_verified, true)
  assert.equal(result.inventory_changes.oak_log, 1)
})

test('starter pickup rechecks leaf anchors after planning before moving', async () => {
  const { bot, moves } = leafPickupFixture()
  bot.putBlock('oak_log', new Vec3(2, 62, 0))
  const original = bot.pathfinder.getPathFromTo
  bot.pathfinder.getPathFromTo = function * (...args) {
    try { yield * original(...args) }
    finally { bot.removeBlock(new Vec3(2, 62, 0)) }
  }
  const result = await createActions(bot).execute('pickup', { radius: 8 }, undefined, { starterScope: 'job/leaf' })
  assert.equal(moves(), 0)
  assert.equal(result.inventory_changes.oak_log ?? 0, 0)
})

test('starter pickup cannot certify a leaf landing whose anchor disappears after arrival', async () => {
  const { bot } = leafPickupFixture()
  bot.putBlock('oak_log', new Vec3(2, 62, 0))
  const original = bot.pathfinder.goto
  bot.pathfinder.goto = async goal => {
    await original(goal)
    bot.entity.position.y += .01
    setTimeout(() => bot.removeBlock(new Vec3(2, 62, 0)), 30)
  }
  await assert.rejects(createActions(bot).execute('pickup', { radius: 8 }, undefined, { starterScope: 'job/leaf' }), { code: 'PICKUP_UNSAFE_SETTLEMENT' })
})

test('starter pickup failure on a detached leaf cannot become a safe exception settlement', async () => {
  const { bot } = leafPickupFixture()
  bot.putBlock('oak_log', new Vec3(2, 62, 0))
  bot.pathfinder.goto = async goal => {
    bot.entity.position = new Vec3(goal.x + .5, goal.y, goal.z + .5)
    bot.removeBlock(new Vec3(2, 62, 0))
    throw Error('route failed')
  }
  await assert.rejects(createActions(bot).execute('pickup', { radius: 8 }, undefined, { starterScope: 'job/leaf' }), { code: 'PICKUP_UNSAFE_SETTLEMENT' })
})

function fakeBot () {
  const bot = new EventEmitter()
  const blocks = new Map()
  const stacks = []
  bot.version = '1.21.8'
  bot._client = new EventEmitter()
  bot.digTime = () => 0
  bot.registry = registry
  bot.entity = { id: 1, position: new Vec3(0.5, 64, 0.5), yaw: 0, pitch: 0, height: 1.62, onGround: true, effects: {} }
  bot.health = 20
  bot.food = 10
  bot.game = { minY: -64, height: 384, dimension: 'overworld' }
  bot.entities = { 1: bot.entity }
  bot.players = {}
  bot.inventory = { items: () => stacks.filter(i => i.count > 0), slots: [] }
  bot.clearControlStates = () => {}
  bot.setControlState = () => {}
  bot.stopDigging = () => {}
  bot.deactivateItem = () => {}
  bot.blockAt = p => blocks.get(p.floored().toString()) ?? { name: 'air', type: registry.blocksByName.air.id, position: p.floored(), boundingBox: 'empty', stateId: 0 }
  bot.canSeeBlock = () => true
  bot.pathfinder = { setMovements: () => {}, setGoal: () => {}, goto: async goal => { bot.entity.position = new Vec3(goal.x + 0.5, goal.y ?? 64, goal.z + 0.5) }, bestHarvestTool: () => null }
  bot.pathfinder.goal = null
  bot.pathfinder.setGoal = goal => {
    bot.pathfinder.goal = goal; bot.emit('goal_updated', goal)
    if (goal) Promise.resolve(bot.pathfinder.goto(goal)).then(() => { if (bot.pathfinder.goal === goal) bot.emit('goal_reached', goal) }, () => bot.emit('path_update', { status: 'noPath' }))
  }
  bot.pathfinder.getPathFromTo = function * (movement, start, goal) { yield { result: { status: 'success', path: [{ x: goal.x, y: goal.y ?? start.y, z: goal.z }] } } }
  bot.findBlock = ({ matching }) => [...blocks.values()].find(b => typeof matching === 'function' ? matching(b) : Array.isArray(matching) ? matching.includes(b.type) : b.type === matching) ?? null
  bot.findBlocks = options => [...blocks.values()].filter(b => Array.isArray(options.matching) ? options.matching.includes(b.type) : b.type === options.matching)
    .filter(b => typeof options.useExtraInfo !== 'function' || options.useExtraInfo(b))
    .map(b => b.position).sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position)).slice(0, options.count ?? 1)
  bot.equip = async item => { bot.heldItem = item }
  bot.look = async () => {}
  bot.lookAt = async () => {}
  bot.placeBlock = async (reference, face) => { putBlock(bot.heldItem.name, reference.position.plus(face)); bot.heldItem.count-- }
  bot._placeBlockWithOptions = (...args) => bot.placeBlock(...args)
  bot.canDigBlock = () => true
  bot.recipesFor = () => []
  bot.recipesAll = () => []
  bot.addItem = (name, count = 1) => { const item = { name, count, type: registry.itemsByName[name].id, metadata: 0 }; stacks.push(item); return item }
  function putBlock (name, p, extra = {}) { const b = { name, type: registry.blocksByName[name].id, position: p, boundingBox: name === 'air' ? 'empty' : 'block', stateId: registry.blocksByName[name].defaultState, diggable: true, canHarvest: () => true, ...extra }; blocks.set(p.toString(), b); return b }
  bot.putBlock = putBlock
  bot.removeBlock = p => { bot._client.emit('packet', { location: p, type: 0 }, { name: 'block_change' }); blocks.delete(p.toString()) }
  return bot
}

test('Responses definitions have strict, complete object schemas', () => {
  for (const definition of definitions) {
    assert.equal(definition.type, 'function')
    assert.equal(definition.strict, true)
    assert.equal(definition.parameters.additionalProperties, false)
    assert.deepEqual(definition.parameters.required, Object.keys(definition.parameters.properties))
  }
})

test('navigation rejects excessive distance and out-of-world coordinates before movement', async () => {
  const bot = fakeBot()
  let moved = false
  bot.pathfinder.goto = async () => { moved = true }
  const actions = createActions(bot)
  await assert.rejects(actions.execute('go_to', { x: 200, y: 64, z: 0, radius: 1 }), /128 blocks/)
  await assert.rejects(actions.execute('go_to', { x: 0, y: -65, z: 0, radius: 1 }), /build range/)
  assert.equal(moved, false)
})

test('navigation disables terrain modification and verifies actual arrival', async () => {
  const bot = fakeBot()
  let movement
  bot.pathfinder.setMovements = value => { movement = value }
  bot.pathfinder.goto = async () => {}
  await assert.rejects(createActions(bot).execute('go_to', { x: 30, y: 64, z: 0, radius: 1 }), /before reaching/)
  assert.equal(movement.canDig, false)
  assert.equal(movement.allow1by1towers, false)
  assert.deepEqual(movement.scafoldingBlocks, [])
})

test('abort drains an in-flight equipment operation and prevents later item use', async () => {
  const bot = fakeBot()
  bot.addItem('bow')
  const controller = new AbortController()
  let resolveEquip
  bot.equip = () => new Promise(resolve => { resolveEquip = resolve })
  let activated = 0
  bot.activateItem = () => { activated++ }
  const actions = createActions(bot)
  const pending = actions.execute('use_item', { item: 'bow', yaw: 0, pitch: 0, duration: 0 }, controller.signal)
  controller.abort()
  await assert.rejects(actions.execute('inspect', { radius: 1 }), /running or draining/)
  resolveEquip()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(activated, 0)
  assert.equal((await actions.execute('inspect', { radius: 1 })).connected, true)
})

test('already aborted actions never mutate equipment', async () => {
  const bot = fakeBot()
  bot.addItem('bow')
  let equipped = false
  bot.equip = async () => { equipped = true }
  await assert.rejects(createActions(bot).execute('equip', { item: 'bow' }, AbortSignal.abort()), { name: 'AbortError' })
  assert.equal(equipped, false)
})

test('build validates every occupied location before placing any block', async () => {
  const bot = fakeBot()
  bot.addItem('oak_planks', 10)
  bot.putBlock('chest', new Vec3(3, 64, 0))
  let placed = 0
  bot.placeBlock = async () => { placed++ }
  await assert.rejects(createActions(bot).execute('build', { block: 'oak_planks', shape: 'floor', x: 2, y: 64, z: 0, width: 2, height: 1, depth: 1, hollow: null }), /intersects chest/)
  assert.equal(placed, 0)
})

test('build does not conjure materials and verifies server placement', async () => {
  const bot = fakeBot()
  bot.putBlock('stone', new Vec3(2, 63, 0))
  bot.putBlock('stone', new Vec3(3, 63, 0))
  const actions = createActions(bot)
  const args = { block: 'oak_planks', shape: 'floor', x: 2, y: 64, z: 0, width: 2, height: 1, depth: 1, hollow: null }
  await assert.rejects(actions.execute('build', args), /needs 2 oak_planks/)
  bot.addItem('oak_planks', 2)
  const result = await actions.execute('build', args)
  assert.equal(result.completed, true)
  assert.equal(result.verified, 2)
  assert.equal(result.placed, 2)
  assert.equal(bot.inventory.items().length, 0)
})

test('unsupported floating build reports incomplete without pretending success', async () => {
  const bot = fakeBot()
  bot.addItem('oak_planks', 2)
  const result = await createActions(bot).execute('build', { block: 'oak_planks', shape: 'floor', x: 2, y: 64, z: 0, width: 2, height: 1, depth: 1 })
  assert.equal(result.completed, false)
  assert.equal(result.placed, 0)
  assert.match(result.failures[0].error, /no solid support/)
})

test('placing a torch accepts its server-selected wall variant', async () => {
  const bot = fakeBot()
  bot.addItem('torch')
  bot.putBlock('stone', new Vec3(2, 64, 0))
  bot.placeBlock = async (reference, face) => { bot.putBlock('wall_torch', reference.position.plus(face)); bot.heldItem.count-- }
  const result = await createActions(bot).execute('place', { block: 'torch', x: 2, y: 64, z: 1 })
  assert.equal(result.placed, true)
  assert.equal(result.block, 'wall_torch')
})

test('craft interprets count as output units, not recipe repetitions', async () => {
  const bot = fakeBot()
  const log = bot.addItem('oak_log', 1)
  bot.recipesFor = id => id === registry.itemsByName.oak_planks.id && log.count ? [{ result: { count: 4 }, requiresTable: false }] : []
  let calls = 0
  bot.craft = async (recipe, count) => { assert.equal(count, 1); calls++; log.count--; bot.addItem('oak_planks', 4) }
  const result = await createActions(bot).execute('craft', { item: 'oak_planks', count: 4 })
  assert.equal(calls, 1)
  assert.equal(result.crafted, 4)
})

test('craft waits for server inventory reconciliation before choosing another batch', async () => {
  const bot = fakeBot()
  const log = bot.addItem('oak_log', 2)
  let reconciled = true
  let synced = 0
  bot.recipesFor = () => reconciled && log.count ? [{ result: { count: 4 }, requiresTable: false }] : []
  bot.craft = async () => { log.count--; bot.addItem('oak_planks', 4); reconciled = false }
  bot._syncWindow = async window => { assert.equal(window, bot.inventory); reconciled = true; synced++ }
  const result = await createActions(bot).execute('craft', { item: 'oak_planks', count: 8 })
  assert.equal(result.crafted, 8)
  assert.equal(synced, 2)
})

test('craft finds an adjacent table across a diagonal chunk boundary', async () => {
  const bot = fakeBot()
  const position = new Vec3(-1, 64, -1)
  bot.putBlock('crafting_table', position)
  bot.findBlocks = () => [] // Simulate Mineflayer's small-radius section-search miss.
  bot.findBlock = () => null
  bot.recipesFor = (type, metadata, count, table) => table ? [{ result: { count: 1 }, requiresTable: true }] : []
  bot.craft = async (recipe, count, table) => { assert.ok(table.position.equals(position)); bot.addItem('wooden_pickaxe') }
  const result = await createActions(bot).execute('craft', { item: 'wooden_pickaxe', count: 1 })
  assert.equal(result.crafted, 1)
})

test('real crafting path synchronizes every cursor/grid/output click and preserves leftover ingredients', async () => {
  const bot = fakeBot()
  const logType = registry.itemsByName.oak_log.id
  const plankType = registry.itemsByName.oak_planks.id
  const stack = (name, count) => ({ name, type: registry.itemsByName[name].id, metadata: 0, count, stackSize: 64 })
  const server = { slots: Array(46).fill(null), cursor: null }
  server.slots[36] = stack('oak_log', 2)
  const inventory = { slots: Array(46).fill(null), selectedItem: null, inventoryStart: 9, inventoryEnd: 45, items () { return this.slots.slice(9, 45).filter(Boolean) } }
  bot.inventory = inventory
  const pending = []
  const recipe = { result: { id: plankType, count: 4 }, requiresTable: false, inShape: null, ingredients: [{ id: logType, metadata: null, count: -1 }] }
  bot.recipesFor = () => inventory.items().some(item => item.type === logType) ? [recipe] : []
  bot.craft = async () => { throw new Error('Native optimistic craft must not run') }
  bot.clickWindow = async (slot, button) => { assert.equal(pending.length, 0, 'Every click must be reconciled before the next'); pending.push({ slot, button }) }
  bot._syncWindow = async () => {
    for (const { slot, button } of pending.splice(0)) {
      if (slot === 0) { assert.equal(server.cursor, null); server.cursor = server.slots[0]; server.slots[1] = null }
      else if (button === 1) { assert.equal(server.slots[slot], null); server.slots[slot] = { ...server.cursor, count: 1 }; server.cursor.count--; if (!server.cursor.count) server.cursor = null }
      else if (!server.cursor) { server.cursor = server.slots[slot]; server.slots[slot] = null }
      else if (!server.slots[slot]) { server.slots[slot] = server.cursor; server.cursor = null }
      else { assert.equal(server.slots[slot].type, server.cursor.type); server.slots[slot].count += server.cursor.count; server.cursor = null }
      server.slots[0] = server.slots[1]?.type === logType ? stack('oak_planks', 4) : null
    }
    inventory.slots = server.slots.map(item => item && { ...item })
    inventory.selectedItem = server.cursor && { ...server.cursor }
  }
  await bot._syncWindow()
  const result = await createActions(bot).execute('craft', { item: 'oak_planks', count: 8 })
  assert.equal(result.crafted, 8)
  assert.deepEqual(inventory.items().map(item => [item.name, item.count]), [['oak_planks', 8]])
  assert.equal(server.cursor, null)
  assert.equal(server.slots[1], null)
})

test('craft does not count named cursor output as new production', async () => {
  const bot = fakeBot()
  const logType = registry.itemsByName.oak_log.id
  const plankType = registry.itemsByName.oak_planks.id
  const stack = (name, count) => ({ name, type: registry.itemsByName[name].id, metadata: 0, count, stackSize: 64 })
  const server = { slots: Array(46).fill(null), cursor: null }
  server.slots[36] = stack('oak_log', 2)
  server.cursor = {...stack('oak_planks', 4),components:[{type:'custom_name',data:{type:'string',value:'Reserved'}}]}
  const inventory = { slots: Array(46).fill(null), selectedItem: null, inventoryStart: 9, inventoryEnd: 45, items () { return this.slots.slice(9, 45).filter(Boolean) } }
  bot.inventory = inventory
  const pending = []
  const recipe = { result: { id: plankType, count: 4 }, requiresTable: false, inShape: null, ingredients: [{ id: logType, metadata: null, count: -1 }] }
  bot.recipesFor = () => inventory.items().some(item => item.type === logType) ? [recipe] : []
  bot.craft = async () => { throw new Error('Native optimistic craft must not run') }
  bot.clickWindow = async (slot, button) => { assert.equal(pending.length, 0, 'Every click must be reconciled before the next'); pending.push({ slot, button }) }
  bot._syncWindow = async () => {
    for (const { slot, button } of pending.splice(0)) {
      if (slot === 0) { assert.equal(server.cursor, null); server.cursor = server.slots[0]; server.slots[1] = null }
      else if (button === 1) { assert.equal(server.slots[slot], null); server.slots[slot] = { ...server.cursor, count: 1 }; server.cursor.count--; if (!server.cursor.count) server.cursor = null }
      else if (!server.cursor) { server.cursor = server.slots[slot]; server.slots[slot] = null }
      else if (!server.slots[slot]) { server.slots[slot] = server.cursor; server.cursor = null }
      else { assert.equal(server.slots[slot].type, server.cursor.type); assert.deepEqual(server.slots[slot].components ?? [],server.cursor.components ?? []); server.slots[slot].count += server.cursor.count; server.cursor = null }
      server.slots[0] = server.slots[1]?.type === logType ? stack('oak_planks', 4) : null
    }
    inventory.slots = server.slots.map(item => item && { ...item })
    inventory.selectedItem = server.cursor && { ...server.cursor }
  }
  await bot._syncWindow()
  const result = await createActions(bot).execute('craft', { item: 'oak_planks', count: 8 })
  assert.equal(result.crafted, 8)
  assert.equal(result.recipe_batches,2)
  assert.equal(inventory.items().filter(i=>i.name==='oak_planks').reduce((n,i)=>n+i.count,0),12)
  assert.equal(inventory.items().filter(i=>i.name==='oak_log').reduce((n,i)=>n+i.count,0),0)
  assert.equal(server.cursor, null)
  assert.equal(server.slots[1], null)
})

test('craft does not count existing grid output as new production', async () => {
  const bot = fakeBot()
  const logType = registry.itemsByName.oak_log.id
  const plankType = registry.itemsByName.oak_planks.id
  const stack = (name, count) => ({ name, type: registry.itemsByName[name].id, metadata: 0, count, stackSize: 64 })
  const server = { slots: Array(46).fill(null), cursor: null }
  server.slots[36] = stack('oak_log', 2)
  server.slots[2] = stack('oak_planks', 4)
  const inventory = { slots: Array(46).fill(null), selectedItem: null, inventoryStart: 9, inventoryEnd: 45, items () { return this.slots.slice(9, 45).filter(Boolean) } }
  bot.inventory = inventory
  const pending = []
  const recipe = { result: { id: plankType, count: 4 }, requiresTable: false, inShape: null, ingredients: [{ id: logType, metadata: null, count: -1 }] }
  bot.recipesFor = () => inventory.items().some(item => item.type === logType) ? [recipe] : []
  bot.craft = async () => { throw new Error('Native optimistic craft must not run') }
  bot.clickWindow = async (slot, button) => { assert.equal(pending.length, 0, 'Every click must be reconciled before the next'); pending.push({ slot, button }) }
  bot._syncWindow = async () => {
    for (const { slot, button } of pending.splice(0)) {
      if (slot === 0) { assert.equal(server.cursor, null); server.cursor = server.slots[0]; server.slots[1] = null }
      else if (button === 1) { assert.equal(server.slots[slot], null); server.slots[slot] = { ...server.cursor, count: 1 }; server.cursor.count--; if (!server.cursor.count) server.cursor = null }
      else if (!server.cursor) { server.cursor = server.slots[slot]; server.slots[slot] = null }
      else if (!server.slots[slot]) { server.slots[slot] = server.cursor; server.cursor = null }
      else { assert.equal(server.slots[slot].type, server.cursor.type); assert.deepEqual(server.slots[slot].components ?? [],server.cursor.components ?? []); server.slots[slot].count += server.cursor.count; server.cursor = null }
      server.slots[0] = server.slots[1]?.type === logType ? stack('oak_planks', 4) : null
    }
    inventory.slots = server.slots.map(item => item && { ...item })
    inventory.selectedItem = server.cursor && { ...server.cursor }
  }
  await bot._syncWindow()
  const result = await createActions(bot).execute('craft', { item: 'oak_planks', count: 8 })
  assert.equal(result.crafted, 8)
  assert.equal(result.recipe_batches,2)
  assert.equal(inventory.items().filter(i=>i.name==='oak_planks').reduce((n,i)=>n+i.count,0),12)
  assert.equal(inventory.items().filter(i=>i.name==='oak_log').reduce((n,i)=>n+i.count,0),0)
  assert.equal(server.cursor, null)
  assert.equal(server.slots[1], null)
})

test('craft does not count existing cursor output as new production', async () => {
  const bot = fakeBot()
  const logType = registry.itemsByName.oak_log.id
  const plankType = registry.itemsByName.oak_planks.id
  const stack = (name, count) => ({ name, type: registry.itemsByName[name].id, metadata: 0, count, stackSize: 64 })
  const server = { slots: Array(46).fill(null), cursor: null }
  server.slots[36] = stack('oak_log', 2)
  server.cursor = stack('oak_planks', 4)
  const inventory = { slots: Array(46).fill(null), selectedItem: null, inventoryStart: 9, inventoryEnd: 45, items () { return this.slots.slice(9, 45).filter(Boolean) } }
  bot.inventory = inventory
  const pending = []
  const recipe = { result: { id: plankType, count: 4 }, requiresTable: false, inShape: null, ingredients: [{ id: logType, metadata: null, count: -1 }] }
  bot.recipesFor = () => inventory.items().some(item => item.type === logType) ? [recipe] : []
  bot.craft = async () => { throw new Error('Native optimistic craft must not run') }
  bot.clickWindow = async (slot, button) => { assert.equal(pending.length, 0, 'Every click must be reconciled before the next'); pending.push({ slot, button }) }
  bot._syncWindow = async () => {
    for (const { slot, button } of pending.splice(0)) {
      if (slot === 0) { assert.equal(server.cursor, null); server.cursor = server.slots[0]; server.slots[1] = null }
      else if (button === 1) { assert.equal(server.slots[slot], null); server.slots[slot] = { ...server.cursor, count: 1 }; server.cursor.count--; if (!server.cursor.count) server.cursor = null }
      else if (!server.cursor) { server.cursor = server.slots[slot]; server.slots[slot] = null }
      else if (!server.slots[slot]) { server.slots[slot] = server.cursor; server.cursor = null }
      else { assert.equal(server.slots[slot].type, server.cursor.type); assert.deepEqual(server.slots[slot].components ?? [],server.cursor.components ?? []); server.slots[slot].count += server.cursor.count; server.cursor = null }
      server.slots[0] = server.slots[1]?.type === logType ? stack('oak_planks', 4) : null
    }
    inventory.slots = server.slots.map(item => item && { ...item })
    inventory.selectedItem = server.cursor && { ...server.cursor }
  }
  await bot._syncWindow()
  const result = await createActions(bot).execute('craft', { item: 'oak_planks', count: 8 })
  assert.equal(result.crafted, 8)
  assert.equal(result.recipe_batches,2)
  assert.equal(inventory.items().filter(i=>i.name==='oak_planks').reduce((n,i)=>n+i.count,0),12)
  assert.equal(inventory.items().filter(i=>i.name==='oak_log').reduce((n,i)=>n+i.count,0),0)
  assert.equal(server.cursor, null)
  assert.equal(server.slots[1], null)
})

test('cursor storage respects custom stack capacity and moves leftovers into empty slots', async () => {
  const bot = fakeBot()
  const logType = registry.itemsByName.oak_log.id
  const plankType = registry.itemsByName.oak_planks.id
  const stack = (name, count) => ({ name, type: registry.itemsByName[name].id, metadata: 0, count, stackSize: 64 })
  const server = { slots: Array(46).fill(null), cursor: null }
  server.slots[36] = stack('oak_log', 2)
  const custom = count => ({ ...stack('cobblestone', count), components:[{type:'max_stack_size',data:16}] })
  server.slots[9] = custom(15)
  server.cursor = custom(2)
  let clicksOnFull = 0
  const inventory = { slots: Array(46).fill(null), selectedItem: null, inventoryStart: 9, inventoryEnd: 45, items () { return this.slots.slice(9, 45).filter(Boolean) } }
  bot.inventory = inventory
  const pending = []
  const recipe = { result: { id: plankType, count: 4 }, requiresTable: false, inShape: null, ingredients: [{ id: logType, metadata: null, count: -1 }] }
  bot.recipesFor = () => inventory.items().some(item => item.type === logType) ? [recipe] : []
  bot.craft = async () => { throw new Error('Native optimistic craft must not run') }
  bot.clickWindow = async (slot, button) => { assert.equal(pending.length, 0, 'Every click must be reconciled before the next'); pending.push({ slot, button }) }
  bot._syncWindow = async () => {
    for (const { slot, button } of pending.splice(0)) {
      if (slot === 0) { assert.equal(server.cursor, null); server.cursor = server.slots[0]; server.slots[1] = null }
      else if (button === 1) { assert.equal(server.slots[slot], null); server.slots[slot] = { ...server.cursor, count: 1 }; server.cursor.count--; if (!server.cursor.count) server.cursor = null }
      else if (!server.cursor) { server.cursor = server.slots[slot]; server.slots[slot] = null }
      else if (!server.slots[slot]) { server.slots[slot] = server.cursor; server.cursor = null }
      else { assert.equal(server.slots[slot].type, server.cursor.type); const cap = server.slots[slot].components?.find(c=>c.type==='max_stack_size')?.data ?? 64; const moved=Math.min(server.cursor.count,cap-server.slots[slot].count); if(!moved)clicksOnFull++; server.slots[slot].count += moved; server.cursor.count -= moved; if(!server.cursor.count)server.cursor=null }
      server.slots[0] = server.slots[1]?.type === logType ? stack('oak_planks', 4) : null
    }
    inventory.slots = server.slots.map(item => item && { ...item })
    inventory.selectedItem = server.cursor && { ...server.cursor }
  }
  await bot._syncWindow()
  const result = await createActions(bot).execute('craft', { item: 'oak_planks', count: 8 })
  assert.equal(result.crafted, 8)
  assert.equal(clicksOnFull, 0)
  assert.equal(server.slots[9].count,16)
  assert.equal(server.slots[10].count,1)
  assert.equal(inventory.items().filter(i=>i.name==='oak_planks').reduce((n,i)=>n+i.count,0),8)
  assert.equal(server.cursor, null)
  assert.equal(server.slots[1], null)
})

test('cursor storage handles increased custom stack limits', async () => {
  const bot = fakeBot()
  const logType = registry.itemsByName.oak_log.id
  const plankType = registry.itemsByName.oak_planks.id
  const stack = (name, count) => ({ name, type: registry.itemsByName[name].id, metadata: 0, count, stackSize: 64 })
  const server = { slots: Array(46).fill(null), cursor: null }
  server.slots[36] = stack('oak_log', 2)
  const custom = count => ({ ...stack('cobblestone', count), components:[{type:'max_stack_size',data:99}] })
  server.slots[9] = custom(60)
  server.cursor = custom(20)
  let clicksOnFull = 0
  const inventory = { slots: Array(46).fill(null), selectedItem: null, inventoryStart: 9, inventoryEnd: 45, items () { return this.slots.slice(9, 45).filter(Boolean) } }
  bot.inventory = inventory
  const pending = []
  const recipe = { result: { id: plankType, count: 4 }, requiresTable: false, inShape: null, ingredients: [{ id: logType, metadata: null, count: -1 }] }
  bot.recipesFor = () => inventory.items().some(item => item.type === logType) ? [recipe] : []
  bot.craft = async () => { throw new Error('Native optimistic craft must not run') }
  bot.clickWindow = async (slot, button) => { assert.equal(pending.length, 0, 'Every click must be reconciled before the next'); pending.push({ slot, button }) }
  bot._syncWindow = async () => {
    for (const { slot, button } of pending.splice(0)) {
      if (slot === 0) { assert.equal(server.cursor, null); server.cursor = server.slots[0]; server.slots[1] = null }
      else if (button === 1) { assert.equal(server.slots[slot], null); server.slots[slot] = { ...server.cursor, count: 1 }; server.cursor.count--; if (!server.cursor.count) server.cursor = null }
      else if (!server.cursor) { server.cursor = server.slots[slot]; server.slots[slot] = null }
      else if (!server.slots[slot]) { server.slots[slot] = server.cursor; server.cursor = null }
      else { assert.equal(server.slots[slot].type, server.cursor.type); const cap = server.slots[slot].components?.find(c=>c.type==='max_stack_size')?.data ?? 64; const moved=Math.min(server.cursor.count,cap-server.slots[slot].count); if(!moved)clicksOnFull++; server.slots[slot].count += moved; server.cursor.count -= moved; if(!server.cursor.count)server.cursor=null }
      server.slots[0] = server.slots[1]?.type === logType ? stack('oak_planks', 4) : null
    }
    inventory.slots = server.slots.map(item => item && { ...item })
    inventory.selectedItem = server.cursor && { ...server.cursor }
  }
  await bot._syncWindow()
  const result = await createActions(bot).execute('craft', { item: 'oak_planks', count: 8 })
  assert.equal(result.crafted, 8)
  assert.equal(clicksOnFull, 0)
  assert.equal(server.slots[9].count,80)
  assert.equal(server.slots[10].name,'oak_planks')
  assert.equal(inventory.items().filter(i=>i.name==='oak_planks').reduce((n,i)=>n+i.count,0),8)
  assert.equal(server.cursor, null)
  assert.equal(server.slots[1], null)
})

test('cursor storage handles full custom stacks', async () => {
  const bot = fakeBot()
  const logType = registry.itemsByName.oak_log.id
  const plankType = registry.itemsByName.oak_planks.id
  const stack = (name, count) => ({ name, type: registry.itemsByName[name].id, metadata: 0, count, stackSize: 64 })
  const server = { slots: Array(46).fill(null), cursor: null }
  server.slots[36] = stack('oak_log', 2)
  const custom = count => ({ ...stack('cobblestone', count), components:[{type:'max_stack_size',data:16}] })
  server.slots[9] = custom(16)
  server.cursor = custom(1)
  let clicksOnFull = 0
  const inventory = { slots: Array(46).fill(null), selectedItem: null, inventoryStart: 9, inventoryEnd: 45, items () { return this.slots.slice(9, 45).filter(Boolean) } }
  bot.inventory = inventory
  const pending = []
  const recipe = { result: { id: plankType, count: 4 }, requiresTable: false, inShape: null, ingredients: [{ id: logType, metadata: null, count: -1 }] }
  bot.recipesFor = () => inventory.items().some(item => item.type === logType) ? [recipe] : []
  bot.craft = async () => { throw new Error('Native optimistic craft must not run') }
  bot.clickWindow = async (slot, button) => { assert.equal(pending.length, 0, 'Every click must be reconciled before the next'); pending.push({ slot, button }) }
  bot._syncWindow = async () => {
    for (const { slot, button } of pending.splice(0)) {
      if (slot === 0) { assert.equal(server.cursor, null); server.cursor = server.slots[0]; server.slots[1] = null }
      else if (button === 1) { assert.equal(server.slots[slot], null); server.slots[slot] = { ...server.cursor, count: 1 }; server.cursor.count--; if (!server.cursor.count) server.cursor = null }
      else if (!server.cursor) { server.cursor = server.slots[slot]; server.slots[slot] = null }
      else if (!server.slots[slot]) { server.slots[slot] = server.cursor; server.cursor = null }
      else { assert.equal(server.slots[slot].type, server.cursor.type); const cap = server.slots[slot].components?.find(c=>c.type==='max_stack_size')?.data ?? 64; const moved=Math.min(server.cursor.count,cap-server.slots[slot].count); if(!moved)clicksOnFull++; server.slots[slot].count += moved; server.cursor.count -= moved; if(!server.cursor.count)server.cursor=null }
      server.slots[0] = server.slots[1]?.type === logType ? stack('oak_planks', 4) : null
    }
    inventory.slots = server.slots.map(item => item && { ...item })
    inventory.selectedItem = server.cursor && { ...server.cursor }
  }
  await bot._syncWindow()
  const result = await createActions(bot).execute('craft', { item: 'oak_planks', count: 8 })
  assert.equal(result.crafted, 8)
  assert.equal(clicksOnFull, 0)
  assert.equal(server.slots[9].count,16)
  assert.equal(server.slots[10].count,1)
  assert.equal(inventory.items().filter(i=>i.name==='oak_planks').reduce((n,i)=>n+i.count,0),8)
  assert.equal(server.cursor, null)
  assert.equal(server.slots[1], null)
})

test('craft stores ordinary output without swapping a same-type named stack', async () => {
  const bot = fakeBot()
  const logType = registry.itemsByName.oak_log.id
  const plankType = registry.itemsByName.oak_planks.id
  const stack = (name, count) => ({ name, type: registry.itemsByName[name].id, metadata: 0, count, stackSize: 64 })
  const server = { slots: Array(46).fill(null), cursor: null }
  server.slots[36] = stack('oak_log', 1)
  const named = { ...stack('oak_planks', 1), components: [{ type: 'custom_name', data: { type: 'string', value: 'Reserved' } }] }
  server.slots[9] = named
  let swaps = 0
  const inventory = { slots: Array(46).fill(null), selectedItem: null, inventoryStart: 9, inventoryEnd: 45, items () { return this.slots.slice(9, 45).filter(Boolean) } }
  bot.inventory = inventory
  const pending = []
  const recipe = { result: { id: plankType, count: 4 }, requiresTable: false, inShape: null, ingredients: [{ id: logType, metadata: null, count: -1 }] }
  bot.recipesFor = () => inventory.items().some(item => item.type === logType) ? [recipe] : []
  bot.craft = async () => { throw new Error('Native optimistic craft must not run') }
  bot.clickWindow = async (slot, button) => { assert.equal(pending.length, 0, 'Every click must be reconciled before the next'); pending.push({ slot, button }) }
  bot._syncWindow = async () => {
    for (const { slot, button } of pending.splice(0)) {
      if (slot === 0) { assert.equal(server.cursor, null); server.cursor = server.slots[0]; server.slots[1] = null }
      else if (button === 1) { assert.equal(server.slots[slot], null); server.slots[slot] = { ...server.cursor, count: 1 }; server.cursor.count--; if (!server.cursor.count) server.cursor = null }
      else if (!server.cursor) { server.cursor = server.slots[slot]; server.slots[slot] = null }
      else if (!server.slots[slot]) { server.slots[slot] = server.cursor; server.cursor = null }
      else if (JSON.stringify(server.slots[slot].components ?? []) !== JSON.stringify(server.cursor.components ?? [])) { const previous = server.slots[slot]; server.slots[slot] = server.cursor; server.cursor = previous; swaps++ }
      else { assert.equal(server.slots[slot].type, server.cursor.type); server.slots[slot].count += server.cursor.count; server.cursor = null }
      server.slots[0] = server.slots[1]?.type === logType ? stack('oak_planks', 4) : null
    }
    inventory.slots = server.slots.map(item => item && { ...item })
    inventory.selectedItem = server.cursor && { ...server.cursor }
  }
  await bot._syncWindow()
  const result = await createActions(bot).execute('craft', { item: 'oak_planks', count: 4 })
  assert.equal(result.crafted, 4)
  assert.equal(swaps, 0)
  assert.deepEqual(server.slots[9], named)
  assert.equal(inventory.items().filter(item => !item.components?.length).reduce((n,item) => n + item.count, 0), 4)
  assert.equal(server.cursor, null)
  assert.equal(server.slots[1], null)
})

test('craft refuses a stored output with changed components despite matching type and count', async () => {
  const bot = fakeBot()
  const logType = registry.itemsByName.oak_log.id
  const plankType = registry.itemsByName.oak_planks.id
  const stack = (name, count) => ({ name, type: registry.itemsByName[name].id, metadata: 0, count, stackSize: 64 })
  const server = { slots: Array(46).fill(null), cursor: null }
  server.slots[36] = stack('oak_log', 1)
  const named = { ...stack('oak_planks', 1), components: [{ type: 'custom_name', data: { type: 'string', value: 'Reserved' } }] }
  server.slots[9] = named
  let swaps = 0
  const inventory = { slots: Array(46).fill(null), selectedItem: null, inventoryStart: 9, inventoryEnd: 45, items () { return this.slots.slice(9, 45).filter(Boolean) } }
  bot.inventory = inventory
  const pending = []
  const recipe = { result: { id: plankType, count: 4 }, requiresTable: false, inShape: null, ingredients: [{ id: logType, metadata: null, count: -1 }] }
  bot.recipesFor = () => inventory.items().some(item => item.type === logType) ? [recipe] : []
  bot.craft = async () => { throw new Error('Native optimistic craft must not run') }
  bot.clickWindow = async (slot, button) => { assert.equal(pending.length, 0, 'Every click must be reconciled before the next'); pending.push({ slot, button }) }
  bot._syncWindow = async () => {
    for (const { slot, button } of pending.splice(0)) {
      if (slot === 0) { assert.equal(server.cursor, null); server.cursor = server.slots[0]; server.slots[1] = null }
      else if (button === 1) { assert.equal(server.slots[slot], null); server.slots[slot] = { ...server.cursor, count: 1 }; server.cursor.count--; if (!server.cursor.count) server.cursor = null }
      else if (!server.cursor) { server.cursor = server.slots[slot]; server.slots[slot] = null }
      else if (!server.slots[slot]) { server.slots[slot] = { ...server.cursor, ...(slot >= 9 && server.cursor.type === plankType ? {components:[{type:"custom_name",data:{type:"string",value:"Changed"}}]} : {}) }; server.cursor = null }
      else if (JSON.stringify(server.slots[slot].components ?? []) !== JSON.stringify(server.cursor.components ?? [])) { const previous = server.slots[slot]; server.slots[slot] = server.cursor; server.cursor = previous; swaps++ }
      else { assert.equal(server.slots[slot].type, server.cursor.type); server.slots[slot].count += server.cursor.count; server.cursor = null }
      server.slots[0] = server.slots[1]?.type === logType ? stack('oak_planks', 4) : null
    }
    inventory.slots = server.slots.map(item => item && { ...item })
    inventory.selectedItem = server.cursor && { ...server.cursor }
  }
  await bot._syncWindow()
  await assert.rejects(createActions(bot).execute('craft', { item: 'oak_planks', count: 4 }), /Server did not confirm storing the cursor item/)
  assert.equal(swaps, 0)
})

test('mining refuses blocks whose drops require an unavailable tool', async () => {
  const bot = fakeBot()
  bot.putBlock('diamond_ore', new Vec3(2, 64, 0), { canHarvest: () => false })
  let mined = false
  bot.dig = async () => { mined = true }
  await assert.rejects(createActions(bot).execute('collect', { block: 'diamond_ore', count: 1, radius: 8 }), /suitable tool/)
  assert.equal(mined, false)
})

test('mining distinguishes mined blocks from inventory collection', async () => {
  const bot = fakeBot()
  const p = new Vec3(2, 64, 0)
  bot.putBlock('oak_log', p)
  bot.dig = async () => bot.removeBlock(p)
  const result = await createActions(bot).execute('collect', { block: 'oak_log', count: 2, radius: 8 })
  assert.equal(result.mined, 1)
  assert.equal(result.completed, false)
  assert.deepEqual(result.inventory_changes, {})
})

test('collection filters enclosed stone before the 128-candidate cap', async () => {
  const bot = fakeBot()
  for (let x = -4; x <= 4; x++) for (let y = 54; y <= 62; y++) for (let z = -4; z <= 4; z++) {
    const shell = Math.abs(x) === 4 || Math.abs(z) === 4 || y === 54 || y === 62
    bot.putBlock(shell ? 'dirt' : 'stone', new Vec3(x, y, z))
  }
  const exposed = new Vec3(12, 64, 0)
  bot.putBlock('stone', exposed)
  const unfiltered = bot.findBlocks({ matching: registry.blocksByName.stone.id, count: 128 })
  assert.equal(unfiltered.length, 128)
  assert.equal(unfiltered.some(p => p.equals(exposed)), false)
  const approached = []
  bot.pathfinder.getPathFromTo = function * (movement, start, goal) {
    if (goal.target) approached.push(goal.target)
    const p = goal.target ? goal.target.offset(-1, 0, 0) : new Vec3(goal.x, goal.y, goal.z)
    yield { result: { status: 'success', path: [p] } }
  }
  bot.pathfinder.goto = async goal => { bot.entity.position = new Vec3(goal.x + .5, goal.y, goal.z + .5) }
  bot.dig = async block => { assert.ok(block.position.equals(exposed)); bot.removeBlock(exposed); bot.addItem('cobblestone') }
  const result = await createActions(bot).execute('collect', { block: 'stone', count: 1, radius: 32 })
  assert.equal(result.completed, true)
  assert.equal(result.inventory_changes.cobblestone, 1)
  assert.equal(result.search_limited, false)
  assert.deepEqual(approached, [exposed])
})

test('collection rejects enclosed or unloaded faces without attempting a path', async () => {
  const bot = fakeBot()
  const p = new Vec3(2, 64, 0)
  bot.putBlock('stone', p)
  bot.blockAt = position => position.equals(p) ? { name: 'stone', position: p } : null
  let moved = false
  bot.pathfinder.goto = async () => { moved = true }
  await assert.rejects(createActions(bot).execute('collect', { block: 'stone', count: 1, radius: 8 }), /no exposed loaded candidates/)
  assert.equal(moved, false)
})

test('collection bounds matching-block inspection and reports an incomplete search', async () => {
  const bot = fakeBot()
  let inspected = 0
  bot.findBlocks = options => {
    while (true) { inspected++; options.useExtraInfo({ position: new Vec3(1000, 64, 0) }) }
  }
  await assert.rejects(createActions(bot).execute('collect', { block: 'stone', count: 1, radius: 8 }), error => {
    assert.match(error.message, /bounded search exhausted/)
    assert.equal(error.result.search_limited, true)
    return true
  })
  assert.ok(inspected <= 65537)
})

test('collection keeps exposed candidates found before its scan budget is exhausted', async () => {
  const bot = fakeBot()
  const p = new Vec3(2, 64, 0)
  const block = bot.putBlock('stone', p)
  bot.findBlocks = options => {
    options.useExtraInfo(block)
    while (true) options.useExtraInfo({ position: new Vec3(1000, 64, 0) })
  }
  bot.dig = async () => { bot.removeBlock(p); bot.addItem('cobblestone') }
  const result = await createActions(bot).execute('collect', { block: 'stone', count: 1, radius: 8 })
  assert.equal(result.completed, true)
  assert.equal(result.inventory_changes.cobblestone, 1)
  assert.equal(result.search_limited, true)
})

test('collection propagates cancellation during candidate scanning', async () => {
  const bot = fakeBot()
  const controller = new AbortController()
  bot.findBlocks = options => { controller.abort(); options.useExtraInfo({ position: new Vec3(2, 64, 0) }) }
  await assert.rejects(createActions(bot).execute('collect', { block: 'stone', count: 1, radius: 8 }, controller.signal), { name: 'AbortError' })
})

test('mining prefers harvest eligibility over an unsuitable faster golden tool', async () => {
  const bot = fakeBot()
  const gold = bot.addItem('golden_pickaxe')
  const iron = bot.addItem('iron_pickaxe')
  const p = new Vec3(2, 64, 0)
  bot.putBlock('diamond_ore', p, { canHarvest: type => type === iron.type })
  bot.pathfinder.bestHarvestTool = () => gold
  bot.dig = async () => { assert.equal(bot.heldItem.name, 'iron_pickaxe'); bot.removeBlock(p); bot.addItem('diamond') }
  const result = await createActions(bot).execute('collect', { block: 'diamond_ore', count: 1, radius: 8 })
  assert.equal(result.inventory_changes.diamond, 1)
})

test('dig_at removes only the specified block and verifies resulting inventory', async () => {
  const bot = fakeBot()
  const p = new Vec3(2, 64, 0)
  bot.putBlock('oak_log', p)
  bot.putBlock('oak_log', new Vec3(3, 64, 0))
  bot.dig = async block => { assert.ok(block.position.equals(p)); bot.removeBlock(p); bot.addItem('oak_log') }
  const result = await createActions(bot).execute('dig_at', { x: 2, y: 64, z: 0 })
  assert.equal(result.mined, 1)
  assert.equal(result.inventory_changes.oak_log, 1)
  assert.equal(bot.blockAt(new Vec3(3, 64, 0)).name, 'oak_log')
})

test('dig_at refuses support removal, liquid exposure, and overhead falling blocks', async () => {
  const bot = fakeBot()
  let dug = false
  bot.dig = async () => { dug = true }
  const actions = createActions(bot)
  bot.putBlock('stone', new Vec3(0, 63, 0))
  await assert.rejects(actions.execute('dig_at', { x: 0, y: 63, z: 0 }), /supporting the bot/)
  const p = new Vec3(2, 64, 0)
  bot.putBlock('stone', p)
  bot.putBlock('lava', new Vec3(3, 64, 0))
  await assert.rejects(actions.execute('dig_at', { x: 2, y: 64, z: 0 }), /adjacent liquid/)
  bot.removeBlock(new Vec3(3, 64, 0))
  bot.putBlock('gravel', new Vec3(2, 65, 0))
  await assert.rejects(actions.execute('dig_at', { x: 2, y: 64, z: 0 }), /overhead falling/)
  assert.equal(dug, false)
})

test('pickup projects falling drops onto reachable ground', async () => {
  const bot = fakeBot()
  bot.putBlock('stone', new Vec3(2, 63, 0))
  bot.entities[2] = { id: 2, name: 'item', position: new Vec3(2.5, 66.5, 0.5) }
  bot.pathfinder.goto = async goal => { assert.equal(goal.y, 64); bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5); delete bot.entities[2]; bot.addItem('oak_log') }
  const result = await createActions(bot).execute('pickup', { radius: 8 })
  assert.equal(result.inventory_changes.oak_log, 1)
  assert.deepEqual(result.remaining_drops, [])
})

test('give supports an exact visible Bedrock username with a prefix and space', async () => {
  const bot = fakeBot()
  const item = bot.addItem('oak_planks', 2)
  bot.players['.Player Name'] = { entity: { position: new Vec3(2, 64, 0) } }
  bot.toss = async (type, metadata, count) => { item.count -= count }
  const result = await createActions(bot).execute('give', { player: '.Player Name', item: 'oak_planks', count: 1 })
  assert.equal(result.dropped_for, '.Player Name')
  assert.equal(item.count, 1)
})

test('combat rejects players before any attack', async () => {
  const bot = fakeBot()
  bot.entities[2] = { id: 2, username: 'Friend', type: 'player', name: 'player', position: new Vec3(2, 64, 0) }
  let attacked = false
  bot.attack = () => { attacked = true }
  await assert.rejects(createActions(bot).execute('attack', { entity_id: 2, mob: null, duration: 1 }), /non-player mob/)
  assert.equal(attacked, false)
})

test('sleep refuses dimensions where beds explode', async () => {
  const bot = fakeBot()
  bot.game.dimension = 'the_nether'
  await assert.rejects(createActions(bot).execute('sleep', {}), /overworld/)
})

test('sleep refuses a dimension change during bed approach',async()=>{
  const bot=fakeBot();bot.time={timeOfDay:18000};bot.isABed=b=>b?.name==='red_bed';
  bot.putBlock('red_bed',new Vec3(10,64,0));let clicks=0;
  bot._client.write=()=>{clicks++};bot.sleep=()=>{throw Error('Native sleep must not run')};
  bot.pathfinder.goto=async goal=>{bot.entity.position=new Vec3(goal.x+.5,64,goal.z+.5);bot.game.dimension='the_nether';bot.emit('respawn')};
  await assert.rejects(createActions(bot).execute('sleep',{}),/session changed/);assert.equal(clicks,0);
  assert.equal(bot.listenerCount('respawn'),0);
})

test('activation and sleep never send after cancellation or session changes during aiming',async()=>{
  for(const action of ['activate','sleep'])for(const mode of ['stop','dimension','respawn','end','target','distance']){
    const bot=fakeBot(),controller=new AbortController();bot.time={timeOfDay:18000};bot.isABed=b=>b?.name==='red_bed';
    const p=new Vec3(1,64,0);bot.putBlock(action==='sleep'?'red_bed':'lever',p);let began,drain,packets=0;
    const started=new Promise(r=>{began=r});bot.lookAt=async()=>{began();await new Promise(r=>{drain=r})};
    bot._client.write=()=>{packets++};bot.swingArm=()=>{};
    const actions=createActions(bot),pending=actions.execute(action,action==='sleep'?{}:{x:1,y:64,z:0},controller.signal);
    await started;
    if(mode==='stop')controller.abort();
    if(mode==='dimension')bot.game.dimension='the_nether';
    if(mode==='respawn'||mode==='end')bot.emit(mode);
    if(mode==='target')bot.putBlock('stone',p);
    if(mode==='distance')bot.entity.position.x=20;
    const rejected=assert.rejects(pending);drain();await rejected;
    assert.equal(packets,0,`${action}/${mode}`);
    for(const e of ['respawn','spawn','end','sleep'])assert.equal(bot.listenerCount(e),0,`${action}/${mode}/${e}`);
  }
})

test('guarded sleep confirms an empty-hand server acknowledgement and cleans listeners',async()=>{
  const bot=fakeBot();bot.time={timeOfDay:18000};bot.isABed=b=>b?.name==='red_bed';bot.putBlock('red_bed',new Vec3(1,64,0));
  let packets=0;bot.swingArm=()=>{};bot.sleep=()=>{throw Error('Native sleep must not run')};
  bot._client.write=(name,packet)=>{assert.equal(name,'block_place');assert.equal(packet.hand,0);packets++;bot.isSleeping=true;bot.emit('sleep')};
  const result=await createActions(bot).execute('sleep',{});assert.equal(result.sleeping,true);assert.equal(packets,1);
  for(const e of ['respawn','spawn','end','sleep'])assert.equal(bot.listenerCount(e),0);
})

test('guarded activation uses the pinned packet and refuses unsupported versions',async()=>{
  for(const version of ['1.21.8','1.20.1']){
    const bot=fakeBot();bot.version=version;bot.putBlock('lever',new Vec3(1,64,0));bot.swingArm=()=>{};const packets=[];
    bot._client.write=(name,packet)=>packets.push({name,packet});
    const pending=createActions(bot).execute('activate',{x:1,y:64,z:0});
    if(version==='1.21.8'){assert.equal((await pending).activated,'lever');assert.equal(packets.length,1);assert.equal(packets[0].packet.sequence,0)}
    else{await assert.rejects(pending,/verified only/);assert.equal(packets.length,0)}
  }
})

test('activation cannot inspect or close a replacement session window after sending',async()=>{
  const bot=fakeBot();bot.putBlock('lever',new Vec3(1,64,0));bot.swingArm=()=>{};let closed=0;
  bot.closeWindow=async()=>{closed++};
  bot._client.write=()=>setTimeout(()=>{bot.game.dimension='the_nether';bot.currentWindow={id:99,type:'new-session-window'};bot.emit('respawn')},10);
  await assert.rejects(createActions(bot).execute('activate',{x:1,y:64,z:0}),/session changed/);
  assert.equal(closed,0);assert.equal(bot.currentWindow.id,99);
})

test('sleep cannot return stale success after acknowledgement changes session',async()=>{
  const bot=fakeBot();bot.time={timeOfDay:18000};bot.isABed=b=>b?.name==='red_bed';bot.putBlock('red_bed',new Vec3(1,64,0));bot.swingArm=()=>{};
  bot._client.write=()=>{bot.isSleeping=true;bot.emit('sleep');bot.emit('respawn')};
  await assert.rejects(createActions(bot).execute('sleep',{}),/session changed/);
})

test('sleep rechecks dawn, sleeping state and bed occupancy immediately before sending',async()=>{
  for(const mode of ['dawn','sleeping','occupied']){
    const bot=fakeBot();bot.time={timeOfDay:18000};bot.isABed=b=>b?.name==='red_bed';let occupied=false;
    bot.putBlock('red_bed',new Vec3(1,64,0),{getProperties:()=>({occupied})});let sent=0;bot._client.write=()=>{sent++};
    bot.lookAt=async()=>{if(mode==='dawn')bot.time.timeOfDay=0;if(mode==='sleeping')bot.isSleeping=true;if(mode==='occupied')occupied=true};
    await assert.rejects(createActions(bot).execute('sleep',{}));assert.equal(sent,0,mode);
  }
})

test('smelt refuses occupied furnace and leaves existing items alone', async () => {
  const bot = fakeBot()
  bot.addItem('raw_iron', 1)
  bot.addItem('coal', 1)
  bot.putBlock('furnace', new Vec3(2, 64, 0))
  let closed = false
  let transferred = false
  bot.openFurnace = async () => ({ inputItem: () => ({ name: 'raw_gold', count: 1 }), outputItem: () => null, fuelItem: () => null, close: () => { closed = true }, putInput: async () => { transferred = true } })
  await assert.rejects(createActions(bot).execute('smelt', { item: 'raw_iron', count: 1, fuel: null }), /occupied/)
  assert.equal(transferred, false)
  assert.equal(closed, true)
})

test('smelt synchronizes partial input/fuel stacks and verifies actual output transfer', async () => {
  const bot = fakeBot()
  bot.putBlock('furnace', new Vec3(2, 64, 0))
  const stack = (name, count) => ({ name, type: registry.itemsByName[name].id, metadata: 0, count, stackSize: 64 })
  const server = { slots: Array(39).fill(null), cursor: null }
  server.slots[3] = stack('sand', 3)
  server.slots[4] = stack('coal', 3)
  let closed = false
  let carried = server.slots.slice(3).filter(Boolean).map(item => ({ ...item }))
  const furnace = { slots: server.slots.map(item => item && { ...item }), selectedItem: null, inventoryStart: 3, inventoryEnd: 39, inputItem () { return this.slots[0] }, fuelItem () { return this.slots[1] }, outputItem () { return this.slots[2] }, close () { closed = true; carried = this.slots.slice(3).filter(Boolean).map(item => ({ ...item })) } }
  // Match Mineflayer: the open container owns inventory changes until close.
  bot.inventory.items = () => carried
  bot.openFurnace = async () => { closed = false; return furnace }
  furnace.putInput = furnace.putFuel = furnace.takeOutput = async () => { throw new Error('Native unsynchronized furnace transfer must not run') }
  const pending = []
  bot.clickWindow = async (slot, button) => { assert.equal(pending.length, 0); pending.push({ slot, button }) }
  bot._syncWindow = async () => {
    for (const { slot, button } of pending.splice(0)) {
      if (button === 1) {
        if (!server.slots[slot]) server.slots[slot] = { ...server.cursor, count: 0 }
        server.slots[slot].count++
        server.cursor.count--
        if (!server.cursor.count) server.cursor = null
      } else if (!server.cursor) { server.cursor = server.slots[slot]; server.slots[slot] = null }
      else if (!server.slots[slot]) { server.slots[slot] = server.cursor; server.cursor = null }
      else { assert.equal(server.slots[slot].type, server.cursor.type); server.slots[slot].count += server.cursor.count; server.cursor = null }
      if (server.slots[0]?.name === 'sand' && (server.slots[1]?.name === 'coal' || furnace.fuelSeconds >= 10)) { server.slots[2] = stack('glass', server.slots[0].count); server.slots[0] = null; server.slots[1] = null }
    }
    furnace.slots = server.slots.map(item => item && { ...item })
    furnace.selectedItem = server.cursor && { ...server.cursor }
  }
  const actions = createActions(bot)
  const result = await actions.execute('smelt', { item: 'sand', count: 2, fuel: 'coal' })
  assert.equal(result.smelted, 2)
  assert.equal(closed, true)
  assert.equal(server.cursor, null)
  assert.deepEqual(Object.fromEntries(bot.inventory.items().map(item => [item.name, item.count])), { sand: 1, coal: 2, glass: 2 })
  furnace.fuelSeconds = 60
  const again = await actions.execute('smelt', { item: 'sand', count: 1, fuel: null })
  assert.equal(again.fuel_added.count, 0)
  assert.equal(again.smelted, 1)
  assert.deepEqual(Object.fromEntries(bot.inventory.items().map(item => [item.name, item.count])), { coal: 2, glass: 3 })
})

test('use_item accepts existing yaw outside the negative-pi to pi interval', async () => {
  const bot = fakeBot()
  bot.entity.yaw = 5.5
  bot.heldItem = bot.addItem('bow')
  let yaw
  bot.look = async value => { yaw = value }
  bot.activateItem = () => {}
  const result = await createActions(bot).execute('use_item', { item: null, yaw: null, pitch: null, duration: 0 })
  assert.equal(result.used, 'bow')
  assert.ok(yaw >= -Math.PI && yaw <= Math.PI)
})

test('direct stop interrupts a held bow without releasing an unintended arrow', async () => {
  const bot = fakeBot()
  bot.heldItem = bot.addItem('bow')
  bot.quickBarSlot = 0
  let activated
  const began = new Promise(resolve => { activated = resolve })
  const operations = []
  bot.activateItem = () => { bot.usingHeldItem = true; activated() }
  bot.setQuickBarSlot = slot => { operations.push('slot'); bot.quickBarSlot = slot; bot.heldItem = null }
  bot.deactivateItem = () => { operations.push('release') }
  const actions = createActions(bot)
  const pending = actions.execute('use_item', { item: null, yaw: 0, pitch: 0, duration: 10 })
  await began
  actions.stop()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(operations[0], 'slot')
  assert.equal(operations[1], 'release')
})

test('block-face navigation measures elevated supports from player eyes and rejects obstructions', async () => {
  const { BlockFaceGoal, visibleBlockFace } = await import('../src/actions.js')
  const target = new Vec3(16, 68, -6)
  const observedEyes = []
  const world = { raycast: (eye, direction, range) => { assert.ok(range > 2 && range <= 4); assert.ok(Math.abs(direction.norm() - 1) < 0.00001); observedEyes.push(eye); return { position: target } } }
  const goal = new BlockFaceGoal(target, world, { eyeHeight: 1.62, reach: 4 })
  assert.equal(goal.isEnd(new Vec3(16, 65, -4)), true)
  assert.equal(observedEyes[0].y, 66.62)
  assert.equal(goal.isEnd(new Vec3(16, 59, -4)), false)
  assert.equal(visibleBlockFace({ raycast: () => ({ position: new Vec3(16, 66, -5) }) }, new Vec3(16.5, 66.62, -3.5), target, 4), false)
})

test('pickup refuses an item with no validated standing cell', async () => {
  const bot = fakeBot()
  bot.entities[2] = { id: 2, name: 'item', position: new Vec3(2.5, 64.5, 0.5) }
  bot.putBlock('stone', new Vec3(2, 63, 0))
  bot.putBlock('oak_log', new Vec3(2, 65, 0))
  let traveled = 0
  bot.pathfinder.setGoal = goal => { if (goal) traveled++ }
  const result = await createActions(bot).execute('pickup', { radius: 8 })
  assert.equal(traveled, 0)
  assert.equal(result.remaining_drops.length, 1)
  assert.ok(result.unreachable.every(f => /standing space/.test(f.error)))
})

test('pickup disappearance is not fabricated as inventory gain', async () => {
  const bot = fakeBot()
  bot.putBlock('stone', new Vec3(2, 63, 0))
  bot.entities[2] = { id: 2, name: 'item', position: new Vec3(2.5, 64.5, 0.5) }
  bot.pathfinder.setGoal = goal => {
    bot.pathfinder.goal = goal
    if (goal) { const target = bot.entities[2]; delete bot.entities[2]; bot.emit('entityGone', target) }
  }
  const result = await createActions(bot).execute('pickup', { radius: 8 })
  assert.deepEqual(result.inventory_changes, {})
  assert.deepEqual(result.remaining_drops, [])
  assert.equal(bot.listenerCount('entityGone'), 0)
})

test('collection considers level ground beyond the nearest 128 deep exposed targets', async () => {
  const bot = fakeBot()
  for (let i = 0; i < 160; i++) bot.putBlock('stone', new Vec3(3 + i % 10, 53 + Math.floor(i / 40), Math.floor(i / 10) % 4))
  const surface = new Vec3(25, 64, 0)
  bot.putBlock('stone', surface)
  for (const [x, z] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) bot.putBlock('dirt', surface.offset(x, -1, z))
  let firstApproach
  bot.pathfinder.getPathFromTo = function * (m, start, goal) {
    if (goal.target) firstApproach ??= goal.target
    const p = goal.target ? goal.target.offset(-1, 0, 0) : new Vec3(goal.x, goal.y, goal.z)
    yield { result: { status: 'success', path: [p] } }
  }
  bot.dig = async block => { assert.ok(block.position.equals(surface)); bot.removeBlock(surface); bot.addItem('cobblestone') }
  const result = await createActions(bot).execute('collect', { block: 'stone', count: 1, radius: 32 })
  assert.ok(firstApproach.equals(surface))
  assert.equal(result.inventory_changes.cobblestone, 1)
})

test('craft rejects missing ingredients before traveling to a distant table', async () => {
  const bot = fakeBot()
  bot.putBlock('crafting_table', new Vec3(20, 64, 0))
  bot.recipesFor = () => []
  bot.pathfinder.goto = async () => { throw new Error('Must not travel without ingredients') }
  await assert.rejects(createActions(bot).execute('craft', { item: 'stone_pickaxe', count: 1 }), /missing ingredients/)
})

test('collection prefers supported drop landings over a closer ledge', async () => {
  const bot = fakeBot()
  const ledge = new Vec3(2, 64, 0)
  const supported = new Vec3(3, 64, 0)
  bot.putBlock('stone', ledge)
  bot.putBlock('stone', supported)
  for (const [x, z] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) bot.putBlock('dirt', supported.offset(x, -1, z))
  bot.dig = async block => { assert.ok(block.position.equals(supported)); bot.removeBlock(supported); bot.addItem('cobblestone') }
  const result = await createActions(bot).execute('collect', { block: 'stone', count: 1, radius: 8 })
  assert.equal(result.inventory_changes.cobblestone, 1)
})

test('craft checks prospective table recipes before placing a carried table', async () => {
  const bot = fakeBot()
  bot.addItem('crafting_table')
  bot.recipesFor = () => []
  bot.placeBlock = async () => { throw new Error('Must not place a table without ingredients') }
  await assert.rejects(createActions(bot).execute('craft', { item: 'stone_pickaxe', count: 1 }), /missing ingredients/)
  assert.equal(bot.inventory.items()[0].count, 1)
})

test('collection failure budget resets when a block is successfully harvested', async () => {
  const bot = fakeBot()
  // A successful harvest between two runs of four rejected candidates must
  // allow the second success, rather than stop at eight lifetime failures.
  const positions = Array.from({ length: 10 }, (_, i) => new Vec3(i + 1, 64, 0))
  positions.forEach(p => bot.putBlock('stone', p))
  bot.canDigBlock = block => [5, 10].includes(block.position.x)
  bot.dig = async block => { bot.removeBlock(block.position); bot.addItem('cobblestone') }
  bot.pathfinder.getPathFromTo = function * (m, start, goal) {
    const p = goal.target ? goal.target.offset(-1, 0, 0) : new Vec3(goal.x, goal.y, goal.z)
    yield { result: { status: 'success', path: [p] } }
  }
  const result = await createActions(bot).execute('collect', { block: 'stone', count: 2, radius: 16 })
  assert.equal(result.mined, 2)
  assert.equal(result.failures.length, 8)
  assert.equal(result.inventory_changes.cobblestone, 2)
})

test('pickup can use a diagonal grass-covered landing without terrain modification', async () => {
  const bot = fakeBot()
  bot.entities[2] = { id: 2, name: 'item', position: new Vec3(2.1, 64, 2.1) }
  const landing = new Vec3(1, 64, 1)
  bot.putBlock('stone', landing.offset(0, -1, 0))
  bot.putBlock('short_grass', landing, { boundingBox: 'empty' })
  let reached = false
  bot.pathfinder.setMovements = m => { assert.equal(m.canDig, false) }
  bot.pathfinder.setGoal = goal => {
    bot.pathfinder.goal = goal
    if (goal) {
      assert.deepEqual([goal.x, goal.y, goal.z], [1, 64, 1]); reached = true
      const drop = bot.entities[2]; delete bot.entities[2]; bot.addItem('cobblestone'); bot.emit('playerCollect', bot.entity, drop)
    }
  }
  const result = await createActions(bot).execute('pickup', { radius: 8 })
  assert.equal(reached, true)
  assert.equal(result.inventory_changes.cobblestone, 1)
  assert.equal(result.remaining_drops.length, 0)
})

test('craft uses a carried table locally instead of traveling to a distant duplicate', async () => {
  const bot = fakeBot()
  bot.putBlock('crafting_table', new Vec3(20, 64, 0))
  for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++)bot.putBlock('dirt',new Vec3(x,63,z))
  bot.addItem('crafting_table')
  const recipe = { requiresTable: true, result: { count: 1 } }
  bot.recipesFor = (id, meta, count, table) => table ? [recipe] : []
  bot.pathfinder.goto = async () => { throw new Error('Must not travel to a distant table when carrying one') }
  bot.craft = async (r, count, table) => {
    assert.ok(table.position.equals(new Vec3(-1, 64, -1)))
    bot.addItem('stone_pickaxe')
  }
  const result = await createActions(bot).execute('craft', { item: 'stone_pickaxe', count: 1 })
  assert.equal(result.crafted, 1)
  assert.equal(bot.blockAt(new Vec3(-1, 64, -1)).name, 'crafting_table')
})

test('pickup does not treat hazardous empty-collision blocks as standing space', async () => {
  for (const name of ['water', 'lava', 'fire', 'sweet_berry_bush', 'powder_snow']) {
    const bot = fakeBot()
    bot.entities[2] = { id: 2, name: 'item', position: new Vec3(2.5, 64, 0.5) }
    bot.putBlock('stone', new Vec3(2, 63, 0))
    bot.putBlock(name, new Vec3(2, 64, 0), { boundingBox: 'empty' })
    bot.pathfinder.setGoal = goal => { assert.equal(goal, null) }
    const result = await createActions(bot).execute('pickup', { radius: 8 })
    assert.equal(result.remaining_drops.length, 1)
  }
})

test('pickup aims at the drop rather than a nearer but out-of-reach standing cell', async () => {
  const bot = fakeBot()
  bot.entities[2] = { id: 2, name: 'item', position: new Vec3(2.9, 64, 0.5) }
  bot.putBlock('stone', new Vec3(1, 63, 0))
  bot.putBlock('stone', new Vec3(2, 63, 0))
  bot.pathfinder.setGoal = goal => {
    bot.pathfinder.goal = goal
    if (goal) {
      assert.deepEqual([goal.x, goal.y, goal.z], [2, 64, 0])
      const drop = bot.entities[2]; delete bot.entities[2]; bot.addItem('oak_log'); bot.emit('playerCollect', bot.entity, drop)
    }
  }
  const result = await createActions(bot).execute('pickup', { radius: 8 })
  assert.equal(result.inventory_changes.oak_log, 1)
})

test('collection honors bounded caller exclusions before selecting a target', async () => {
  const bot = fakeBot(), skip = new Vec3(1, 64, 0), wanted = new Vec3(2, 64, 0);
  bot.putBlock('oak_log', skip); bot.putBlock('oak_log', wanted);
  bot.dig = async block => { assert.ok(block.position.equals(wanted)); bot.removeBlock(wanted); bot.addItem('oak_log'); };
  const result = await createActions(bot).execute('collect', { block: 'oak_log', count: 1, radius: 8, skip_positions: [{ x: 1, y: 64, z: 0 }] });
  assert.equal(result.inventory_changes.oak_log, 1);
  await assert.rejects(createActions(bot).execute('collect', { block: 'oak_log', count: 1, skip_positions: Array(129).fill({ x: 1, y: 64, z: 0 }) }), /at most 128/);
});

test('job movement boundary filters collection targets and constrains path nodes', async () => {
  const bot = fakeBot(); let movement;
  bot.pathfinder.setMovements = m => { movement = m; };
  const inside = new Vec3(2, 64, 0), outside = new Vec3(5, 64, 0);
  bot.putBlock('oak_log', outside); bot.putBlock('oak_log', inside);
  let boundary = { center: { x: 0.5, y: 64, z: 0.5 }, radius: 3 };
  const actions = createActions(bot, { movementBoundary: () => boundary });
  bot.dig = async b => { assert.ok(b.position.equals(inside)); bot.removeBlock(inside); bot.addItem('oak_log'); };
  await actions.execute('collect', { block: 'oak_log', count: 1, radius: 8 });
  await assert.rejects(actions.execute('go_to', { x: 5, y: 64, z: 0, radius: 0 }), /movement boundary/);
  await actions.execute('go_to', { x: 1, y: 64, z: 0, radius: 0 });
  assert.equal(movement.exclusionStep({ position: inside }), 0);
  assert.ok(movement.exclusionStep({ position: outside }) > 100);
  boundary = null;
  assert.equal(movement.exclusionStep({ position: outside }), 0);
});

test('mining protects support under the full player footprint at a block edge', async () => {
  const bot = fakeBot(); bot.entity.position = new Vec3(1.05, 65, 0.5);
  bot.putBlock('stone', new Vec3(0, 64, 0));
  bot.dig = async () => { throw new Error('Must not remove an overlapping support'); };
  await assert.rejects(createActions(bot).execute('dig_at', { x: 0, y: 64, z: 0 }), /supporting/);
});

test('targeted clearing refuses a block that no longer matches the observed type', async () => {
  const bot = fakeBot(); bot.putBlock('chest', new Vec3(2, 64, 0));
  let mined = false; bot.dig = async () => { mined = true; };
  await assert.rejects(createActions(bot).execute('dig_at', { x: 2, y: 64, z: 0, expected_block: 'stone' }), /changed/);
  assert.equal(mined, false);
});

test('return anchor permits a neighboring supported cell but never a two-block shortcut', async () => {
 const bot = fakeBot(); let plans = 0;
 bot.pathfinder.getPathFromTo = function * (movement, start, goal) {
   plans++;
   if(plans === 2) {
     assert.equal(goal.isEnd({x:0,y:64,z:1}),true);
     assert.equal(goal.isEnd({x:0,y:64,z:2}),false);
     assert.equal(goal.isEnd({x:0,y:62,z:0}),false);
     yield {result:{status:'success',path:[{x:0,y:64,z:1}]}};
   } else yield {result:{status:'success',path:[{x:0,y:64,z:-4}]}};
 };
 const result = await createActions(bot).execute('explore',{direction:'north',distance:4,returnable:true});
 assert.equal(result.explored,true); assert.equal(plans,2);
});

test('wood collection prefers a reachable upper trunk over a distant supported tree base', async () => {
 const bot=fakeBot(),upper=new Vec3(1,66,0),distant=new Vec3(10,64,0);
 bot.putBlock('oak_log',upper);bot.putBlock('oak_log',distant);
 for(const [x,z]of [[0,0],[-1,0],[1,0],[0,-1],[0,1]])bot.putBlock('dirt',distant.offset(x,-1,z));
 bot.dig=async block=>{assert.ok(block.position.equals(upper));bot.removeBlock(upper);bot.addItem('oak_log');};
 const result=await createActions(bot).execute('collect',{block:'oak_log',count:1,radius:16});assert.equal(result.inventory_changes.oak_log,1);
});

test('nearby hostiles remain visible when dropped items crowd the observation cap',()=>{
 const bot=fakeBot();for(let id=2;id<40;id++)bot.entities[id]={id,name:'item',type:'other',position:new Vec3(0.6,64,0.6)};
 bot.entities[100]={id:100,name:'creeper',type:'hostile',position:new Vec3(5,64,0.5)};
 const state=createActions(bot).snapshot();assert.equal(state.entities.length,24);assert.equal(state.entities[0].id,100);assert.equal(state.entities[0].distance,4.5);
});

test('collection stops harvesting and pursuing when its shared planning budget is exhausted', async t => {
  const bot = fakeBot()
  let now = 0, plans = 0, digs = 0, pursuits = 0
  t.mock.method(performance, 'now', () => now)
  for (let x = 0; x < 8; x++) for (let z = -1; z <= 1; z++) bot.putBlock('dirt', new Vec3(x, 63, z))
  bot.putBlock('oak_log', new Vec3(2, 64, 0))
  bot.putBlock('oak_log', new Vec3(3, 64, 0))
  bot.dig = async block => {
    digs++; bot.removeBlock(block.position)
    bot.entities[99] = { id: 99, name: 'item', position: new Vec3(4.5, 64, .5) }
  }
  bot.pathfinder.getPathFromTo = function * () { plans++; now += 7100; yield { result: { status: 'partial', path: [] } } }
  bot.pathfinder.goto = async () => { pursuits++ }
  const result = await createActions(bot).execute('collect', { block: 'oak_log', count: 2, radius: 8 })
  assert.equal(digs, 1)
  assert.equal(plans, 1)
  assert.equal(pursuits, 0)
  assert.equal(result.completed, false)
  assert.equal(result.planning_limited, true)
  assert.equal(result.remaining_drops[0].id, 99)
  assert.equal(result.pickup_failures.length, 1)
  assert.equal(result.pickup_failures[0].code, 'COLLECTION_PLANNING_LIMIT')
  assert.deepEqual(result.inventory_changes, {})
})

test('pickup gives a farther item a turn before retrying the closest blocked item', async () => {
  const bot = fakeBot(), planned = []
  for (let x = 0; x < 8; x++) for (let z = -1; z <= 1; z++) bot.putBlock('dirt', new Vec3(x, 63, z))
  bot.entities[10] = { id: 10, name: 'item', position: new Vec3(2.5, 64, .5) }
  bot.entities[11] = { id: 11, name: 'item', position: new Vec3(5.5, 64, .5) }
  bot.pathfinder.getPathFromTo = function * (movement, start, goal) {
    const reverse = goal.x === 0
    if (reverse) planned.push(start.x)
    yield { result: { status: (reverse ? start.x : goal.x) === 2 ? 'noPath' : 'success', path: [{ x: goal.x, y: goal.y, z: goal.z }] } }
  }
  bot.pathfinder.goto = async goal => {
    bot.entity.position = new Vec3(goal.x + .5, goal.y, goal.z + .5)
    if (goal.x === 5) { delete bot.entities[11]; bot.addItem('oak_log'); delete bot.entities[10] }
  }
  const result = await createActions(bot).execute('pickup', { radius: 8 })
  assert.deepEqual(planned.slice(0, 2), [2, 5])
  assert.equal(result.inventory_changes.oak_log, 1)
  assert.equal(result.planning_limited, false)
})

test('pickup stops on cumulative planning exhaustion after fairly rotating targets and cells', async t => {
  const bot = fakeBot(), planned = []
  let now = 0
  t.mock.method(performance, 'now', () => now)
  for (let x = 0; x < 8; x++) for (let z = -1; z <= 1; z++) bot.putBlock('dirt', new Vec3(x, 63, z))
  bot.entities[10] = { id: 10, name: 'item', position: new Vec3(2.5, 64, .5) }
  bot.entities[11] = { id: 11, name: 'item', position: new Vec3(5.5, 64, .5) }
  bot.pathfinder.getPathFromTo = function * (movement, start, goal) {
    planned.push([start.x, start.z]); now += 1601
    yield { result: { status: 'partial', path: [] } }
  }
  const result = await createActions(bot).execute('pickup', { radius: 8 })
  assert.equal(planned.length, 5)
  assert.deepEqual(result.unreachable.map(f => f.id), [10, 11, 10, 11, 10])
  assert.notDeepEqual(planned[0], planned[2])
  assert.notDeepEqual(planned[1], planned[3])
  assert.equal(result.planning_limited, true)
  assert.equal(result.unreachable.at(-1).code, 'COLLECTION_PLANNING_LIMIT')
  assert.equal(result.remaining_drops.length, 2)
  assert.deepEqual(result.inventory_changes, {})
})

test('mining refuses a waterlogged target even when surrounding blocks are dry', async () => {
  const bot = fakeBot()
  bot.putBlock('oak_leaves', new Vec3(2, 64, 0), { isWaterlogged: true })
  let dug = false
  bot.dig = async () => { dug = true }
  await assert.rejects(createActions(bot).execute('dig_at', { x: 2, y: 64, z: 0 }), /waterlogged/)
  assert.equal(dug, false)
})

test('scoped pickup ignores unrelated drops and an empty target list does not move', async () => {
  const bot = fakeBot(), pursued = []
  for (let x=0;x<8;x++) for(let z=-1;z<=1;z++) bot.putBlock('dirt',new Vec3(x,63,z))
  bot.entities[10] = { id:10, name:'item', position:new Vec3(2.5,64,.5) }
  bot.entities[11] = { id:11, name:'item', position:new Vec3(5.5,64,.5) }
  bot.pathfinder.goto = async goal => { pursued.push(goal.x); bot.entity.position = new Vec3(goal.x+.5,goal.y,goal.z+.5); delete bot.entities[11]; bot.addItem('cobblestone') }
  const actions = createActions(bot)
  const empty = await actions.execute('pickup', { radius:8, entity_ids:[] })
  assert.deepEqual(empty.remaining_drops,[]); assert.equal(pursued.length,0)
  const result = await actions.execute('pickup', { radius:8, entity_ids:[11] })
  assert.deepEqual(pursued,[5]); assert.equal(result.inventory_changes.cobblestone,1); assert.ok(bot.entities[10]); assert.deepEqual(result.remaining_drops,[])
  for (const entity_ids of ['all',[-1],[1.5],Array(65).fill(1)]) await assert.rejects(actions.execute('pickup',{entity_ids}),/valid item ids/)
})

test('starter movement avoids water while ordinary direct movement keeps its original policy', async () => {
  const bot=fakeBot();let bounded=true,movement;
  bot.pathfinder.setMovements=value=>{movement=value}
  const actions=createActions(bot,{movementBoundary:()=>bounded?{center:{x:0,y:64,z:0},radius:20}:null})
  await actions.execute('go_to',{x:2,y:64,z:0,radius:0})
  assert.equal(movement.blocksToAvoid.has(registry.blocksByName.water.id),true)
  assert.equal(movement.blocksToAvoid.has(registry.blocksByName.bubble_column.id),true)
  bounded=false
  await actions.execute('go_to',{x:3,y:64,z:0,radius:0})
  assert.equal(movement.blocksToAvoid.has(registry.blocksByName.water.id),false)
  assert.equal(movement.blocksToAvoid.has(registry.blocksByName.lava.id),true)
})

test('actual starter neighbor generation rejects water, aquatic plants and waterlogged standing cells', async () => {
  const {default:loadBlock}=await import('prismarine-block'),{default:Move}=await import('mineflayer-pathfinder/lib/move.js')
  const Block=loadBlock('1.21.8')
  for(const name of ['water','bubble_column','kelp','kelp_plant','seagrass','tall_seagrass','oak_sign']) {
    const bot=fakeBot();let bounded=true,movement
    bot.blockAt=p=>{const q=p.floored(),column=q.x===1&&q.z===0&&(q.y===64||q.y===65);const b=Block.fromStateId(registry.blocksByName[q.y===63?'stone':column?name:'air'].defaultState,0);b.position=q;if(column&&name==='oak_sign')b.isWaterlogged=true;return b}
    bot.pathfinder.setMovements=value=>{movement=value}
    const actions=createActions(bot,{movementBoundary:()=>bounded?{center:{x:0,y:64,z:0},radius:20}:null})
    await actions.execute('go_to',{x:0,y:64,z:0,radius:0})
    const forward=()=>movement.getNeighbors(new Move(0,64,0,0,0)).some(p=>p.x===1&&p.y===64&&p.z===0)
    assert.equal(forward(),false,`${name} must not be a starter walking destination`)
    bounded=false;await actions.execute('go_to',{x:0,y:64,z:0,radius:0})
    assert.equal(forward(),true,`${name} retains the original direct-command movement policy`)
  }
})

test('craft chooses a visible nearby table instead of a closer obstructed one', async () => {
  const bot=fakeBot(),hidden=new Vec3(1,64,0),visible=new Vec3(3,64,0)
  bot.putBlock('crafting_table',hidden);bot.putBlock('crafting_table',visible)
  bot.canSeeBlock=block=>!block.position.equals(hidden)
  bot.recipesFor=(type,metadata,count,table)=>table?[{result:{count:1},requiresTable:true}]:[]
  bot.craft=async(recipe,count,table)=>{assert.ok(table.position.equals(visible));bot.addItem('wooden_pickaxe')}
  const result=await createActions(bot).execute('craft',{item:'wooden_pickaxe',count:1})
  assert.equal(result.crafted,1)
})

test('craft places a carried table locally when the nearby existing table is obstructed', async () => {
  const bot=fakeBot(),hidden=new Vec3(2,64,0)
  bot.putBlock('crafting_table',hidden);bot.addItem('crafting_table')
  for(let x=-3;x<=3;x++)for(let z=-3;z<=3;z++)bot.putBlock('stone',new Vec3(x,63,z))
  bot.canSeeBlock=block=>!block.position.equals(hidden)
  bot.recipesFor=(type,metadata,count,table)=>table?[{result:{count:1},requiresTable:true}]:[]
  bot.craft=async(recipe,count,table)=>{assert.ok(!table.position.equals(hidden));bot.addItem('wooden_pickaxe')}
  const result=await createActions(bot).execute('craft',{item:'wooden_pickaxe',count:1})
  assert.equal(result.crafted,1)
})

test('pickup accepts zero-shape snow cover but refuses raised snow as an integer standing cell', async () => {
 for(const raised of [false,true]) {
  const bot=fakeBot();
  for(let x=1;x<=3;x++)for(let z=-1;z<=1;z++) {
   bot.putBlock('dirt',new Vec3(x,63,z));
   bot.putBlock('snow',new Vec3(x,64,z),{boundingBox:'empty',shapes:raised?[[0,0,0,1,.125,1]]:[]});
  }
  bot.entities[99]={id:99,name:'item',position:new Vec3(2.5,64,.5)};
  let walked=0;
  bot.pathfinder.goto=async goal=>{walked++;bot.entity.position=new Vec3(goal.x+.5,goal.y,goal.z+.5);delete bot.entities[99];bot.addItem('cobblestone');};
  const result=await createActions(bot).execute('pickup',{radius:8,entity_ids:[99]});
  if(raised){assert.equal(walked,0);assert.deepEqual(result.inventory_changes,{});assert.equal(result.remaining_drops.length,1);}
  else{assert.equal(walked,1);assert.equal(result.inventory_changes.cobblestone,1);assert.equal(result.remaining_drops.length,0);}
 }
});

test('harvesting refuses an adjacent waterlogged block before digging',async()=>{
 const bot=fakeBot(),p=new Vec3(2,64,0);bot.putBlock('oak_log',p);bot.putBlock('oak_leaves',p.offset(1,0,0),{isWaterlogged:true});let dug=false;bot.dig=async()=>{dug=true;};
 await assert.rejects(createActions(bot).execute('dig_at',{x:p.x,y:p.y,z:p.z,expected_block:'oak_log'}),/adjacent liquid/);assert.equal(dug,false);
});

test('harvesting rejects water-bearing plants and bubble columns beside a target',async()=>{
 for(const name of ['kelp','kelp_plant','seagrass','tall_seagrass','bubble_column']) {
  const bot=fakeBot(),p=new Vec3(2,64,0);bot.putBlock('oak_log',p);bot.putBlock(name,p.offset(1,0,0),{isWaterlogged:false});let dug=false;bot.dig=async()=>{dug=true;};
  await assert.rejects(createActions(bot).execute('dig_at',{x:p.x,y:p.y,z:p.z,expected_block:'oak_log'}),/adjacent liquid/,name);assert.equal(dug,false,name);
 }
});

test('experimental descent refuses low health before touching terrain', async () => {
  const bot = fakeBot(); bot.health = 8;
  let digs = 0; bot.dig = async () => { digs++ };
  await assert.rejects(createActions(bot).execute('descend_notch', {}), /health 12/);
  assert.equal(digs, 0);
});

test('experimental descent refuses an ungrounded start without mining', async () => {
  const bot = fakeBot(); bot.food = 20; bot.entity.onGround = false;
  let digs = 0; bot.dig = async () => { digs++ };
  await assert.rejects(createActions(bot).execute('descend_notch', {}), /No certified/);
  assert.equal(digs, 0);
});

test('exploration alternatives certify before one move and report rejected directions', async () => {
  const bot=fakeBot();let moves=0;const go=bot.pathfinder.goto;
  bot.pathfinder.goto=async goal=>{moves++;return go(goal)};
  bot.pathfinder.getPathFromTo=function*(m,start,goal){yield{result:goal.z<0?{status:'noPath',path:[]}:{status:'success',path:[{x:goal.x,y:goal.y??64,z:goal.z}]}}};
  const result=await createActions(bot).execute('explore',{direction:'north',distance:12,returnable:true,alternatives:['east','south']});
  assert.equal(result.direction,'east');assert.deepEqual(result.directions_tried,['north','east']);assert.equal(moves,1);
  assert.equal(result.route_attempts[0].status,'unverified');
});
test('exploration cannot fall back after a partial physical walk fails', async () => {
  const bot=fakeBot();let moves=0;
  bot.pathfinder.goto=async()=>{moves++;bot.entity.position.x+=2;throw Error('Walking stalled')};
  await assert.rejects(createActions(bot).execute('explore',{direction:'north',distance:12,returnable:true,alternatives:['east']}),/Walking stalled/);
  assert.equal(moves,1);assert.equal(bot.entity.position.x,2.5);
});
test('exploration rejects malformed, duplicate or unguarded alternatives before movement', async () => {
  for(const args of [
    {direction:'north',returnable:false,alternatives:['east']},
    {direction:null,returnable:true,alternatives:['east']},
    {direction:'north',returnable:true,alternatives:['north']},
    {direction:'north',returnable:true,alternatives:['east','south','west','north']},
    {direction:'north',returnable:true,alternatives:['bogus']},
  ]){
    const bot=fakeBot();let moved=false;bot.pathfinder.goto=async()=>{moved=true};
    await assert.rejects(createActions(bot).execute('explore',{distance:12,...args}));assert.equal(moved,false);
  }
});
test('explicit returnable go_to rejects one-way route before movement', async () => {
  const bot=fakeBot();let plans=0,moved=false;
  bot.pathfinder.getPathFromTo=function*(m,start,goal){yield{result:++plans===1?{status:'success',path:[{x:goal.x,y:64,z:goal.z}]}:{status:'noPath',path:[]}}};
  bot.pathfinder.goto=async()=>{moved=true};
  await assert.rejects(createActions(bot).execute('go_to',{x:80,y:64,z:0,returnable:true}),/No verified returnable/);
  assert.equal(plans,2);assert.equal(moved,false);
});
test('verified long return leg remains bounded but is not cut off by the old15-second walk limit', async t => {
  let now=0;t.mock.method(performance,'now',()=>now);
  const bot=fakeBot();let release,started=false;
  bot.pathfinder.goto=goal=>new Promise(resolve=>{started=true;release=()=>{bot.entity.position=new Vec3(goal.x+0.5,goal.y,goal.z+0.5);resolve()}});
  const pending=createActions(bot).execute('go_to',{x:80,y:64,z:0,returnable:true});
  let finished=false;pending.then(()=>{finished=true},()=>{finished=true});
  while(!started)await new Promise(resolve=>setImmediate(resolve));
  now=20000;bot.entity.position.x=60;
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(finished,false);
  release();assert.equal((await pending).arrived,true);
});

test('starter neighbor generation refuses powder snow and restores direct movement policy', async () => {
  const {default:loadBlock}=await import('prismarine-block'),{default:Move}=await import('mineflayer-pathfinder/lib/move.js')
  const Block=loadBlock('1.21.8'),bot=fakeBot();let bounded=true,movement
  bot.blockAt=p=>{const q=p.floored(),column=q.x===1&&q.z===0&&(q.y===64||q.y===65);const b=Block.fromStateId(registry.blocksByName[q.y===63?'stone':column?'powder_snow':'air'].defaultState,0);b.position=q;return b}
  bot.pathfinder.setMovements=value=>{movement=value}
  const actions=createActions(bot,{movementBoundary:()=>bounded?{center:{x:0,y:64,z:0},radius:20}:null})
  await actions.execute('go_to',{x:0,y:64,z:0,radius:0})
  const forward=()=>movement.getNeighbors(new Move(0,64,0,0,0)).some(p=>p.x===1&&p.y===64&&p.z===0)
  assert.equal(forward(),false,'starter must not walk into freezing powder snow')
  bounded=false;await actions.execute('go_to',{x:0,y:64,z:0,radius:0})
  assert.equal(forward(),true,'ordinary direct commands retain their existing policy')
})

test('a single explicit returnable scout reports failed probe evidence without moving', async () => {
  const bot=fakeBot();let moves=0;
  bot.pathfinder.goto=async()=>{moves++};
  bot.pathfinder.getPathFromTo=function*(){yield{result:{status:'noPath',path:[]}}};
  await assert.rejects(createActions(bot).execute('explore',{direction:'west',distance:64,returnable:true}),error=>{
    assert.deepEqual(error.result.directions_tried,['west']);
    assert.equal(error.result.route_attempts.length,1);
    assert.equal(error.result.route_attempts[0].status,'unverified');return true;
  });
  assert.equal(moves,0);
});

test('collection yields partial progress and remaining drops when pickup time is spent', {timeout:5000}, async t => {
  const bot=fakeBot();let now=0,digs=0,pursuits=0;
  t.mock.method(performance,'now',()=>now);
  for(let x=0;x<8;x++)for(let z=-1;z<=1;z++)bot.putBlock('dirt',new Vec3(x,63,z));
  bot.putBlock('oak_log',new Vec3(2,64,0));bot.putBlock('oak_log',new Vec3(3,64,0));
  bot.dig=async block=>{digs++;bot.removeBlock(block.position);bot.addItem('oak_log');bot.entities[99]={id:99,name:'item',position:new Vec3(4.5,64,.5)}};
  bot.pathfinder.goto=async()=>{pursuits++;now+=8100};
  const actions=createActions(bot);
  const result=await actions.execute('collect',{block:'oak_log',count:2,radius:8});
  assert.equal(digs,1);assert.equal(pursuits,1);assert.equal(result.completed,false);
  assert.equal(result.pickup_limited,true);assert.equal(result.inventory_changes.oak_log,1);
  assert.deepEqual(result.remaining_drops.map(x=>x.id),[99]);
  assert.equal(bot.pathfinder.goal,null);
  bot.pathfinder.goto=async goal=>{pursuits++;bot.entity.position=new Vec3(goal.x+.5,goal.y??64,goal.z+.5);now+=100;delete bot.entities[99];bot.addItem('oak_log')};
  const next=await actions.execute('pickup',{radius:8,entity_ids:[99]});
  assert.equal(pursuits,2);assert.equal(next.pickup_limited,false);assert.equal(next.remaining_drops.length,0);
});

test('pickup allowance accumulates across multiple mining passes in one collection', async t => {
  const bot=fakeBot();let now=0,digs=0,pursuits=0;
  t.mock.method(performance,'now',()=>now);
  for(let x=0;x<8;x++)for(let z=-1;z<=1;z++)bot.putBlock('dirt',new Vec3(x,63,z));
  for(let x=2;x<=4;x++)bot.putBlock('oak_log',new Vec3(x,64,0));
  bot.dig=async block=>{digs++;bot.removeBlock(block.position);bot.entities[99]={id:99,name:'item',position:new Vec3(5.5,64,.5)}};
  bot.pathfinder.goto=async goal=>{pursuits++;bot.entity.position=new Vec3(goal.x+.5,goal.y??64,goal.z+.5);now+=4500;if(pursuits===1){delete bot.entities[99];bot.addItem('oak_log')}};
  const result=await createActions(bot).execute('collect',{block:'oak_log',count:3,radius:8});
  assert.equal(digs,2);assert.equal(pursuits,2);assert.equal(result.mined,2);
  assert.equal(result.completed,false);assert.equal(result.pickup_limited,true);
  assert.equal(result.inventory_changes.oak_log,1);assert.equal(result.remaining_drops[0].id,99);
});
test('cancelling pickup still rejects collection and cleans navigation rather than reporting success', async () => {
  const bot=fakeBot(),controller=new AbortController();let digs=0;
  for(let x=0;x<8;x++)for(let z=-1;z<=1;z++)bot.putBlock('dirt',new Vec3(x,63,z));
  bot.putBlock('oak_log',new Vec3(2,64,0));bot.putBlock('oak_log',new Vec3(3,64,0));
  bot.dig=async block=>{digs++;bot.removeBlock(block.position);bot.entities[99]={id:99,name:'item',position:new Vec3(5.5,64,.5)}};
  bot.pathfinder.goto=async()=>{controller.abort()};
  await assert.rejects(createActions(bot).execute('collect',{block:'oak_log',count:2,radius:8},controller.signal));
  assert.equal(digs,1);assert.equal(bot.pathfinder.goal,null);
  for(const event of ['entityGone','playerCollect','goal_reached','goal_updated','path_update'])assert.equal(bot.listenerCount(event),0,event);
});

test('collection discovers loaded diagonal-section stone within its original radius', async () => {
  const { realSectionSearch } = await import('./helpers/section-search.js')
  const bot = fakeBot()
  const target = new Vec3(-17, 64, -17)
  const block = bot.putBlock('stone', target)
  bot.findBlocks = realSectionSearch(bot, [block])
  assert.deepEqual(bot.findBlocks({ matching: block.type, maxDistance: 32, count: 512 }), [])
  bot.pathfinder.getPathFromTo = function * (movement, start, goal) {
    const p = goal.target ? goal.target.offset(1, 0, 0) : new Vec3(goal.x, goal.y, goal.z)
    yield { result: { status: 'success', path: [p] } }
  }
  bot.dig = async b => { assert.ok(b.position.equals(target)); bot.removeBlock(target); bot.addItem('cobblestone') }
  const result = await createActions(bot).execute('collect', { block: 'stone', count: 1, radius: 32 })
  assert.equal(result.completed, true)
  assert.equal(result.inventory_changes.cobblestone, 1)
})

test('expanded section search still refuses resources outside the requested sphere', async () => {
  const { realSectionSearch } = await import('./helpers/section-search.js')
  const bot = fakeBot()
  const target = new Vec3(-25, 64, -25)
  const block = bot.putBlock('stone', target)
  bot.findBlocks = realSectionSearch(bot, [block])
  let moved = false
  bot.pathfinder.goto = async () => { moved = true }
  await assert.rejects(createActions(bot).execute('collect', { block: 'stone', count: 1, radius: 32 }), /Could not collect/)
  assert.equal(moved, false)
})

test('automatic workstation placement cancels during look without sending a placement', async () => {
  const bot=fakeBot(),controller=new AbortController();let placed=0;
  bot.addItem('crafting_table');
  for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++)bot.putBlock('stone',new Vec3(x,63,z));
  bot.recipesFor=(type,metadata,count,table)=>table?[{result:{count:1},requiresTable:true}]:[];
  bot.lookAt=async()=>{controller.abort()};
  bot._placeBlockWithOptions=async()=>{placed++};
  await assert.rejects(createActions(bot).execute('craft',{item:'wooden_pickaxe',count:1},controller.signal),{name:'AbortError'});
  assert.equal(placed,0);assert.equal(bot.inventory.items().find(i=>i.name==='crafting_table').count,1);
});

test('automatic workstation rechecks terrain changed during its final look', async () => {
  const bot=fakeBot();let placed=0;
  bot.addItem('crafting_table');
  for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++)bot.putBlock('stone',new Vec3(x,63,z));
  bot.recipesFor=(type,metadata,count,table)=>table?[{result:{count:1},requiresTable:true}]:[];
  bot.lookAt=async()=>{for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++)if(x||z)bot.removeBlock(new Vec3(x,63,z))};
  bot._placeBlockWithOptions=async()=>{placed++};
  await assert.rejects(createActions(bot).execute('craft',{item:'wooden_pickaxe',count:1}),/No verified local exit/);
  assert.equal(placed,0);
});

function collectionPathFixture(bot) {
  bot.pathfinder.getPathFromTo = function * (movement,start,goal) {
    const p=goal.target ? goal.target.offset(-1,0,0) : new Vec3(goal.x,goal.y,goal.z)
    yield {result:{status:'success',path:[p]}}
  }
}
test('stationary mining vetoes do not starve a farther safe collection candidate',async()=>{
  const bot=fakeBot();collectionPathFixture(bot)
  for(const x of [2,3])for(const z of [-2,-1,0,1]){const p=new Vec3(x,64,z);bot.putBlock('stone',p);bot.putBlock('water',p.offset(0,1,0))}
  const safe=new Vec3(14,64,0);bot.putBlock('stone',safe)
  bot.dig=async block=>{assert.ok(block.position.equals(safe));bot.removeBlock(safe);bot.addItem('cobblestone')}
  const result=await createActions(bot).execute('collect',{block:'stone',count:1,radius:24})
  assert.equal(result.mined,1);assert.equal(result.failures.length,0)
})
test('collection rejects static hazards before walking and retries after their removal',async()=>{
  for(const hazard of ['waterlogged','liquid','falling','unloaded']){
    const bot=fakeBot(),p=new Vec3(12,64,0);collectionPathFixture(bot)
    bot.putBlock('stone',p,{isWaterlogged:hazard==='waterlogged'})
    if(hazard==='liquid')bot.putBlock('water',p.offset(0,1,0))
    if(hazard==='falling')bot.putBlock('gravel',p.offset(0,1,0))
    const original=bot.blockAt;let unloaded=hazard==='unloaded'
    bot.blockAt=q=>unloaded&&q.equals(p.offset(0,1,0))?null:original(q)
    let walks=0;const old=bot.pathfinder.getPathFromTo;bot.pathfinder.getPathFromTo=function*(...a){walks++;yield*old(...a)}
    const actions=createActions(bot);await assert.rejects(actions.execute('collect',{block:'stone',count:1,radius:24}),/Could not collect/)
    assert.equal(walks,0,`do not plan a route to ${hazard}`)
    unloaded=false;bot.putBlock('stone',p);bot.removeBlock(p.offset(0,1,0))
    bot.dig=async block=>{bot.removeBlock(block.position);bot.addItem('cobblestone')}
    assert.equal((await actions.execute('collect',{block:'stone',count:1,radius:24})).mined,1)
  }
})
test('fresh mining checks reject liquid appearing while equipping a tool',async()=>{
  const bot=fakeBot(),p=new Vec3(2,64,0);bot.putBlock('stone',p)
  const tool=bot.addItem('wooden_pickaxe');bot.pathfinder.bestHarvestTool=()=>tool
  bot.equip=async item=>{bot.heldItem=item;bot.putBlock('water',p.offset(0,1,0))}
  let dug=false;bot.dig=async()=>{dug=true;bot.removeBlock(p)}
  await assert.rejects(createActions(bot).execute('dig_at',{x:2,y:64,z:0}),/adjacent liquid/)
  assert.equal(dug,false)
})
test('real Mineflayer search filters unsafe resources before the 512-candidate cap',async()=>{
  const {realSectionSearch}=await import('./helpers/section-search.js')
  const bot=fakeBot();collectionPathFixture(bot);const stones=[]
  for(let x=2;x<=15;x++)for(let z=0;z<=15;z++)for(const y of [64,66,68]){
    const p=new Vec3(x,y,z);stones.push(bot.putBlock('stone',p));bot.putBlock('water',p.offset(0,1,0))
  }
  const safe=new Vec3(40,64,0);stones.push(bot.putBlock('stone',safe))
  bot.findBlocks=realSectionSearch(bot,stones)
  const unfiltered=bot.findBlocks({matching:registry.blocksByName.stone.id,maxDistance:64,count:512})
  assert.equal(unfiltered.length,512);assert.equal(unfiltered.some(p=>p.equals(safe)),false)
  bot.dig=async block=>{assert.ok(block.position.equals(safe));bot.removeBlock(safe);bot.addItem('cobblestone')}
  const result=await createActions(bot).execute('collect',{block:'stone',count:1,radius:64})
  assert.equal(result.mined,1);assert.equal(result.failures.length,0);assert.equal(result.search_limited,false)
})

test('mining rechecks terrain after looking and sends no dig when a fluid arrives',async()=>{
  const bot=fakeBot(),p=new Vec3(2,64,0);bot.putBlock('stone',p)
  let digs=0,looks=0
  bot.lookAt=async()=>{looks++;bot.putBlock('water',p.offset(0,1,0))}
  bot.dig=async(block,forceLook)=>{if(forceLook!=='ignore')await bot.lookAt();digs++;bot.removeBlock(block.position)}
  await assert.rejects(createActions(bot).execute('dig_at',{x:2,y:64,z:0}),/adjacent liquid/)
  assert.equal(looks,1);assert.equal(digs,0)
})
test('cancellation during mining look never sends a dig request',async()=>{
  const bot=fakeBot(),p=new Vec3(2,64,0),controller=new AbortController();bot.putBlock('stone',p)
  let digs=0;bot.lookAt=async()=>{controller.abort()}
  bot.dig=async(block,forceLook)=>{if(forceLook!=='ignore')await bot.lookAt();digs++;bot.removeBlock(block.position)}
  await assert.rejects(createActions(bot).execute('dig_at',{x:2,y:64,z:0},controller.signal),{name:'AbortError'})
  assert.equal(digs,0)
})

test('final mining check sees a replaced target, changed footing, or changed tool after look',async()=>{
  for(const change of ['target','footing','tool']){
    const bot=fakeBot(),p=new Vec3(2,64,0),pick=bot.addItem('wooden_pickaxe')
    bot.putBlock('stone',p,{canHarvest:type=>type===pick.type});bot.pathfinder.bestHarvestTool=()=>pick
    bot.lookAt=async()=>{
      if(change==='target')bot.putBlock('iron_ore',p)
      if(change==='footing')bot.entity.position=new Vec3(2.5,65,.5)
      if(change==='tool')bot.heldItem=null
    }
    let digs=0;bot.dig=async()=>{digs++}
    await assert.rejects(createActions(bot).execute('dig_at',{x:2,y:64,z:0}),/changed before mining|supporting the bot|suitable tool/)
    assert.equal(digs,0,change)
  }
})
test('dig_at cannot claim completion from disappeared drops at an ungrounded ending',async()=>{
 const bot=fakeBot(),p=new Vec3(2,64,0);bot.putBlock('stone',p);
 bot.dig=async()=>{bot.removeBlock(p);bot.addItem('cobblestone');bot.entity.onGround=false};
 await assert.rejects(createActions(bot).execute('dig_at',{x:2,y:64,z:0}),e=>e.code==='PICKUP_UNSAFE_SETTLEMENT'&&e.result.inventory_changes.cobblestone===1);
});
test('collect does not mine another block after an unsafe pickup ending',async()=>{
 const bot=fakeBot();bot.putBlock('stone',new Vec3(2,64,0));bot.putBlock('stone',new Vec3(3,64,0));let mined=0;
 bot.dig=async block=>{mined++;bot.removeBlock(block.position);bot.addItem('cobblestone');bot.entity.onGround=false};
 await assert.rejects(createActions(bot).execute('collect',{block:'stone',count:2,radius:8}),e=>e.code==='PICKUP_UNSAFE_SETTLEMENT');assert.equal(mined,1);
});

test('collect retains an earlier failed pickup reason across a final empty pass',async()=>{
 const bot=fakeBot(),p=new Vec3(2,64,0);bot.putBlock('stone',p);bot.putBlock('dirt',new Vec3(2,63,0));
 bot.dig=async()=>{bot.removeBlock(p);bot.entities[77]={id:77,name:'item',position:new Vec3(2.5,64,.5)}};
 bot.pathfinder.goto=async()=>{delete bot.entities[77];throw new Error('Recorded pickup walk failure')};
 const result=await createActions(bot).execute('collect',{block:'stone',count:1,radius:8});
 assert.equal(result.completed,false);assert.equal(result.pickup_pursuit_unverified,true);
 assert.equal(result.pickup_landing_verified,false);assert.equal(result.remaining_drops.length,0);
 assert.ok(result.pickup_failures.some(f=>/Pickup navigation noPath/.test(f.error)));
});

test('one physical collect action shares the three-attempt limit for a persistent unreachable drop',async()=>{
 const bot=fakeBot();bot.putBlock('stone',new Vec3(2,64,0));bot.putBlock('stone',new Vec3(3,64,0));bot.putBlock('dirt',new Vec3(2,63,0));let attempts=0;
 bot.dig=async block=>{bot.removeBlock(block.position);bot.addItem('cobblestone');bot.entities[77]={id:77,name:'item',position:new Vec3(2.5,64,.5)}};
 bot.pathfinder.getPathFromTo=function*(){attempts++;yield{result:{status:'noPath',path:[]}}};
 const actions=createActions(bot);const result=await actions.execute('collect',{block:'stone',count:2,radius:8});
 assert.equal(result.mined,2);assert.equal(result.remaining_drops[0].id,77);assert.equal(result.completed,false);assert.equal(attempts,3);
 await actions.execute('pickup',{radius:8});assert.equal(attempts,4,'a fresh physical action retries the sole distinct destination once');
});

test('failed pickup can observe dry passive landing without claiming arrival or continuing mining',async()=>{
 const bot=fakeBot();for(const x of [2,3])bot.putBlock('stone',new Vec3(x,64,0));bot.putBlock('dirt',new Vec3(2,63,0));let digs=0,walks=0;
 bot.dig=async block=>{digs++;bot.removeBlock(block.position);bot.addItem('cobblestone');bot.entities[77]={id:77,name:'item',position:new Vec3(2.5,64,.5)}};
 bot.pathfinder.goto=async()=>{
  walks++;bot.entity.onGround=false;bot.entity.velocity=new Vec3(0,-.4,0);
  setTimeout(()=>{bot.entity.onGround=true;bot.entity.velocity.y=0;delete bot.entities[77];bot.emit('physicsTick');setTimeout(()=>bot.emit('physicsTick'),20)},20);
  throw Error('Path failed during descent');
 };
 const result=await createActions(bot).execute('collect',{block:'stone',count:2,radius:8});
 assert.equal(result.completed,false);assert.equal(result.passive_settlement,true);assert.equal(result.pickup_landing_verified,false);
 assert.equal(digs,1);assert.equal(walks,1);assert.equal(result.inventory_changes.cobblestone,1);assert.equal(result.remaining_drops.length,0);
 assert.ok(result.pickup_failures.length);assert.equal(bot.listenerCount('physicsTick'),0);
});
test('failed passive verification stays fatal even if grounded state changes without fresh samples',async()=>{
 const bot=fakeBot();bot.putBlock('stone',new Vec3(2,64,0));bot.putBlock('dirt',new Vec3(2,63,0));let digs=0,walks=0;
 bot.dig=async block=>{digs++;bot.removeBlock(block.position);bot.entities[77]={id:77,name:'item',position:new Vec3(2.5,64,.5)}};
 bot.pathfinder.goto=async()=>{walks++;bot.entity.onGround=false;bot.entity.velocity=new Vec3(0,-.4,0);setTimeout(()=>{bot.entity.onGround=true;bot.entity.velocity.y=0;delete bot.entities[77]},20);throw Error('No verified landing')};
 await assert.rejects(createActions(bot).execute('collect',{block:'stone',count:1,radius:8}),{code:'PICKUP_UNSAFE_SETTLEMENT'});assert.equal(digs,1);assert.equal(walks,1);
});

test('starter-only deferral records implicit pickup failures, retains drops and allows direct retry',async()=>{
 const bot=fakeBot();for(const x of [2,3])bot.putBlock('stone',new Vec3(x,64,0));bot.putBlock('dirt',new Vec3(2,63,0));let attempts=0;
 const item={id:77,name:'item',position:new Vec3(2.5,64,.5)};
 bot.dig=async block=>{bot.removeBlock(block.position);bot.addItem('cobblestone');bot.entities[77]=item};
 bot.pathfinder.getPathFromTo=function*(){attempts++;yield{result:{status:'noPath',path:[]}}};
 const actions=createActions(bot),context={starterScope:'job/1'};
 await actions.execute('collect',{block:'stone',count:1,radius:8},undefined,context);assert.equal(attempts,3);
 const result=await actions.execute('pickup',{radius:8},undefined,context);
 assert.equal(attempts,3);assert.equal(result.remaining_drops[0].id,77);assert.equal(result.deferred_drops[0].id,77);
 await actions.execute('pickup',{radius:8});assert.equal(attempts,5,'direct retry tests both distinct cells without duplicating one');
});
test('starter cache bookkeeping read errors cannot bypass an unsafe pickup ending',async()=>{
 const bot=fakeBot();for(const x of [2,3])bot.putBlock('stone',new Vec3(x,64,0));bot.putBlock('dirt',new Vec3(2,63,0));let digs=0,walks=0,failRead=false;
 const read=bot.blockAt;bot.blockAt=p=>{if(failRead){failRead=false;throw Error('Transient cache read failure')}return read(p)};
 const item={id:77,name:'item',position:new Vec3(2.5,64,.5)};
 bot.dig=async block=>{digs++;bot.removeBlock(block.position);bot.addItem('cobblestone');bot.entities[77]=item};
 bot.pathfinder.goto=async goal=>{walks++;if(walks===1){bot.entity.onGround=false;bot.entity.velocity=new Vec3(0,-.4,0);failRead=true;throw Error('Failed while falling')}bot.entity.onGround=true;bot.entity.position=new Vec3(goal.x+.5,goal.y,goal.z+.5);delete bot.entities[77]};
 await assert.rejects(createActions(bot).execute('collect',{block:'stone',count:2,radius:8},undefined,{starterScope:'job/1'}),{code:'PICKUP_UNSAFE_SETTLEMENT'});
 assert.equal(digs,1);assert.equal(walks,1);
});

test('unchanged failed collection approaches reuse one bounded candidate scan', async () => {
  const bot = fakeBot()
  for (let x = 8; x < 16; x++) bot.putBlock('stone', new Vec3(x, 64, 0))
  let scans = 0, digs = 0
  const find = bot.findBlocks
  bot.findBlocks = options => { scans++; return find(options) }
  bot.pathfinder.getPathFromTo = function * () { yield { result: { status: 'noPath', path: [] } } }
  bot.dig = async () => { digs++ }
  const start = bot.entity.position.clone()
  await assert.rejects(createActions(bot).execute('collect', { block: 'stone', count: 1, radius: 24 }), error => {
    assert.equal(error.result.failures.length, 8)
    assert.equal(new Set(error.result.failures.map(f => JSON.stringify(f.position))).size, 8)
    assert.equal(error.result.search_scans, 1)
    assert.equal(error.result.search_reuses, 7)
    return true
  })
  assert.equal(scans, 1)
  assert.equal(digs, 0)
  assert.ok(bot.entity.position.equals(start))
  for (const event of ['blockUpdate', 'chunkColumnLoad', 'chunkColumnUnload', 'physicsTick']) assert.equal(bot.listenerCount(event), 0)
})

test('collection candidate reuse invalidates on observed world changes or movement', async () => {
  for (const change of ['blockUpdate', 'chunkColumnLoad', 'chunkColumnUnload', 'position', 'dimension', 'roundTrip']) {
    const bot = fakeBot()
    for (let x = 8; x < 16; x++) bot.putBlock('stone', new Vec3(x, 64, 0))
    let scans = 0, probes = 0
    const find = bot.findBlocks
    bot.findBlocks = options => { scans++; return find(options) }
    bot.pathfinder.getPathFromTo = function * () {
      if (++probes === 1) {
        if (change === 'position') bot.entity.position.x += .2
        else if (change === 'dimension') bot.game.dimension = 'the_nether'
        else if (change === 'roundTrip') {
          bot.entity.position.x += .2; bot.emit('physicsTick'); bot.entity.position.x -= .2
        } else bot.emit(change)
      }
      yield { result: { status: 'noPath', path: [] } }
    }
    const pending=createActions(bot).execute('collect', { block: 'stone', count: 1, radius: 24 })
    if(change==='dimension'){
      await assert.rejects(pending,/play session changed/)
      assert.equal(scans,1);assert.equal(probes,1)
    }else{
      await assert.rejects(pending)
      assert.ok(scans >= 2, change)
    }
    for (const event of ['blockUpdate', 'chunkColumnLoad', 'chunkColumnUnload', 'physicsTick']) assert.equal(bot.listenerCount(event), 0, change)
  }
})

test('successful mining refreshes collection search and cancellation releases its observers', async () => {
  const bot = fakeBot()
  bot.putBlock('stone', new Vec3(2, 64, 0))
  let scans = 0, digs = 0
  const find = bot.findBlocks
  bot.findBlocks = options => { scans++; return find(options) }
  bot.dig = async block => {
    bot.removeBlock(block.position); bot.addItem('cobblestone'); digs++
    if (digs === 1) bot.putBlock('stone', new Vec3(3, 64, 0))
  }
  const result = await createActions(bot).execute('collect', { block: 'stone', count: 2, radius: 8 })
  assert.equal(result.mined, 2)
  assert.equal(scans, 2)
  assert.equal(result.search_reuses, 0)
  const other = fakeBot(), controller = new AbortController()
  other.findBlocks = options => { controller.abort(); options.useExtraInfo({ position: new Vec3(2, 64, 0) }) }
  await assert.rejects(createActions(other).execute('collect', { block: 'stone', count: 1, radius: 8 }, controller.signal), { name: 'AbortError' })
  for (const event of ['blockUpdate', 'chunkColumnLoad', 'chunkColumnUnload', 'physicsTick']) assert.equal(other.listenerCount(event), 0)
})

test('cached collection candidates recheck liquid hazards before any approach', async () => {
  const bot = fakeBot()
  for (const x of [8, 10, 12]) bot.putBlock('stone', new Vec3(x, 64, 0))
  let probes = 0
  bot.pathfinder.getPathFromTo = function * () {
    if (++probes === 1) bot.putBlock('water', new Vec3(10, 64, 1)) // Even without an update event.
    yield { result: { status: 'noPath', path: [] } }
  }
  await assert.rejects(createActions(bot).execute('collect', { block: 'stone', count: 1, radius: 24 }), error => {
    assert.deepEqual(error.result.failures.map(f => f.position.x), [8, 12])
    assert.ok(error.result.search_reuses > 0)
    return true
  })
})

test('cached collection preserves ranked alternatives beyond the scan iteration prefix', async () => {
  const bot = fakeBot(), blocks = []
  for (let x = 20; x < 52; x++) for (let z = 0; z < 16; z++) blocks.push(bot.putBlock('stone', new Vec3(x, 64, z)))
  blocks.push(bot.putBlock('stone', new Vec3(8, 64, 0)), bot.putBlock('stone', new Vec3(10, 64, 0)))
  bot.findBlocks = options => { for (const block of blocks) options.useExtraInfo(block); return [] }
  bot.pathfinder.getPathFromTo = function * () { yield { result: { status: 'noPath', path: [] } } }
  await assert.rejects(createActions(bot).execute('collect', { block: 'stone', count: 1, radius: 64 }), error => {
    assert.deepEqual(error.result.failures.slice(0, 2).map(f => f.position.x), [8, 10])
    assert.equal(error.result.search_scans, 1)
    return true
  })
})

test('workstation recovery classification excludes ingredient and unrelated placement failures',async()=>{
 for(const mode of ['no-space','ingredients','other-placement']){
  const bot=fakeBot();bot.addItem('crafting_table');
  if(mode==='other-placement')for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++)bot.putBlock('stone',new Vec3(x,63,z));
  bot.recipesFor=(type,metadata,count,table)=>mode!=='ingredients'&&table?[{result:{count:1},requiresTable:true}]:[];
  bot._placeBlockWithOptions=async()=>{throw Error('Unrelated placement failure')};
  await assert.rejects(createActions(bot).execute('craft',{item:'wooden_pickaxe',count:1}),error=>{
   if(mode==='no-space'){assert.equal(error.code,'WORKSTATION_EGRESS_UNVERIFIED');assert.equal(error.workstation,'crafting_table')}
   else assert.notEqual(error.code,'WORKSTATION_EGRESS_UNVERIFIED',mode);
   return true;
  });
 }
});

test('distant block updates do not discard unchanged untried collection candidates',async()=>{
 const bot=fakeBot();for(let x=8;x<16;x++)bot.putBlock('stone',new Vec3(x,64,0));let scans=0;
 const find=bot.findBlocks;bot.findBlocks=options=>{scans++;return find(options)};
 bot.pathfinder.getPathFromTo=function*(){
  bot.emit('blockUpdate',{position:new Vec3(1000,64,0),name:'dirt'},{position:new Vec3(1000,64,0),name:'grass_block'});
  yield{result:{status:'noPath',path:[]}};
 };
 await assert.rejects(createActions(bot).execute('collect',{block:'stone',count:1,radius:24}),error=>{
  assert.equal(error.result.failures.length,8);assert.equal(error.result.search_scans,1);assert.equal(error.result.search_reuses,7);return true;
 });assert.equal(scans,1);
});

test('collection cache refreshes for local dependency updates and unknown event geometry',async()=>{
 for(const positions of [[new Vec3(26,64,0),new Vec3(26,64,0)],[new Vec3(1000,64,0),new Vec3(8,64,0)],[new Vec3(8,64,0),new Vec3(1000,64,0)],[null,new Vec3(1000,64,0)]]){
  const bot=fakeBot();for(let x=8;x<16;x++)bot.putBlock('stone',new Vec3(x,64,0));
  bot.pathfinder.getPathFromTo=function*(){bot.emit('blockUpdate',...positions.map(position=>position?{position}:null));yield{result:{status:'noPath',path:[]}}};
  await assert.rejects(createActions(bot).execute('collect',{block:'stone',count:1,radius:24}),error=>{
   assert.equal(error.result.failures.length,8);assert.equal(error.result.search_scans,8);assert.equal(error.result.search_reuses,0);return true;
  });assert.equal(bot.listenerCount('blockUpdate'),0);
 }
});

test('a local update refreshes collection choices to include a newly exposed nearer target',async()=>{
 const bot=fakeBot();for(let x=8;x<16;x++)bot.putBlock('stone',new Vec3(x,64,0));let updated=false;
 bot.pathfinder.getPathFromTo=function*(){
  if(!updated){updated=true;const position=new Vec3(7,64,0);bot.putBlock('stone',position);bot.emit('blockUpdate',{position,name:'air'},bot.blockAt(position));}
  yield{result:{status:'noPath',path:[]}};
 };
 await assert.rejects(createActions(bot).execute('collect',{block:'stone',count:1,radius:24}),error=>{
  assert.deepEqual(error.result.failures.slice(0,2).map(f=>f.position.x),[8,7]);assert.equal(error.result.search_scans,2);return true;
 });
});

test('workstation placement rejects a changed held item after its final look',async()=>{
 const bot=fakeBot();let packets=0;bot.addItem('crafting_table');const wrong=bot.addItem('stone');
 for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++)bot.putBlock('stone',new Vec3(x,63,z));
 bot.recipesFor=(type,metadata,count,table)=>table?[{result:{count:1},requiresTable:true}]:[];
 bot.lookAt=async()=>{bot.heldItem=wrong};bot._placeBlockWithOptions=async()=>{packets++};
 await assert.rejects(createActions(bot).execute('craft',{item:'wooden_pickaxe',count:1}));assert.equal(packets,0);
});

test('ordinary placement checks held-item identity after aiming and avoids a hidden look race',async()=>{
 const bot=fakeBot();bot.addItem('oak_planks');const wrong=bot.addItem('stone');bot.putBlock('dirt',new Vec3(2,63,0));let packets=0;
 bot.lookAt=async()=>{bot.heldItem=wrong};
 bot.placeBlock=async()=>{await bot.lookAt();packets++};
 bot._placeBlockWithOptions=async(reference,face,options)=>{if(options.forceLook!=='ignore')await bot.lookAt();packets++};
 await assert.rejects(createActions(bot).execute('place',{block:'oak_planks',x:2,y:64,z:0}));assert.equal(packets,0);
});

test('ordinary placement uses one explicit aim and refuses an emptied held stack',async()=>{
 for(const emptied of [false,true]){
  const bot=fakeBot();bot.addItem('oak_planks');bot.putBlock('dirt',new Vec3(2,63,0));let aims=0,packets=0;
  bot.lookAt=async()=>{aims++;if(emptied)bot.heldItem.count=0};
  bot.placeBlock=async()=>{throw Error('Hidden-look placement path must not be used')};
  bot._placeBlockWithOptions=async(reference,face,options)=>{assert.equal(options.forceLook,'ignore');packets++;bot.putBlock(bot.heldItem.name,reference.position.plus(face))};
  const result=createActions(bot).execute('place',{block:'oak_planks',x:2,y:64,z:0});
  if(emptied){await assert.rejects(result,/Held placement item changed/);assert.equal(packets,0)}
  else{assert.equal((await result).placed,true);assert.equal(packets,1)}
  assert.equal(aims,1);
 }
});

test('grounded arrival without collecting a lingering drop does not reset starter retry history',async()=>{
 const bot=fakeBot();for(let x=-2;x<=5;x++)for(let z=-2;z<=2;z++)bot.putBlock('stone',new Vec3(x,63,z));
 const item={id:91,name:'item',position:new Vec3(2.5,64,.5)};bot.entities[91]=item;let walks=0;
 bot.pathfinder.goto=async goal=>{walks++;bot.entity.position=new Vec3(goal.x+.5,goal.y,goal.z+.5)};
 const actions=createActions(bot),context={starterScope:'job/1'};
 const first=await actions.execute('pickup',{radius:8},undefined,context);
 assert.equal(first.remaining_drops.length,1);assert.equal(first.landing_verified,true);assert.equal(walks,3);
 const second=await actions.execute('pickup',{radius:8},undefined,context);
 assert.equal(walks,3);assert.equal(second.deferred_drops[0].id,91);
 assert.deepEqual(second.inventory_changes,{});
 await actions.execute('pickup',{radius:8});assert.equal(walks,6);
});

test('unrelated inventory gains preserve a lingering target retry record without clearing it',async()=>{
 const bot=fakeBot();for(let x=-2;x<=5;x++)for(let z=-2;z<=2;z++)bot.putBlock('stone',new Vec3(x,63,z));
 const item={id:91,name:'item',position:new Vec3(2.5,64,.5)};bot.entities[91]=item;let probes=0,walks=0;
 bot.pathfinder.getPathFromTo=function*(movement,start,goal){if(++probes<=2)yield{result:{status:'noPath',path:[]}};else yield{result:{status:'success',path:[{x:goal.x,y:goal.y,z:goal.z}]}}};
 bot.pathfinder.goto=async goal=>{walks++;bot.entity.position=new Vec3(goal.x+.5,goal.y,goal.z+.5);if(walks===1)bot.addItem('dirt')};
 const actions=createActions(bot),context={starterScope:'job/1'};
 await actions.execute('pickup',{radius:8},undefined,context);assert.equal(walks,1);
 const second=await actions.execute('pickup',{radius:8},undefined,context);
 assert.equal(walks,2);assert.equal(second.deferred_drops[0].id,91);assert.equal(bot.listenerCount('playerCollect'),0);
});

test('target collection during the bounded grace period is not counted as no progress',async()=>{
 const bot=fakeBot();for(let x=-2;x<=5;x++)for(let z=-2;z<=2;z++)bot.putBlock('stone',new Vec3(x,63,z));
 const item={id:91,name:'item',position:new Vec3(2.5,64,.5)};bot.entities[91]=item;
 bot.pathfinder.goto=async goal=>{bot.entity.position=new Vec3(goal.x+.5,goal.y,goal.z+.5);setTimeout(()=>bot.emit('playerCollect',bot.entity,item),10)};
 const result=await createActions(bot).execute('pickup',{radius:8},undefined,{starterScope:'job/1'});
 assert.deepEqual(result.deferred_drops,[]);assert.ok(!result.unreachable.some(f=>f.code==='PICKUP_NO_COLLECTION_PROGRESS'));assert.equal(bot.listenerCount('playerCollect'),0);
});

test('two failed destinations and an unproductive arrival defer the same target while preserving landing proof',async()=>{
 const bot=fakeBot();for(let x=-2;x<=5;x++)for(let z=-2;z<=2;z++)bot.putBlock('stone',new Vec3(x,63,z));
 const item={id:91,name:'item',position:new Vec3(2.5,64,.5)};bot.entities[91]=item;let probes=0,walks=0;
 bot.pathfinder.getPathFromTo=function*(movement,start,goal){if(++probes<=2)yield{result:{status:'noPath',path:[]}};else yield{result:{status:'success',path:[{x:goal.x,y:goal.y,z:goal.z}]}}};
 bot.pathfinder.goto=async goal=>{walks++;bot.entity.position=new Vec3(goal.x+.5,goal.y,goal.z+.5)};
 const actions=createActions(bot),context={starterScope:'job/1'};
 const result=await actions.execute('pickup',{radius:8},undefined,context);
 assert.equal(result.deferred_drops[0].failures,3);assert.equal(result.landing_verified,true);assert.equal(result.pursuit_unverified,false);
 assert.equal(result.unreachable.at(-1).code,'PICKUP_NO_COLLECTION_PROGRESS');
 await actions.execute('pickup',{radius:8},undefined,context);assert.equal(walks,1);
});

test('late target disappearance during pickup grace clears remaining work without a no-progress record',async()=>{
 const bot=fakeBot();for(let x=-2;x<=5;x++)for(let z=-2;z<=2;z++)bot.putBlock('stone',new Vec3(x,63,z));
 const item={id:91,name:'item',position:new Vec3(2.5,64,.5)};bot.entities[91]=item;
 bot.pathfinder.goto=async goal=>{bot.entity.position=new Vec3(goal.x+.5,goal.y,goal.z+.5);setTimeout(()=>{delete bot.entities[91];bot.emit('entityGone',item)},10)};
 const result=await createActions(bot).execute('pickup',{radius:8},undefined,{starterScope:'job/1'});
 assert.deepEqual(result.remaining_drops,[]);assert.deepEqual(result.unreachable,[]);assert.equal(bot.listenerCount('playerCollect'),0);
});

test('aborting pickup during grace removes the target collection listener',async()=>{
 const bot=fakeBot(),controller=new AbortController();for(let x=-2;x<=5;x++)for(let z=-2;z<=2;z++)bot.putBlock('stone',new Vec3(x,63,z));
 bot.entities[91]={id:91,name:'item',position:new Vec3(2.5,64,.5)};
 bot.pathfinder.goto=async goal=>{bot.entity.position=new Vec3(goal.x+.5,goal.y,goal.z+.5);setTimeout(()=>controller.abort(),10)};
 await assert.rejects(createActions(bot).execute('pickup',{radius:8},controller.signal,{starterScope:'job/1'}),{name:'AbortError'});
 assert.equal(bot.listenerCount('playerCollect'),0);
});

test('unconfirmed local mining halts collection before another candidate or pickup and blocks reuse', async () => {
  const bot = fakeBot(); let digs=0, movesAfterDig=0;
  for (let x=0;x<7;x++) for(let z=-1;z<=1;z++) bot.putBlock('stone',new Vec3(x,63,z));
  bot.putBlock('oak_log',new Vec3(2,64,0));bot.putBlock('oak_log',new Vec3(3,64,0));
  const move=bot.pathfinder.goto;
  bot.pathfinder.goto=async goal=>{if(digs)movesAfterDig++;return move(goal);};
  bot.dig=async block=>{digs++;bot.putBlock('air',block.position);bot.entities[99]={id:99,name:'item',position:new Vec3(4.5,64,.5)};};
  const actions=createActions(bot);
  await assert.rejects(actions.execute('collect',{block:'oak_log',count:2,radius:8}),{code:'TERRAIN_UNTRUSTED'});
  assert.equal(digs,1);assert.equal(movesAfterDig,0);
  await assert.rejects(actions.execute('inspect',{radius:1}),{code:'TERRAIN_UNTRUSTED'});
  await assert.rejects(createActions(bot).execute('go_to',{x:1,y:64,z:0,radius:0}),{code:'TERRAIN_UNTRUSTED'});
  assert.throws(()=>actions.snapshot(),{code:'TERRAIN_UNTRUSTED'});
});

test('mining waits for delayed raw server confirmation before reporting the mined block', async () => {
  const bot=fakeBot(),p=new Vec3(2,64,0);let confirmed=false;
  bot.putBlock('oak_log',p);
  bot.dig=async()=>{bot.putBlock('air',p);setTimeout(()=>{confirmed=true;bot._client.emit('packet',{location:p,type:0},{name:'block_change'});},30);};
  const result=await createActions(bot).execute('dig_at',{x:2,y:64,z:0});
  assert.equal(confirmed,true);assert.equal(result.mined,1);
  assert.deepEqual(result.inventory_changes,{});
});

test('unsupported mining protocol never sends a dig or poisons otherwise usable actions', async () => {
  const bot=fakeBot();bot.version='1.21.11';let digs=0;
  bot.putBlock('oak_log',new Vec3(2,64,0));bot.dig=async()=>{digs++;};
  const actions=createActions(bot);
  await assert.rejects(actions.execute('dig_at',{x:2,y:64,z:0}),/1.21.8 only/);
  assert.equal(digs,0);assert.equal((await actions.execute('inspect',{radius:1})).connected,true);
});

test('starter protects a new current leaf footprint between harvests inside one collection action', async () => {
  const bot=fakeBot();bot.entity.position=new Vec3(3.5,64,.5);
  for(let x=0;x<=12;x++)for(let z=-1;z<=1;z++)bot.putBlock('stone',new Vec3(x,63,z));
  bot.putBlock('oak_leaves',new Vec3(0,63,0));bot.putBlock('oak_leaves',new Vec3(1,63,0));
  bot.putBlock('oak_log',new Vec3(2,63,0));bot.putBlock('oak_log',new Vec3(4,64,0));
  const mined=[];bot.dig=async block=>{mined.push(block.position.x);bot.removeBlock(block.position);bot.addItem('oak_log');bot.entity.position=new Vec3(.5,64,.5);};
  const actions=createActions(bot,{movementBoundary:()=>({center:{x:10.5,y:64,z:.5},radius:256})});
  const result=await actions.execute('collect',{block:'oak_log',count:2,radius:8},undefined,{starterScope:'job/support'});
  assert.deepEqual(mined,[4]);assert.equal(result.mined,1);assert.equal(result.completed,false);
  assert.ok(result.failures.some(f=>f.code==='STARTER_SUPPORT_PROTECTED'));
  assert.equal(bot.blockAt(new Vec3(2,63,0)).name,'oak_log');
});

test('starter anchor proof is repeated after equip and aim without quarantining a refused preflight', async () => {
  for(const phase of ['equip','look']){
    const bot=fakeBot();bot.entity.position=new Vec3(3.5,64,.5);bot.addItem('wooden_axe');
    for(let x=0;x<5;x++)for(let z=-1;z<3;z++)bot.putBlock('stone',new Vec3(x,63,z));
    for(const p of [new Vec3(0,63,0),new Vec3(1,63,0),new Vec3(1,63,1)])bot.putBlock('oak_leaves',p);
    bot.putBlock('oak_log',new Vec3(2,63,0));bot.putBlock('oak_log',new Vec3(2,63,1));let digs=0;
    bot.dig=async()=>{digs++;};
    if(phase==='equip')bot.equip=async item=>{bot.heldItem=item;bot.removeBlock(new Vec3(2,63,1));};
    else bot.lookAt=async()=>{bot.removeBlock(new Vec3(2,63,1));};
    const actions=createActions(bot,{movementBoundary:()=>({center:{x:.5,y:64.02,z:.5},radius:256})});
    await assert.rejects(actions.execute('dig_at',{x:2,y:63,z:0},undefined,{starterScope:'job/support'}),{code:'STARTER_SUPPORT_PROTECTED'});
    assert.equal(digs,0);assert.equal((await actions.execute('inspect',{radius:1})).connected,true);
  }
});

test('starter protects retained actual waypoint supports and leaf connectors in recovery digs', async () => {
  const bot=fakeBot();bot.entity.position=new Vec3(3.5,64,.5);
  for(let x=0;x<=11;x++)bot.putBlock('stone',new Vec3(x,63,0));
  bot.putBlock('oak_leaves',new Vec3(0,63,0));bot.putBlock('oak_leaves',new Vec3(1,63,0));bot.putBlock('oak_log',new Vec3(2,63,0));let digs=0;
  bot.dig=async()=>{digs++;};
  const actions=createActions(bot,{movementBoundary:()=>({center:{x:10.5,y:64,z:.5},radius:256}),starterProtectedPositions:()=>[{x:.5,y:64,z:.5}]});
  await assert.rejects(actions.execute('dig_at',{x:1,y:63,z:0},undefined,{starterScope:'job/support'}),{code:'STARTER_SUPPORT_PROTECTED'});
  assert.equal(digs,0);
});

for (const occupiedSlot of [0,1,2]) test(`smelt refuses foreign contents first revealed by sync in slot ${occupiedSlot}`,async()=>{
 const bot=fakeBot();bot.putBlock('furnace',new Vec3(2,64,0));bot.addItem('sand',2);bot.addItem('coal',1);
 const foreign={name:occupiedSlot===0?'sand':occupiedSlot===1?'coal':'glass',type:registry.itemsByName[occupiedSlot===0?'sand':occupiedSlot===1?'coal':'glass'].id,count:1,metadata:0};
 const slots=Array(39).fill(null);slots[3]={...bot.inventory.items()[0]};slots[4]={...bot.inventory.items()[1]};
 let closed=0,clicks=0;
 const furnace={id:7,slots,inventoryStart:3,inventoryEnd:39,selectedItem:null,inputItem(){return this.slots[0];},fuelItem(){return this.slots[1];},outputItem(){return this.slots[2];},async close(){closed++;}};
 bot.openFurnace=async()=>furnace;
 bot._syncWindow=async()=>{furnace.slots[occupiedSlot]=foreign;};
 bot.clickWindow=async()=>{clicks++;throw Error('Unexpected transfer after occupied sync');};
 await assert.rejects(createActions(bot).execute('smelt',{item:'sand',count:2,fuel:'coal'}),/Furnace is occupied/);
 assert.equal(clicks,0);assert.equal(closed,1);assert.equal(furnace.slots[occupiedSlot],foreign);assert.equal(foreign.count,1);
});

for(const kind of ['craft','smelt'])test(`cancelled ${kind} closes a window acquired after cancellation before accepting another action`,async()=>{
 const bot=fakeBot(),controller=new AbortController();let resolveOpen,releaseClose,closed=0;
 const window={id:7,slots:Array(46).fill(null),inventoryStart:10,inventoryEnd:46,selectedItem:null};
 const close=()=>{closed++;return new Promise(resolve=>{releaseClose=()=>{if(bot.currentWindow===window)bot.currentWindow=null;resolve();};});};
 bot.clickWindow=async()=>{throw Error('No transfer after cancellation');};bot._syncWindow=async()=>{};bot.closeWindow=close;
 let args;
 if(kind==='craft'){
  bot.putBlock('crafting_table',new Vec3(2,64,0));bot.addItem('oak_planks',3);bot.addItem('stick',2);
  bot.recipesFor=()=>[{requiresTable:true,result:{id:registry.itemsByName.wooden_pickaxe.id,count:1}}];
  bot.openBlock=()=>new Promise(resolve=>{resolveOpen=resolve;});args={item:'wooden_pickaxe',count:1};
 }else{
  bot.putBlock('furnace',new Vec3(2,64,0));bot.addItem('sand',1);bot.addItem('coal',1);window.close=close;
  bot.openFurnace=()=>new Promise(resolve=>{resolveOpen=resolve;});args={item:'sand',count:1,fuel:'coal'};
 }
 const actions=createActions(bot),pending=actions.execute(kind,args,controller.signal);
 const rejection=assert.rejects(pending,{name:'AbortError'});
 const deadline=Date.now()+1000;while(!resolveOpen){assert.ok(Date.now()<deadline,'window acquisition started');await new Promise(resolve=>setImmediate(resolve));}
 controller.abort();await assert.rejects(actions.execute('inspect',{radius:1}),/running or draining/);
 bot.currentWindow=window;resolveOpen(window);
 const closeDeadline=Date.now()+1000;while(!releaseClose){assert.ok(Date.now()<closeDeadline,'late window cleanup started');await new Promise(resolve=>setImmediate(resolve));}
 await assert.rejects(actions.execute('inspect',{radius:1}),/running or draining/);
 releaseClose();await rejection;
 assert.equal(closed,1);assert.equal(bot.currentWindow,null);
 assert.equal((await actions.execute('inspect',{radius:1})).connected,true);
});

test('empty starter scans advance across real runner cleanup and inspect', async t => {
  t.mock.method(performance, 'now', () => 1000)
  const { Runtime } = await import('../src/runtime.js')
  const bot = fakeBot(), stone = registry.blocksByName.stone, visits = []
  bot.entity.velocity = new Vec3(0, 0, 0)
  bot.world = { getColumn: () => ({ sections: Array(24).fill({ palette:[stone.defaultState] }) }) }
  bot.blockAt = (p, extra) => {
    if (extra) visits.push(p.toString())
    return { name:'stone', type:stone.id, position:p.floored(), boundingBox:'block' }
  }
  const actions = createActions(bot)
  const runtime = { bot, actions, connection:'connected', progression:{definitions:[]}, runner:new ActionRunner(), definitions:() => definitions }
  const parent = new AbortController()
  const collect = async () => {
    visits.length = 0
    let result
    await assert.rejects(Runtime.prototype.execute.call(runtime,'collect',{block:'stone',count:4,radius:32},parent.signal,{starterScope:'job/cursor'}), e => { result=e.result; return Boolean(result) })
    assert.equal(result.mined,0); assert.equal(result.failures.length,0); assert.equal(result.search_continuation_saved,true)
    return { result, visits:[...visits] }
  }
  const first = await collect()
  assert.equal(first.result.search_continued,false); assert.equal(first.visits.length,65537)
  await Runtime.prototype.execute.call(runtime,'inspect',{radius:1},parent.signal)
  const second = await collect()
  assert.equal(second.result.search_continued,true)
  assert.equal(second.visits[0],first.visits.at(-1))
  assert.notDeepEqual(second.visits,first.visits)
  actions.stop()
  const third = await collect()
  assert.equal(third.result.search_continued,false); assert.deepEqual(third.visits,first.visits)
  parent.abort(); actions.stop()
})

for (const event of ['blockUpdate','chunkColumnLoad','respawn','stop','mutate','parent','move','invalid-inspect']) test(`empty starter cursor invalidates before retry: ${event}`, async t => {
  t.mock.method(performance,'now',()=>1000)
  const bot=fakeBot(),stone=registry.blocksByName.stone
  bot.entity.velocity=new Vec3(0,0,0)
  bot.world={getColumn:()=>({sections:Array(24).fill({palette:[stone.defaultState]})})}
  bot.blockAt=p=>({name:'stone',type:stone.id,position:p.floored(),boundingBox:'block'})
  const actions=createActions(bot), runner=new ActionRunner()
  let parent=new AbortController()
  const collect=async()=>{
    let s,result
    await assert.rejects(runner.run('collect',signal=>{s=signal;return actions.execute('collect',{block:'stone',count:1,radius:32},signal,{parentSignal:parent.signal,starterScope:'job'})},()=>actions.stop({finishedCleanup:Boolean(s&&!s.aborted)}),parent.signal),e=>{result=e.result;return Boolean(result)})
    return result
  }
  assert.equal((await collect()).search_continuation_saved,true)
  if(event==='invalid-inspect')await assert.rejects(actions.execute('inspect',{},new AbortController().signal,{parentSignal:parent.signal,jobDeadline:NaN}),/deadlines/)
  else if(event==='stop')actions.stop()
  else if(event==='mutate')actions.invalidateSearch()
  else if(event==='parent'){parent.abort();parent=new AbortController()}
  else if(event==='move'){bot.entity.position.x++;bot.emit('move');bot.entity.position.x--}
  else bot.emit(event)
  assert.equal((await collect()).search_continued,false)
  actions.stop()
})

test('continued empty scan discovers later exposed ore and freshly rejects its route',async t=>{
  t.mock.method(performance,'now',()=>1000)
  const bot=fakeBot(),stone=registry.blocksByName.stone,air=registry.blocksByName.air
  bot.entity.velocity=new Vec3(0,0,0)
  bot.world={getColumn:()=>({sections:Array(24).fill({palette:[stone.defaultState,air.defaultState]})})}
  const opening=new Vec3(-17,81,0)
  bot.blockAt=p=>{p=p.floored();const empty=p.equals(opening);return{name:empty?'air':'stone',type:empty?air.id:stone.id,position:p,boundingBox:empty?'empty':'block'}}
  let routeChecks=0,digs=0
  bot.pathfinder.getPathFromTo=function*(){routeChecks++;yield{result:{status:'noPath',path:[]}}}
  bot.dig=async()=>{digs++}
  const actions=createActions(bot),parent=new AbortController(),runner=new ActionRunner()
  const outcomes=[]
  for(let page=0;page<8;page++){
    let s,result
    await assert.rejects(runner.run('collect',signal=>{s=signal;return actions.execute('collect',{block:'stone',count:1,radius:32},signal,{parentSignal:parent.signal,starterScope:'later-candidate'})},()=>actions.stop({finishedCleanup:Boolean(s&&!s.aborted)}),parent.signal),e=>{result=e.result;return Boolean(result)})
    outcomes.push(result)
    if(result.failures.length)break
    assert.equal(result.search_continuation_saved,true)
  }
  assert.equal(outcomes[0].failures.length,0)
  const found=outcomes.at(-1)
  assert.equal(found.search_continued,true)
  assert.ok(found.failures.length>0)
  assert.equal(found.search_continuation_saved,false)
  assert.ok(routeChecks>0);assert.equal(digs,0)
  actions.stop()
})

function budgetPickupFixture () {
 const bot=fakeBot();bot.putBlock('stone',new Vec3(0,63,0));bot.putBlock('stone',new Vec3(2,63,0))
 bot.entities[2]={id:2,name:'item',position:new Vec3(2.5,64,.5)}
 let moves=0,long=true
 bot.pathfinder.getPathFromTo=function*(m,start,goal){
  const path=goal.x===2&&long?[...Array.from({length:12},(_,i)=>new Vec3(i+1,65+i,0)),...Array.from({length:9},(_,i)=>new Vec3(13+i,75-i,0)),new Vec3(2,64,0)]:[new Vec3(goal.x,goal.y,goal.z)]
  yield{result:{status:'success',path}}
 }
 bot.pathfinder.goto=async goal=>{moves++;bot.entity.position=new Vec3(goal.x+.5,goal.y,goal.z+.5);delete bot.entities[2];bot.addItem('cobblestone')}
 return{bot,moves:()=>moves,short:()=>{long=false}}
}
test('starter pickup refuses a long certified detour before motion and preserves fresh retry',async()=>{
 const f=budgetPickupFixture(),actions=createActions(f.bot),context={starterScope:'budget/job'}
 const result=await actions.execute('pickup',{radius:8},undefined,context)
 assert.equal(f.bot.listenerCount('playerCollect'),0)
 assert.equal(f.moves(),0);assert.equal(result.pickup_limited,true);assert.equal(result.pursuit_unverified,false)
 assert.equal(result.remaining_drops.length,1);assert.equal(result.deferred_drops.length,0)
 assert.ok(result.unreachable.every(x=>x.code==='PICKUP_ROUTE_BUDGET'))
 assert.deepEqual(f.bot.entity.position,new Vec3(.5,64,.5))
 f.short();const retry=await actions.execute('pickup',{radius:8},undefined,context)
 assert.equal(f.moves(),1);assert.equal(retry.inventory_changes.cobblestone,1);assert.equal(retry.pickup_limited,false)
})
test('direct pickup preserves its existing travel policy for a long certified path',async()=>{
 const f=budgetPickupFixture();const result=await createActions(f.bot).execute('pickup',{radius:8})
 assert.equal(f.moves(),1);assert.equal(result.inventory_changes.cobblestone,1)
})
test('budget refusal rotates to an affordable alternative destination',async()=>{
 const f=budgetPickupFixture();f.bot.putBlock('stone',new Vec3(1,63,0))
 const result=await createActions(f.bot).execute('pickup',{radius:8},undefined,{starterScope:'budget/alternate'})
 assert.equal(f.moves(),1);assert.equal(result.inventory_changes.cobblestone,1);assert.equal(result.remaining_drops.length,0)
 assert.equal(result.pickup_limited,false);assert.equal(result.pursuit_unverified,false)
 assert.equal(result.unreachable[0].code,'PICKUP_ROUTE_BUDGET')
})
test('starter pickup admission uses allowance left after repeated route planning',async t=>{
 let now=1000,forward=0,moved=0
 t.mock.method(performance,'now',()=>now)
 const bot=fakeBot();bot.putBlock('stone',new Vec3(0,63,0));bot.putBlock('stone',new Vec3(8,63,0))
 bot.entities[2]={id:2,name:'item',position:new Vec3(8.5,64,.5)}
 bot.pathfinder.getPathFromTo=function*(m,start,goal){
  now+=700
  if(goal.x===8)forward++
  const long=goal.x===8&&forward<3
  yield{result:{status:'success',path:long?[new Vec3(16,76,0),new Vec3(8,64,0)]:[new Vec3(goal.x,goal.y,goal.z)]}}
 }
 bot.pathfinder.setGoal=goal=>{if(goal)moved++}
 const result=await createActions(bot).execute('pickup',{radius:12},undefined,{starterScope:'budget/planning-cost'})
 assert.equal(moved,0);assert.equal(forward,3);assert.equal(result.unreachable.length,3)
 const last=result.unreachable.at(-1)
 assert.equal(last.code,'PICKUP_ROUTE_BUDGET');assert.equal(last.nodes,1)
 assert.ok(last.estimated_ms<6000);assert.ok(last.estimated_ms>last.available_ms)
 assert.equal(result.deferred_drops.length,0);assert.equal(bot.listenerCount('playerCollect'),0)
})
