import test from 'node:test';
import assert from 'node:assert/strict';
import { sameItemIdentity, itemStackCapacity } from '../src/item-identity.js';
const item = extra => ({type:5,metadata:0,count:1,...extra});
test('cursor capacity honors exact custom limits including increases',()=>{
 assert.equal(itemStackCapacity(item({stackSize:64})),64);
 for(const data of [1,16,99])assert.equal(itemStackCapacity(item({stackSize:64,components:[{type:'max_stack_size',data}]})),data);
});
test('cursor capacity refuses removed, malformed or unknown limits',()=>{
 for(const data of [0,-1,100,1.5,'16',null])assert.equal(itemStackCapacity(item({stackSize:64,components:[{type:'max_stack_size',data}]})),0);
 assert.equal(itemStackCapacity(item({stackSize:64,removedComponents:[{type:'max_stack_size'}]})),0);
 assert.equal(itemStackCapacity(item({stackSize:64,components:[{type:'max_stack_size',data:16},{type:'max_stack_size',data:16}]})),0);
 assert.equal(itemStackCapacity(item()),0);
 for(const components of [[null],[{}]])assert.equal(itemStackCapacity(item({stackSize:64,components})),0);
});
test('inventory identity conservatively preserves top-level and nested component array order',()=>{
 const a={type:'custom_name',data:{type:'string',value:'A'}},b={type:'custom_data',data:[1,2]};
 assert.equal(sameItemIdentity(item({components:[a,b]}),item({components:[b,a]})),false);
 assert.equal(sameItemIdentity(item({components:[b]}),item({components:[{...b,data:[2,1]}]})),false);
});
test('inventory identity ignores counts but preserves modern added and removed components',()=>{
 assert.equal(sameItemIdentity(item(),item({count:20,components:[],removedComponents:[]})),true);
 const named=item({components:[{type:'custom_name',data:{type:'string',value:'Reserved'}}]});
 assert.equal(sameItemIdentity(item(),named),false);
 assert.equal(sameItemIdentity(named,structuredClone(named)),true);
 assert.equal(sameItemIdentity(item(),item({removedComponents:[{type:'custom_name'}]})),false);
 assert.equal(sameItemIdentity(item(),item({metadata:1})),false);
});
test('inventory identity handles binary and bigint NBT and rejects malformed components',()=>{
 const tagged=item({nbt:{value:12n,bytes:Buffer.from([1,2])}});
 assert.equal(sameItemIdentity(tagged,item({nbt:{bytes:Buffer.from([1,2]),value:12n}})),true);
 assert.equal(sameItemIdentity(tagged,item({nbt:{value:13n,bytes:Buffer.from([1,2])}})),false);
 for(const components of [{},[null],[{type:'x'},{type:'x'}]])assert.equal(sameItemIdentity(item({components}),item({components})),false);
 assert.equal(sameItemIdentity(null,item()),false);
});
