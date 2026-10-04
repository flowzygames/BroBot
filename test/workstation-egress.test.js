import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import registryLoader from 'prismarine-registry';
import blockLoader from 'prismarine-block';
import pathfinder from 'mineflayer-pathfinder';
import { STARTER_AVOID_BLOCK_NAMES } from '../src/navigation-guards.js';
import { createActions } from '../src/actions.js';
import { certifyWorkstationEgress } from '../src/workstation-egress.js';
const data = JSON.parse(readFileSync(new URL('./fixtures/workstation-trap-924242050.json',import.meta.url),'utf8'));
const vec = p => new Vec3(p.x,p.y,p.z);
function fixture() {
  const registry=registryLoader('1.21.8'),Block=blockLoader(registry),cells=new Map(data.blocks.map(([x,y,z,i])=>[`${x},${y},${z}`,i]));
  const table=vec(data.table),overrides=new Map();
  const blockAt=value=>{
    const p=value.floored();
    if(['x','y','z'].some(k=>p[k]<data.bounds.min[k]||p[k]>data.bounds.max[k]))return null;
    const state=overrides.get(p.toString()) ?? (p.equals(table)?{Name:'minecraft:air'}:data.palette[cells.get(p.toArray().join(','))??0]);
    const block=Block.fromProperties(registry.blocksByName[state.Name.replace('minecraft:','')].id,state.Properties??{},0);block.position=p;return block;
  };
  const bot=Object.assign(new EventEmitter(),{registry,blockAt,entity:{position:vec(data.position),onGround:true,effects:{}},entities:{},inventory:{items:()=>[]},game:{minY:-64,height:384},clearControlStates(){}});
  pathfinder.pathfinder(bot);
  const movements=new pathfinder.Movements(bot);
  Object.assign(movements,{canDig:false,canOpenDoors:false,allowFreeMotion:false,allowParkour:false,allow1by1towers:false,scafoldingBlocks:[],maxDropDown:3});
  for(const name of STARTER_AVOID_BLOCK_NAMES)if(registry.blocksByName[name])movements.blocksToAvoid.add(registry.blocksByName[name].id);
  return {bot,movements,table,overrides};
}
test('recorded canopy placement that seals the only exit is refused',async()=>{
  const {bot,movements,table}=fixture();
  const before=bot.entity.position.clone();
  assert.equal(await certifyWorkstationEgress(bot,movements,table,'crafting_table'),null);
  assert.ok(bot.entity.position.equals(before));assert.equal(bot.blockAt(table).name,'air');
});
test('recorded canopy permits an alternative placement with the same round-trip local exit',async()=>{
  const {bot,movements}=fixture();
  const proof=await certifyWorkstationEgress(bot,movements,new Vec3(228,85,-33),'crafting_table');
  assert.ok(proof);assert.ok(Math.hypot(proof.witness[0]-proof.origin[0],proof.witness[2]-proof.origin[2])>=2);
});
test('local egress proof respects cancellation and rejects exhausted budgets',async()=>{
  const {bot,movements,table}=fixture(),controller=new AbortController();controller.abort();
  await assert.rejects(certifyWorkstationEgress(bot,movements,table,'crafting_table',{signal:controller.signal}),{name:'AbortError'});
  assert.equal(await certifyWorkstationEgress(bot,movements,table,'crafting_table',{budgetMs:0}),null);
});

test('egress certificate invalidates after pose, grounded state, or observed terrain changes',async()=>{
  const {bot,movements}=fixture(),target=new Vec3(224,85,-31);
  const proof=await certifyWorkstationEgress(bot,movements,target,'crafting_table');
  assert.ok(proof);assert.equal(proof.validate(),true);
  bot.entity.onGround=false;assert.equal(proof.validate(),false);bot.entity.onGround=true;
  bot.entity.position.x+=0.2;assert.equal(proof.validate(),false);bot.entity.position.x-=0.2;
  const original=bot.blockAt;bot.blockAt=p=>p.equals(target.offset(0,-1,0))?null:original(p);
  assert.equal(proof.validate(),false);
});
test('airborne and overlapping placement stages are refused',async()=>{
  const {bot,movements}=fixture(),target=new Vec3(224,85,-31);
  bot.entity.onGround=false;assert.equal(await certifyWorkstationEgress(bot,movements,target,'crafting_table'),null);
  bot.entity.onGround=true;assert.equal(await certifyWorkstationEgress(bot,movements,bot.entity.position.floored(),'crafting_table'),null);
});


test('automatic crafting skips the recorded trapping table position and places a safe alternative',async()=>{
  const {bot,table,overrides}=fixture(),stacks=[{name:'crafting_table',type:bot.registry.itemsByName.crafting_table.id,count:1}],placed=[];
  bot.inventory.items=()=>stacks.filter(i=>i.count>0);bot.inventory.slots=[];
  bot.findBlocks=()=>[];bot.canSeeBlock=()=>true;bot.setControlState=()=>{};bot.stopDigging=()=>{};bot.deactivateItem=()=>{};
  bot.equip=async item=>{bot.heldItem=item};bot.lookAt=async()=>{};
  bot._placeBlockWithOptions=async(reference,face,options)=>{assert.equal(options.forceLook,'ignore');const p=reference.position.plus(face);placed.push(p);overrides.set(p.toString(),{Name:'minecraft:crafting_table'});stacks[0].count--;};
  bot.placeBlock=(reference,face)=>bot._placeBlockWithOptions(reference,face,{forceLook:'ignore'});
  bot.recipesFor=(type,metadata,count,table)=>table?[{result:{count:1},requiresTable:true}]:[];
  bot.craft=async()=>{stacks.push({name:'wooden_pickaxe',type:bot.registry.itemsByName.wooden_pickaxe.id,count:1})};
  const result=await createActions(bot).execute('craft',{item:'wooden_pickaxe',count:1});
  assert.equal(result.crafted,1);assert.equal(placed.length,1);assert.ok(!placed[0].equals(table));assert.equal(bot.blockAt(table).name,'air');
});

test('local egress accepts an L-shaped corridor with no cardinal escape witness',async()=>{
  const {bot,movements}=fixture(),Block=blockLoader(bot.registry);
  const corridor=new Set(['0,0','1,0','1,1','1,2','2,2','0,-1']);
  bot.entity.position=new Vec3(.5,64,.5);
  bot.blockAt=value=>{
    const p=value.floored();if(Math.abs(p.x)>6||Math.abs(p.z)>6||p.y<62||p.y>68)return null;
    const air=(p.y===64||p.y===65)&&corridor.has(`${p.x},${p.z}`);
    const block=Block.fromStateId(bot.registry.blocksByName[air?'air':'stone'].defaultState,0);block.position=p;return block;
  };
  const proof=await certifyWorkstationEgress(bot,movements,new Vec3(0,64,-1),'crafting_table');
  assert.ok(proof);assert.notEqual(proof.witness[0],0);assert.notEqual(proof.witness[2],0);
});
