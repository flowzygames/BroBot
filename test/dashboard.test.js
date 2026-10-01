import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
function fixture() {
  const elements = new Map();
  const element = () => ({ textContent: '', value: '', disabled: false, children: [], scrollHeight: 100, scrollTop: 100, clientHeight: 100, append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes; } });
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const context = { document: { getElementById: get, createElement: element, createTextNode: text => ({ textContent: text }), querySelectorAll: () => [] }, fetch: () => new Promise(() => {}), setTimeout: () => {}, confirm: () => false, console };
  runInNewContext(source, context);
  const state = { connected: true, connection: 'connected', inventory: [], events: [], tools: [], memory: { waypoints: {} }, ai: { configured: false, usage: {requests:0,inputTokens:0,outputTokens:0},limits:{requests:10} } };
  return {get,context,state,draw:()=>context.draw(state)};
}
test('dashboard offers offline starter without requiring an API key', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /data-command="survive starter"/);
  assert.match(html, /data-command="survive resume"/);
  assert.doesNotMatch(html, /data-command="goal Help me get started/);
  const f=fixture();f.draw();
  assert.equal(f.get('aimode').textContent,'Offline controls');
  assert.equal(f.get('startstarter').disabled,false);
  assert.equal(f.get('resumestarter').disabled,true);
});
test('starter resume is available only when paused or blocked and idle', () => {
  const f=fixture();
  for (const status of ['paused','blocked']) {f.state.survival={status,steps:12,scouts:2,reason:'Review route'};f.draw();assert.equal(f.get('resumestarter').disabled,false);assert.equal(f.get('starterreason').textContent,'Review route');}
  for (const status of ['running','complete']) {f.state.survival.status=status;f.draw();assert.equal(f.get('resumestarter').disabled,true);}
  f.state.survival.status='paused';f.state.action={name:'collect',stopping:true};f.draw();assert.equal(f.get('resumestarter').disabled,true);
  f.state.action=null;f.state.connected=false;f.draw();assert.equal(f.get('startstarter').disabled,true);assert.equal(f.get('resumestarter').disabled,true);
});
test('starter checklist reads current inventory and never infers completion from tools alone', () => {
  const f=fixture();f.state.inventory=[{name:'stone_pickaxe',count:1},{name:'furnace',count:1}];f.state.survival={status:'running',steps:15,scouts:0};f.draw();
  assert.equal(f.get('starterchecklist').children[0].textContent,'✓ Stone pickaxe');
  assert.equal(f.get('starterchecklist').children[2].textContent,'○ Verified return home');
  f.state.survival.status='complete';f.draw();assert.equal(f.get('starterchecklist').children[2].textContent,'✓ Verified return home');
});
test('failed commands keep the draft and duplicate submissions are ignored',async()=>{
 const f=fixture();let finish,calls=0;f.context.fetch=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};f.get('command').value='collect stone';
 const a=f.get('commandform').onsubmit({preventDefault(){}});await f.get('commandform').onsubmit({preventDefault(){}});assert.equal(calls,1);
 finish({ok:false,json:async()=>({error:'Still stopping'})});await a;assert.equal(f.get('command').value,'collect stone');assert.equal(f.get('notice').textContent,'Still stopping');
});
test('successful submission preserves a newer draft typed while sending',async()=>{
 const f=fixture();let finish;f.context.fetch=()=>new Promise(resolve=>{finish=resolve;});f.get('command').value='inventory';const a=f.get('commandform').onsubmit({preventDefault(){}});f.get('command').value='follow me';finish({ok:true,json:async()=>({})});await a;assert.equal(f.get('command').value,'follow me');
});
