import test from 'node:test'
import assert from 'node:assert/strict'
import { pickupRouteBudget } from '../src/pickup-route-budget.js'
const start={x:.5,y:71,z:.5}
test('long ascending detour is refused before a six-second pursuit',()=>{
 const path=[]
 for(let i=1;i<=12;i++)path.push({x:i,y:71+i,z:0})
 for(let i=1;i<=9;i++)path.push({x:12+i,y:83-i,z:0})
 for(let i=22;i<=28;i++)path.push({x:i,y:74,z:0})
 const r=pickupRouteBudget(start,path,6000)
 assert.equal(r.admitted,false);assert.equal(r.ascent,12);assert.equal(r.descent,9);assert.equal(r.nodes,28)
})
test('short flat and one-block ascending paths remain eligible',()=>{
 assert.equal(pickupRouteBudget(start,[{x:1,y:71,z:0},{x:2,y:71,z:0}],6000).admitted,true)
 assert.equal(pickupRouteBudget(start,[{x:1,y:72,z:0},{x:2,y:72,z:0}],6000).admitted,true)
})
test('planning-consumed allowance is applied to the same geometry',()=>{
 const path=[{x:2,y:71,z:0}]
 assert.equal(pickupRouteBudget(start,path,6000).admitted,true)
 assert.equal(pickupRouteBudget(start,path,1000).admitted,false)
})
for(const [origin,path,budget] of [[null,[],6000],[start,null,6000],[start,[{x:1,y:NaN,z:0}],6000],[start,[],NaN],[start,[],-1]])test(`invalid route input refuses admission ${JSON.stringify([origin,path,budget])}`,()=>assert.equal(pickupRouteBudget(origin,path,budget).admitted,false))
test('already-at-goal empty geometry retains a settlement reserve',()=>{
 assert.equal(pickupRouteBudget(start,[],800).admitted,true)
 assert.equal(pickupRouteBudget(start,[],700).admitted,false)
})
test('negative off-center starts measure actual horizontal travel to standing-cell centers',()=>{
 const r=pickupRouteBudget({x:-.2,y:64,z:-.7},[{x:-1,y:64,z:-1}],6000)
 assert.ok(Math.abs(r.horizontal_distance-Math.hypot(.3,.2))<1e-12)
 assert.equal(r.estimated_ms,Math.ceil(750+350*Math.hypot(.3,.2)))
 assert.equal(pickupRouteBudget({x:-.2,y:64,z:-.7},[{x:-1,y:64,z:-1}],r.estimated_ms-.1).admitted,false)
})
