import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, supportedNode } from '../scripts/launch.js';

test('launcher checks the actual minimum supported Node version',()=>{
 for(const v of ['22.9.0','22.10.0','24.0.0','v23.1.0'])assert.equal(supportedNode(v),true,v);
 for(const v of ['20.19.0','22.8.0','bad','22'])assert.equal(supportedNode(v),false,v);
});
function fixture(){const root=mkdtempSync(join(tmpdir(),'brobot launch space-'));writeFileSync(join(root,'package-lock.json'),'{}');const calls=[];return {root,calls,cleanup:()=>rmSync(root,{recursive:true,force:true}),run:(cmd,args,options)=>{calls.push({cmd,args,options});if(args[0]==='ci'){mkdirSync(join(root,'node_modules','mineflayer'),{recursive:true});writeFileSync(join(root,'node_modules','mineflayer','package.json'),'{}');}if(args[1]==='setup')writeFileSync(join(root,'.env'),'');return{status:0};}};}
test('first launch installs locked dependencies and runs interactive setup before play',()=>{const f=fixture();try{assert.equal(launch({...f,log:()=>{},version:'24.0.0',platform:'linux'}),0);assert.deepEqual(f.calls.map(x=>x.args),[['ci'],['run','setup'],['run','play']]);f.calls.length=0;launch({...f,log:()=>{},version:'24.0.0'});assert.deepEqual(f.calls.map(x=>x.args),[['run','play']]);}finally{f.cleanup();}});
test('launcher stops after install failure and never starts the server',()=>{const f=fixture();try{const calls=[];assert.equal(launch({...f,log:()=>{},version:'24.0.0',run:(cmd,args)=>{calls.push(args);return{status:1};}}),1);assert.deepEqual(calls,[['ci']]);}finally{f.cleanup();}});
test('Windows launcher invokes npm.cmd with fixed arguments and preserves a spaced working directory',()=>{const f=fixture();try{launch({...f,log:()=>{},version:'24.0.0',platform:'win32'});assert.ok(f.calls.every(c=>c.cmd==='npm.cmd'&&c.options.shell===true&&c.options.cwd===f.root));}finally{f.cleanup();}});
