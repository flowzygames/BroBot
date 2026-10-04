import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {hasLavaContact,hasPowderSnowContact,isDryLanding,hasObservedStandingSupport} from '../src/body-hazards.js';

test('recovery support requires observed shape contact including full-top jitter',()=>{
 const {bot,blocks}=fixture();const cube={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
 assert.equal(hasObservedStandingSupport(bot),false);blocks.set(new Vec3(0,63,0).toString(),cube);
 for(const y of [63.98,64,64.02]){bot.entity.position.y=y;assert.equal(hasObservedStandingSupport(bot),true);}
 bot.entity.position.y=64.2;assert.equal(hasObservedStandingSupport(bot),false);
});
test('recovery support handles slab contact and rejects fluid or unknown footprint cells',()=>{
 const {bot,blocks}=fixture();bot.entity.position.y=63.5;
 blocks.set(new Vec3(0,63,0).toString(),{name:'stone_slab',boundingBox:'block',shapes:[[0,0,0,1,.5,1]]});
 assert.equal(hasObservedStandingSupport(bot),true);
 blocks.get(new Vec3(0,63,0).toString()).isWaterlogged=true;assert.equal(hasObservedStandingSupport(bot),false);
 blocks.get(new Vec3(0,63,0).toString()).isWaterlogged=false;bot.entity.position.x=.95;blocks.set(new Vec3(1,63,0).toString(),null);assert.equal(hasObservedStandingSupport(bot),false);
});
function fixture(){const blocks=new Map();return{blocks,bot:{entity:{position:new Vec3(.5,64,.5),onGround:true},blockAt:p=>blocks.has(p.toString())?blocks.get(p.toString()):{name:'air',boundingBox:'empty'}}};}
test('recorded lava-position geometry is detected without guessing damage attribution',()=>{
 const {bot,blocks}=fixture();bot.entity.position=new Vec3(-206.3,62,9.02);blocks.set(new Vec3(-207,62,9).toString(),{name:'lava'});
 assert.equal(hasLavaContact(bot),true);assert.equal(isDryLanding(bot),false);
});
test('a dry grounded body can stop while fluids, hazardous supports and unknown cells cannot',()=>{
 for(const name of ['water','lava','powder_snow','magma_block','fire']){
  const {bot,blocks}=fixture();assert.equal(isDryLanding(bot),true);blocks.set(new Vec3(0,63,0).toString(),{name});assert.equal(isDryLanding(bot),false,name);
 }
 const {bot,blocks}=fixture();blocks.set(new Vec3(0,64,0).toString(),null);assert.equal(isDryLanding(bot),false);bot.entity.onGround=false;assert.equal(isDryLanding(bot),false);
});
test('hazard contact only covers the body, including the existing powder-snow behavior',()=>{
 const {bot,blocks}=fixture();blocks.set(new Vec3(2,64,0).toString(),{name:'lava'});assert.equal(hasLavaContact(bot),false);
 blocks.set(new Vec3(0,65,0).toString(),{name:'powder_snow'});assert.equal(hasPowderSnowContact(bot),true);
});
test('pickup accepts a measured dry slab top but not a whole-block-wrong landing',async()=>{
 const {isAtPickupStandingCell}=await import('../src/body-hazards.js');const {bot,blocks}=fixture(),goal=new Vec3(0,64,0);
 bot.entity.position.y=63.5;blocks.set(new Vec3(0,63,0).toString(),{name:'stone_slab',shapes:[[0,0,0,1,.5,1]]});assert.equal(isAtPickupStandingCell(bot,goal),true);
 bot.entity.position.y=63;assert.equal(isAtPickupStandingCell(bot,goal),false);
 bot.entity.position.y=63.5;blocks.set(new Vec3(0,63,0).toString(),{name:'water',shapes:[]});assert.equal(isAtPickupStandingCell(bot,goal),false);
});
test('failed body reads are unknown for landing while observed neighboring lava remains visible',()=>{
 const {bot}=fixture();bot.blockAt=p=>{if(p.y===64)throw Error('unknown cell');return p.y===65?{name:'lava'}:{name:'air'}};
 assert.equal(isDryLanding(bot),false);assert.equal(hasLavaContact(bot),true);
});
