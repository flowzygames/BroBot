import test from 'node:test';
import assert from 'node:assert/strict';
import { recordScoutObservation, selectScout } from '../src/scout-coverage.js';
const home = { x: 0, y: 64, z: 0 };
const pick = overrides => selectScout({ position: home, home, index: 0, radius: 90, maxScouts: 8, ...overrides });

test('scouting keeps eight attempts, original distances, and returnable walking', () => {
  for (let index = 0; index < 8; index++) {
    const choice = pick({ index });
    assert.equal(choice.distance, [12,12,24,24,36,36,48,48][index]);
    assert.equal(choice.returnable, true);
  }
  for (const index of [-1, 8, 20, 0.5, NaN]) assert.equal(pick({ index }), null);
});
test('equal initial coverage uses the existing deterministic compass tie order', () => {
  assert.equal(pick({}).direction, 'north');
  assert.equal(pick({ index: 1 }).direction, 'east');
});
test('coverage prefers an unsearched side over repeated north-south overlap', () => {
  const observations = [-48,-24,0,24,48].map(z => ({ ...home, z }));
  assert.equal(pick({ index: 4, observations }).direction, 'east');
});
test('failed intended targets do not count as observed coverage and alternate directions come first', () => {
  const attempts = [{ origin: home, direction: 'north', target: { ...home, z: -12 } }];
  const history = recordScoutObservation([], home);
  assert.equal(pick({ attempts, observations: history }).direction, 'east');
  assert.deepEqual(history, [home]);
  assert.equal(pick({ index: 2, attempts }).direction, 'south');
});
test('nearby failed-direction penalty expires after actual movement away', () => {
  const attempts = ['north','east','south'].map(direction => ({ origin: home, direction }));
  assert.equal(pick({ attempts }).direction, 'west');
  assert.equal(pick({ attempts: attempts.map(a => ({ ...a, origin: { ...home, x: 5 } })) }).direction, 'north');
});
test('all selected targets stay inside the existing three-dimensional 90-block boundary', () => {
  const vectors = { north: [0,-1], east: [1,0], south: [0,1], west: [-1,0] };
  for (const position of [{ x: 85,y:64,z:0 },{ x:0,y:140,z:0 },{ x:-60,y:70,z:55 }]) {
    for (let index=0;index<8;index++) {
      const c=pick({position,index}); if (!c) continue;
      const [dx,dz]=vectors[c.direction];
      assert.ok(Math.hypot(position.x+dx*c.distance,position.y-home.y,position.z+dz*c.distance)<=90);
    }
  }
  assert.equal(pick({position:{...home,y:160}}),null);
});
test('actual observation history is bounded, deduplicated, immutable and rejects nonfinite positions', () => {
  const points=Array.from({length:64},(_,x)=>({x:x*3,y:64,z:0}));
  const saved=structuredClone(points);
  assert.deepEqual(recordScoutObservation(points,points.at(-1)),points);
  const extended=recordScoutObservation(points,{x:200,y:64,z:0});
  assert.equal(extended.length,64);assert.deepEqual(extended[0],points[1]);
  assert.deepEqual(points,saved);
  assert.deepEqual(recordScoutObservation([null,{x:NaN,y:64,z:0}],home),[home]);
  assert.equal(pick({position:{x:Infinity,y:64,z:0}}),null);
});
test('selector is translation-invariant and never mutates its inputs', () => {
  const observations=[home,{...home,z:-30},{...home,x:24}];
  const args={position:home,home,index:4,observations}; const saved=structuredClone(args);
  const c=selectScout({...args,radius:90,maxScouts:8}),shift=p=>({x:p.x+113,y:p.y-17,z:p.z-213});
  assert.deepEqual(selectScout({...args,radius:90,maxScouts:8,position:shift(home),home:shift(home),observations:observations.map(shift)}),c);
  assert.deepEqual(args,saved);
});
test('malformed saved attempts cannot crash or bias scout selection', () => {
  assert.deepEqual(pick({attempts:[null,{}, {direction:'north',origin:{x:NaN,y:64,z:0}}, {direction:'bogus',origin:home}]}),pick({}));
});
test('ranked candidates exclude every out-of-bound direction before alternatives are generated', async () => {
  const {rankScouts}=await import('../src/scout-coverage.js');
  const vectors={north:[0,-1],east:[1,0],south:[0,1],west:[-1,0]};
  for(let index=0;index<8;index++){
    const position={x:85,y:64,z:0};
    for(const c of rankScouts({position,home,index,radius:90,maxScouts:8})){
      assert.ok(Object.hasOwn(vectors,c.direction));assert.ok(Number.isFinite(c.distance));
      const [dx,dz]=vectors[c.direction];assert.ok(Math.hypot(position.x+dx*c.distance,position.z+dz*c.distance)<=90);
    }
  }
  assert.deepEqual(rankScouts({position:{...home,y:160},home,index:0,radius:90,maxScouts:8}),[]);
});
test('ranked boundary checks include the floored execution target', async () => {
  const {rankScouts}=await import('../src/scout-coverage.js');
  const choices=rankScouts({position:{x:-77.4,y:64,z:0.5},home:{x:0.5,y:64,z:0.5},index:0,radius:90,maxScouts:8});
  assert.ok(!choices.some(c=>c.direction==='west'));assert.ok(choices.length>0);
});
test('expanded default scouts reach beyond90 with24 attempts and64-block maximum legs', async () => {
  const {rankScouts}=await import('../src/scout-coverage.js');
  for(let index=0;index<24;index++){
    const position={x:160,y:64,z:0};const choices=rankScouts({position,home,index});assert.ok(choices.length);
    for(const c of choices){assert.ok(c.distance<=64);assert.equal(c.returnable,true);}
  }
  assert.deepEqual(rankScouts({position:home,home,index:24}),[]);
  assert.ok(rankScouts({position:{x:192,y:64,z:0},home,index:12}).some(c=>c.direction==='east'));
  assert.ok(!rankScouts({position:{x:240,y:64,z:0},home,index:12}).some(c=>c.direction==='east'));
});

test('a fully unverified local sweep halves the next scout leg without enlarging its budget', () => {
  const attempts=['north','east','south','west'].map(direction=>({origin:home,direction,distance:64,status:'unverified',exhausted:true}));
  assert.equal(selectScout({position:home,home,index:12,attempts}).distance,32);
  attempts.push({origin:home,direction:'north',distance:32,status:'unverified',exhausted:true});
  assert.equal(selectScout({position:home,home,index:13,attempts}).distance,16);
  for(const length of [16,8,4]) attempts.push({origin:home,direction:'north',distance:length,status:'unverified',exhausted:true});
  assert.equal(selectScout({position:home,home,index:14,attempts}).distance,4);
  assert.equal(selectScout({position:home,home,index:24,attempts}),null);
});
test('backoff requires explicit failed sweep evidence and expires after moving away', () => {
  for(const extra of [{},{status:'cancelled',exhausted:true},{status:'verified',exhausted:true},{status:'unverified',exhausted:false},{status:'unverified',exhausted:true,distance:NaN}]){
    const attempts=[{origin:home,direction:'north',distance:64,...extra}];
    assert.equal(selectScout({position:home,home,index:12,attempts}).distance,64);
  }
  const attempts=[{origin:home,direction:'north',distance:64,status:'unverified',exhausted:true}];
  assert.equal(selectScout({position:{...home,x:3},home,index:12,attempts}).distance,64);
});
test('shortened scouts retain floored endpoint boundary and returnable walking', async () => {
  const {rankScouts}=await import('../src/scout-coverage.js');
  const position={x:89.8,y:64,z:0.5},attempts=[{origin:position,direction:'west',distance:64,status:'unverified',exhausted:true}];
  const vectors={north:[0,-1],east:[1,0],south:[0,1],west:[-1,0]};
  for(const c of rankScouts({position,home,index:12,radius:90,attempts})){
    assert.equal(c.distance,32);assert.equal(c.returnable,true);
    const [dx,dz]=vectors[c.direction];assert.ok(Math.hypot(Math.floor(position.x+dx*c.distance),0,Math.floor(position.z+dz*c.distance))<=90);
  }
});
