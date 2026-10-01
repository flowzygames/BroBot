import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../src/commands.js';
import { parseOfflinePhrase } from '../src/offline-commands.js';
test('bounded resource phrases map to exact offline collection actions',()=>{
 for(const text of ['collect 4 oak logs','Please gather four oak logs.','mine 4 oak_log','!bro collect 4 oak logs'])assert.deepEqual(parseCommand(text),{kind:'action',name:'collect',args:{block:'oak_log',count:4}});
 assert.deepEqual(parseCommand('mine two iron ore'),{kind:'action',name:'collect',args:{block:'iron_ore',count:2}});
});
test('crafting phrases use exact owned-inventory actions',()=>{
 assert.deepEqual(parseCommand('make me a furnace'),{kind:'action',name:'craft',args:{item:'furnace',count:1}});
 assert.deepEqual(parseCommand('craft eight oak planks'),{kind:'action',name:'craft',args:{item:'oak_planks',count:8}});
 assert.deepEqual(parseCommand('craft a stone pickaxe'),{kind:'action',name:'craft',args:{item:'stone_pickaxe',count:1}});
});
test('ambiguous, compound, negated and explicit AI requests never become offline actions',()=>{
 for(const text of ['collect some wood','collect 4 logs','do not collect 4 oak logs','collect 4 oak logs and build a house','goal collect 4 oak logs','ask craft a furnace','collect 4 oak logs near my house']){assert.equal(parseOfflinePhrase(text),null,text);assert.equal(parseCommand(text).kind,'goal',text);}
});
test('recognized phrases reject unreasonable amounts rather than falling through to paid AI',()=>{
 for(const count of ['0','65','999999999999999999999'])assert.throws(()=>parseCommand(`collect ${count} oak logs`),/1 to 64/);
});

test('English plural torches stays offline and retains the count boundary', () => {
 assert.deepEqual(parseOfflinePhrase('craft four torches'), {kind:'action',name:'craft',args:{item:'torch',count:4}});
 assert.throws(()=>parseOfflinePhrase('craft 65 torches'), /1 to 64/);
 assert.equal(parseOfflinePhrase('craft 4 oak planks').args.item,'oak_planks');
});
