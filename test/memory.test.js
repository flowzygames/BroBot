import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Memory} from '../src/memory.js';
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'brobot-memory-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return new Memory(dir)}
test('memory publishes independent copies only after a durable write',t=>{
 const m=fixture(t),v={step:1};m.set('job',v);v.step=2;assert.deepEqual(m.get('job'),{step:1});
 const copy=m.get('job');copy.step=3;assert.deepEqual(m.get('job'),{step:1});assert.deepEqual(new Memory(m.directory).get('job'),{step:1});
});
test('memory write failure leaves both prior disk and visible state unchanged',t=>{
 const m=fixture(t);m.set('job',{step:1});const disk=readFileSync(m.file,'utf8');mkdirSync(`${m.file}.tmp`);
 assert.throws(()=>m.set('job',{step:2}));assert.deepEqual(m.get('job'),{step:1});assert.equal(readFileSync(m.file,'utf8'),disk);
});
test('memory rename failure cannot publish staged state',t=>{
 const m=fixture(t);m.set('job',{step:1});rmSync(m.file);mkdirSync(m.file);
 assert.throws(()=>m.set('job',{step:2}));assert.deepEqual(m.get('job'),{step:1});
});
test('memory distinguishes a missing key from an explicitly stored null',t=>{
 const m=fixture(t);assert.equal(m.has('reservations'),false);m.set('reservations',null);assert.equal(m.has('reservations'),true);
 assert.equal(new Memory(m.directory).has('reservations'),true);
});
test('serialization failure cannot advance visible memory and unsafe keys stay rejected',t=>{
 const m=fixture(t);m.set('job',{step:1});assert.throws(()=>m.set('job',{step:2n}));assert.deepEqual(m.get('job'),{step:1});
 for(const key of ['__proto__','constructor','prototype'])assert.throws(()=>m.set(key,{}),/Invalid memory key/);
});
