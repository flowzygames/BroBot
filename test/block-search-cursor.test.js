import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { Vec3 } from 'vec3'
import minecraftData from 'minecraft-data'
import blockLoader from 'prismarine-block'
import worldPackage from 'prismarine-world'
import { BlockSearchCursor } from '../src/block-search-cursor.js'

const require = createRequire(import.meta.url)
const registry = minecraftData('1.21.8'), Block = blockLoader(registry)
const { OctahedronIterator } = worldPackage.iterators
const source = readFileSync(require.resolve('mineflayer/lib/plugins/blocks.js'), 'utf8')
const nativeSearch = source.slice(source.indexOf('  function getMatchingFunction'), source.indexOf('\n  function findBlock ('))
assert.ok(nativeSearch.includes('bot.findBlocks ='))

function fixture ({ point = new Vec3(.5, 64, .5), minY = -64, height = 384, missing = false, paletteSkips = false, globalPalette = false, dense = false } = {}) {
  const stone = registry.blocksByName.stone, air = registry.blocksByName.air
  const bot = { registry, entity: { position: point }, game: { minY, height } }
  bot.world = { getColumn: (x, z) => missing && Math.abs(x + z) % 3 === 0 ? null : { sections: Array.from({ length: height >> 4 }, (_, i) => paletteSkips && i % 7 === 0 ? undefined : globalPalette ? {} : { palette: paletteSkips && i % 3 === 0 ? [air.defaultState] : [stone.defaultState, air.defaultState] }) } }
  bot.blockAt = p => {
    p = p.floored()
    const sectionY = (p.y - minY) >> 4
    const definition = paletteSkips && sectionY % 3 === 0 ? air : dense || (p.x + p.y + p.z) % 3 === 0 ? stone : air
    return { name: definition.name, type: definition.id, position: p, stateId: definition.defaultState }
  }
  vm.runInNewContext(nativeSearch, { bot, Vec3, Block, OctahedronIterator, blockAt: p => bot.blockAt(p, true) })
  return bot
}

for (const options of [
  {},
  { point: new Vec3(-17.8, 70.2, -1.1) },
  { point: new Vec3(15.9, 2, -16.1), minY: 0, height: 128 },
  { missing: true },
  { paletteSkips: true },
  { globalPalette: true },
  { dense: true }
]) test(`cursor matches pinned native traversal and shell count: ${JSON.stringify(options)}`, () => {
  const bot = fixture(options), expectedVisits = [], actualVisits = []
  const filter = b => Math.abs(b.position.x + b.position.z) % 5 === 0
  const expected = bot.findBlocks({ matching: registry.blocksByName.stone.id, maxDistance: 20, count: 9, useExtraInfo: b => { expectedVisits.push(b.position.toString()); return filter(b) } })
  const cursor = new BlockSearchCursor(bot, { matching: registry.blocksByName.stone.id, point: bot.entity.position, maxDistance: 20, count: 9 })
  const actual = cursor.scan({ now: () => 0, accept: b => { actualVisits.push(b.position.toString()); return filter(b) } })
  assert.equal(actual.limited, false)
  assert.deepEqual(actualVisits, expectedVisits)
  assert.deepEqual(actual.positions.map(p => p.toString()), Array.from(expected, p => p.toString()))
  assert.equal(cursor.resumable, false)
})

test('empty capped pages retry the exact unevaluated boundary cell instead of the old prefix', () => {
  const bot = fixture({ dense: true })
  const cursor = new BlockSearchCursor(bot, { matching: registry.blocksByName.stone.id, point: bot.entity.position, maxDistance: 48 })
  const first = []
  const page = cursor.scan({ now: () => 0, accept: b => { first.push(b.position.toString()); return false } })
  assert.equal(page.inspected, 65537); assert.equal(first.length, 65536); assert.equal(page.resumable, true)
  const expectedNext = cursor.begin.offset(cursor.cell >> 8, (cursor.cell >> 4) & 15, cursor.cell & 15).toString()
  const second = []
  const next = cursor.scan({ now: () => 0, matchLimit: 2, accept: b => { second.push(b.position.toString()); return second.length === 1 } })
  assert.equal(second[0], expectedNext)
  assert.notEqual(second[0], first[0]); assert.equal(second.length, 2)
  assert.equal(next.accepted, 1); assert.equal(next.resumable, false)
})

test('time limits preserve an unprocessed cell and exceptions invalidate the cursor', () => {
  const bot = fixture({ dense: true }), make = () => new BlockSearchCursor(bot, { matching: registry.blocksByName.stone.id, point: bot.entity.position, maxDistance: 20 })
  const cursor = make(); let clock = 0, calls = 0
  const page = cursor.scan({ now: () => clock++, budgetMs: 2, accept: () => { calls++; return false } })
  assert.equal(page.limited, true); assert.equal(page.termination,'time_budget'); assert.equal(page.coverageComplete,false); assert.equal(calls, 0); assert.equal(cursor.cell, 0)
  const next = cursor.scan({ now: () => 0, matchLimit: 1, accept: b => { assert.equal(b.position.toString(), '(0, 64, 0)'); return true } })
  assert.equal(next.accepted, 1)
  const failed = make()
  assert.throws(() => failed.scan({ check: () => { throw Error('Cancelled') }, accept: () => false }), /Cancelled/)
  assert.throws(() => failed.scan({ accept: () => false }), /not resumable/)
})

for (const radius of [61,62,63,64]) test(`cursor admits widened maximum collection radius ${radius}`, async () => {
  const { sectionSearchDistance } = await import('../src/block-search.js')
  assert.doesNotThrow(() => new BlockSearchCursor(fixture(), {matching:registry.blocksByName.stone.id,point:new Vec3(0,64,0),maxDistance:sectionSearchDistance(radius)}))
})

test('completed traversal is distinguished from reaching the candidate count cap',()=>{
  const bot=fixture({dense:true}), options={matching:registry.blocksByName.stone.id,point:bot.entity.position,maxDistance:20,count:9}
  const capped=new BlockSearchCursor(bot,options).scan({now:()=>0,accept:()=>true})
  assert.equal(capped.done,true);assert.equal(capped.termination,'candidate_cap');assert.equal(capped.coverageComplete,false)
  // Continue until traversal is complete; no page may claim completion early.
  const cursor=new BlockSearchCursor(bot,options);let page
  do {page=cursor.scan({now:()=>0,accept:()=>false});if(page.limited)assert.equal(page.coverageComplete,false)} while(page.resumable)
  assert.equal(page.termination,'traversal_complete');assert.equal(page.coverageComplete,true)
})

test('completed loaded traversal retains explicit missing-column uncertainty',()=>{
  const bot=fixture({missing:true}),cursor=new BlockSearchCursor(bot,{matching:registry.blocksByName.stone.id,point:bot.entity.position,maxDistance:20})
  let page;do{page=cursor.scan({now:()=>0,accept:()=>false})}while(page.resumable)
  assert.equal(page.termination,'traversal_complete');assert.ok(page.unloadedColumns>0);assert.equal(page.coverageComplete,false)
})

test('unknown cells and page-budget reasons never become complete coverage',()=>{
  const bot=fixture({dense:true}),read=bot.blockAt
  bot.blockAt=p=>p.x===0&&p.y===64&&p.z===0?null:read(p)
  const cursor=new BlockSearchCursor(bot,{matching:registry.blocksByName.stone.id,point:bot.entity.position,maxDistance:20})
  let page;do{page=cursor.scan({now:()=>0,accept:()=>false})}while(page.resumable)
  assert.equal(page.unknownCells,1);assert.equal(page.coverageComplete,false)
  const limited=new BlockSearchCursor(fixture({dense:true}),{matching:registry.blocksByName.stone.id,point:bot.entity.position,maxDistance:20})
  const cap=limited.scan({now:()=>0,matchLimit:1,accept:()=>false})
  assert.equal(cap.termination,'match_limit');assert.equal(cap.coverageComplete,false)
})


test('empty continuation pages retain uncertainty until traversal actually completes',()=>{
  const bot=fixture({dense:true}),cursor=new BlockSearchCursor(bot,{matching:registry.blocksByName.stone.id,point:bot.entity.position,maxDistance:4})
  const first=cursor.scan({now:()=>0,matchLimit:1,accept:()=>false})
  assert.equal(first.resumable,true);assert.equal(first.coverageComplete,false)
  const final=cursor.scan({now:()=>0,accept:()=>false})
  assert.equal(final.termination,'traversal_complete');assert.equal(final.coverageComplete,true)
})

for (const [origin,radius] of [[new Vec3(.9,64.5,.2),1],[new Vec3(15.9,70.2,15.9),17],[new Vec3(-16.1,76,-48.1),17],[new Vec3(-13,76,-49),32]]) test(`scoped cursor covers exactly the requested sphere at ${origin} radius ${radius}`,async()=>{
 const {sectionSearchDistance}=await import('../src/block-search.js');const bot=fixture({point:origin,dense:true}),center=origin.floored(),visited=new Set();
 const original=bot.blockAt;bot.blockAt=p=>{assert.ok(p.distanceTo(center)<=radius);return original(p)};
 const cursor=new BlockSearchCursor(bot,{matching:registry.blocksByName.stone.id,point:origin,maxDistance:sectionSearchDistance(radius),queryRadius:radius});let page;
 do{page=cursor.scan({now:()=>0,matchLimit:8192,accept:b=>{const key=b.position.toString();assert.equal(visited.has(key),false,'no repeated evaluated cells across pages');visited.add(key);return false}})}while(page.resumable);
 const expected=new Set();for(let x=-radius;x<=radius;x++)for(let y=-radius;y<=radius;y++)for(let z=-radius;z<=radius;z++)if(x*x+y*y+z*z<=radius*radius)expected.add(center.offset(x,y,z).toString());
 assert.deepEqual(visited,expected);assert.equal(page.coverageComplete,true);assert.equal(page.termination,'traversal_complete');
});

test('scoped matching budget ignores irrelevant dense sections while preserving exact boundary retry',async()=>{
 const {sectionSearchDistance}=await import('../src/block-search.js'),bot=fixture({dense:true,point:new Vec3(-13,76,-49)});
 const make=queryRadius=>new BlockSearchCursor(bot,{matching:registry.blocksByName.stone.id,point:bot.entity.position,maxDistance:sectionSearchDistance(32),queryRadius});
 const measure=cursor=>{let page,pages=0,evaluated=0;do{page=cursor.scan({now:()=>0,accept:()=>{evaluated++;return false}});pages++}while(page.resumable);return{pages,evaluated,page}};
 const old=measure(make(null)),scoped=measure(make(32));assert.equal(scoped.evaluated,137065);assert.equal(scoped.pages,3);assert.ok(old.pages>scoped.pages*5);assert.equal(scoped.page.coverageComplete,true);
 const cursor=make(32),first=[];const a=cursor.scan({now:()=>0,matchLimit:2,accept:b=>{first.push(b.position.toString());return false}});assert.equal(a.inspected,3);assert.equal(first.length,2);
 const boundary=cursor.begin.offset(cursor.cell>>8,(cursor.cell>>4)&15,cursor.cell&15).toString();let seen;
 cursor.scan({now:()=>0,matchLimit:1,accept:b=>{seen=b.position.toString();return false}});assert.equal(seen,boundary);assert.ok(!first.includes(seen));
});

test('missing columns and cells outside query sphere do not invalidate in-scope coverage',async()=>{
 const {sectionSearchDistance}=await import('../src/block-search.js'),bot=fixture({point:new Vec3(8,72,8),dense:true});const readColumn=bot.world.getColumn,readBlock=bot.blockAt;
 bot.world.getColumn=(x,z)=>x===0&&z===0?readColumn(x,z):null;
 bot.blockAt=p=>p.distanceTo(bot.entity.position)>2?null:readBlock(p);
 const options={matching:registry.blocksByName.stone.id,point:bot.entity.position,maxDistance:sectionSearchDistance(2),queryRadius:2};
 const full=new BlockSearchCursor(bot,options).scan({now:()=>0,accept:()=>false});assert.equal(full.coverageComplete,true);assert.equal(full.unknownCells,0);assert.equal(full.unloadedColumns,0);
 bot.blockAt=p=>p.equals(new Vec3(8,72,8))?null:readBlock(p);
 const unknown=new BlockSearchCursor(bot,options).scan({now:()=>0,accept:()=>false});assert.equal(unknown.coverageComplete,false);assert.equal(unknown.unknownCells,1);
 bot.world.getColumn=()=>null;
 const missing=new BlockSearchCursor(bot,options).scan({now:()=>0,accept:()=>false});assert.equal(missing.coverageComplete,false);assert.equal(missing.unloadedColumns,1);
});

test('scoped traversal retains cancellation, time limits and candidate count semantics',async()=>{
 const {sectionSearchDistance}=await import('../src/block-search.js'),bot=fixture({dense:true});const make=()=>new BlockSearchCursor(bot,{matching:registry.blocksByName.stone.id,point:bot.entity.position,maxDistance:sectionSearchDistance(8),queryRadius:8,count:2});
 let time=0;const cursor=make(),limited=cursor.scan({now:()=>time++,budgetMs:2,accept:()=>false});assert.equal(limited.limited,true);assert.equal(limited.coverageComplete,false);
 const stopped=make();assert.throws(()=>stopped.scan({check:()=>{throw Error('Stop')},accept:()=>false}),/Stop/);assert.equal(stopped.resumable,false);
 const capped=make().scan({now:()=>0,accept:()=>true});assert.equal(capped.positions.length,2);assert.equal(capped.termination,'candidate_cap');assert.equal(capped.coverageComplete,false);
});

test('scoped search rejects radius bounds that cannot guarantee widened diagonal coverage',async()=>{
 const {sectionSearchDistance}=await import('../src/block-search.js'),bot=fixture();
 for(const queryRadius of [0,-1,65,NaN,Infinity,'32'])assert.throws(()=>new BlockSearchCursor(bot,{matching:1,point:bot.entity.position,maxDistance:sectionSearchDistance(32),queryRadius}),/query radius/);
 assert.throws(()=>new BlockSearchCursor(bot,{matching:1,point:bot.entity.position,maxDistance:32,queryRadius:32}),/query radius/);
});
