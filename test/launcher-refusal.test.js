import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { checkLauncherRefusal, runLauncherProcess, launcherRefusalRecord } from '../scripts/lib/launcher-refusal.js'
import { nodeVersionReport } from '../scripts/doctor.js'

function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'brobot launcher '))
  t.after(()=>rmSync(root,{recursive:true,force:true}))
  mkdirSync(join(root,'node_modules'))
  writeFileSync(join(root,'package-lock.json'),'{}\n')
  writeFileSync(join(root,'.env.example'),'OPENAI_API_KEY=\n')
  const complete=()=>{
    writeFileSync(join(root,'.env'),readFileSync(join(root,'.env.example')))
    const hash=createHash('sha256').update(readFileSync(join(root,'package-lock.json'))).digest('hex')
    writeFileSync(join(root,'node_modules','.brobot-lock.sha256'),`${hash}\n`)
    return { status:1, signal:null, error:undefined, stdout:'Minecraft EULA acceptance is required. Read https://www.minecraft.net/eula. No game server has been started.',stderr:'' }
  }
  return {root,complete}
}
for(const platform of ['linux','win32'])test(`modeled ${platform} wrapper invocation checks explicit safe refusal`,async t=>{
  const f=fixture(t);let calls=0
  const result=await checkLauncherRefusal(f.root,{platform,env:{ComSpec:'cmd.exe',OPENAI_API_KEY:'must-not-reach-child'},run:(file,args,options)=>{
    calls++;assert.equal(file,platform==='win32'?'cmd.exe':'sh')
    assert.deepEqual(args,platform==='win32'?['/d','/s','/c','Start-BroBot.cmd']:['./start-brobot.sh'])
    assert.equal(options.cwd,f.root);assert.equal(options.shell,false)
    assert.equal(options.input,platform==='win32'?'\r\n':'\n')
    assert.equal(options.env.OPENAI_API_KEY,'');assert.equal(options.env.MC_PORT,'0')
    assert.equal(options.env.BROBOT_DATA_DIR,join(f.root,'.brobot'));assert.equal(options.env.MC_HOST,'127.0.0.1')
    return f.complete()
  }})
  assert.equal(calls,1);assert.equal(result.passed,true);assert.equal(result.expectedExitCode,1)
})
for(const mode of ['success-exit','wrong-error','signal','spawn-error','cleanup-error','unconfirmed-exit','missing-env','changed-env','missing-marker','wrong-marker','server-files','bot-data','world-start'])test(`launcher gate refuses ${mode}`,async t=>{
  const f=fixture(t)
  const result=await checkLauncherRefusal(f.root,{run:()=>{
    const child=f.complete()
    if(mode==='success-exit')child.status=0
    if(mode==='wrong-error')child.stdout='npm failed'
    if(mode==='signal')child.signal='SIGTERM'
    if(mode==='spawn-error')child.error=Error('spawn failed')
    if(mode==='cleanup-error')child.cleanupError='could not terminate tree'
    if(mode==='unconfirmed-exit')child.processExitObserved=false
    if(mode==='missing-env')rmSync(join(f.root,'.env'))
    if(mode==='changed-env')writeFileSync(join(f.root,'.env'),'changed')
    if(mode==='missing-marker')rmSync(join(f.root,'node_modules','.brobot-lock.sha256'))
    if(mode==='wrong-marker')writeFileSync(join(f.root,'node_modules','.brobot-lock.sha256'),'wrong')
    if(mode==='server-files')mkdirSync(join(f.root,'.server'))
    if(mode==='bot-data')mkdirSync(join(f.root,'.brobot'))
    if(mode==='world-start')child.stdout+='\nStarting your local world.'
    return child
  }})
  assert.equal(result.passed,false)
})
for(const path of ['.env','.server','.brobot','node_modules/.brobot-lock.sha256'])test(`nonfresh ${path} prevents invoking a launcher`,async t=>{
  const f=fixture(t);writeFileSync(join(f.root,path),'present')
  await assert.rejects(checkLauncherRefusal(f.root,{run:()=>assert.fail('must not launch')}),/pristine/)
})
for(const [version,ok] of [['20.19.0',false],['22.0.0',false],['22.8.0',false],['22.9.0',true],['22.10.0',true],['24.0.0',true]])test(`doctor agrees with launcher for Node ${version}`,()=>{
  const report=nodeVersionReport(version)
  assert.equal(report.ok,ok)
  assert.ok(report.message.startsWith(ok?'OK':'FAIL'))
  if(!ok)assert.match(report.message,/22\.9 or newer/)
})


test('launcher-stage exceptions remain explicit failure records', async t => {
  const f=fixture(t);writeFileSync(join(f.root,'.env'),'existing')
  const record=await launcherRefusalRecord(f.root,{run:()=>assert.fail('must not run')})
  assert.equal(record.passed,false);assert.equal(record.exitCode,null)
  assert.match(record.error,/pristine/)
})

test('real process runner captures exit and output', async () => {
  const result=await runLauncherProcess(process.execPath,['-e','console.log("fixture");process.exitCode=1'],{input:'',encoding:'utf8',timeout:5000})
  assert.equal(result.status,1);assert.equal(result.processExitObserved,true)
  assert.match(result.stdout,/fixture/);assert.equal(result.error,null)
})

test('real process runner terminates a timed-out owned process', async () => {
  const result=await runLauncherProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{input:'',encoding:'utf8',timeout:500})
  assert.match(result.error.message,/timed out/)
  assert.equal(result.processExitObserved,true)
  assert.equal(result.cleanupError,null)
})

test('real process runner terminates excessive output', async () => {
  const result=await runLauncherProcess(process.execPath,['-e','setInterval(()=>console.log("x".repeat(10000)),5)'],{input:'',encoding:'utf8',timeout:5000,maxBuffer:1000})
  assert.match(result.error.message,/output limit/)
  assert.equal(result.processExitObserved,true)
  assert.equal(result.cleanupError,null)
})


test('timeout closes inherited pipes held by an owned grandchild', async () => {
  const code='const {spawn}=require("node:child_process"); const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"}); console.log("GRANDCHILD:"+child.pid); setInterval(()=>{},1000)'
  const result=await runLauncherProcess(process.execPath,['-e',code],{input:'',encoding:'utf8',timeout:1500})
  assert.match(result.stdout,/GRANDCHILD:\d+/)
  assert.match(result.error.message,/timed out/)
  // close means both inherited pipe handles drained; the 10-second unconfirmed
  // cleanup fallback must not have been needed.
  assert.equal(result.processExitObserved,true)
  assert.equal(result.cleanupError,null)
})
