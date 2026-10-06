import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createReleaseZip, readReleaseZip, sha256 } from '../scripts/lib/release-archive.js'
import { buildReleaseCandidate, requiredReleaseFiles } from '../scripts/build-release.js'
import { verifyReleaseCandidate, extractReleaseCandidate, verifyExtractedCandidate } from '../scripts/verify-release.js'
const entry=(path,data='hello')=>({path,data:Buffer.from(data),mode:0o100644})
function temp(t){const dir=mkdtempSync(join(tmpdir(),'brobot release '));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir}
function fixture(t){
  const repo=temp(t),git=args=>execFileSync('git',args,{cwd:repo,stdio:['ignore','pipe','pipe']}).toString().trim()
  git(['init','-q']);git(['config','core.autocrlf','false'])
  for(const path of requiredReleaseFiles){mkdirSync(dirname(join(repo,path)),{recursive:true});writeFileSync(join(repo,path),'fixture\n')}
  writeFileSync(join(repo,'package.json'),JSON.stringify({name:'brobot',version:'1.0.0'}))
  writeFileSync(join(repo,'package-lock.json'),JSON.stringify({name:'brobot',version:'1.0.0',packages:{'':{name:'brobot',version:'1.0.0'}}}))
  writeFileSync(join(repo,'.env'),'SECRET_MUST_NOT_SHIP=example')
  mkdirSync(join(repo,'showcase'));writeFileSync(join(repo,'showcase','brobot-dev.zip'),'historical')
  git(['add','.']);git(['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','fixture'])
  return{repo,git,commit:git(['rev-parse','HEAD'])}
}

test('stored ZIP is deterministic and round-trips sorted regular entries',()=>{
  const input=[entry('BroBot/b'),entry('BroBot/a')],a=createReleaseZip(input),b=createReleaseZip([...input].reverse())
  assert.deepEqual(a,b);assert.deepEqual(readReleaseZip(a,sha256(a)).map(x=>x.path),['BroBot/a','BroBot/b'])
  assert.throws(()=>readReleaseZip(a,'0'.repeat(64)),/checksum/)
})
for(const paths of [['../outside'],['/absolute'],['C:/drive'],['BroBot\\file'],['BroBot/CON.txt'],['a','A'],['a','a/b'],['A/a','a/b']])test(`unsafe ZIP paths refuse: ${paths.join(',')}`,()=>{
  assert.throws(()=>createReleaseZip(paths.map(path=>entry(path))),/Invalid release archive/)
})
for(const change of ['crc','local-name','central-offset','flags','truncated','trailing'])test(`ZIP corruption refuses after outer checksum refresh: ${change}`,()=>{
  let bytes=Buffer.from(createReleaseZip([entry('BroBot/a')]))
  const end=bytes.length-22,central=bytes.readUInt32LE(end+16)
  if(change==='crc')bytes[38]^=1
  if(change==='local-name')bytes[30]^=1
  if(change==='central-offset')bytes.writeUInt32LE(2,central+42)
  if(change==='flags')bytes.writeUInt16LE(0x801,central+8)
  if(change==='truncated')bytes=bytes.subarray(0,-1)
  if(change==='trailing')bytes=Buffer.concat([bytes,Buffer.from([0])])
  assert.throws(()=>readReleaseZip(bytes,sha256(bytes)))
})

test('candidate freezes committed bytes, excludes secrets and preserves historical download',t=>{
  const f=fixture(t),first=buildReleaseCandidate(f.repo,f.commit)
  writeFileSync(join(f.repo,'src/index.js'),'dirty replacement')
  writeFileSync(join(f.repo,'src/untracked.js'),'untracked secret')
  const second=buildReleaseCandidate(f.repo,f.commit)
  assert.deepEqual(first.archive,second.archive);assert.deepEqual(first.sidecar,second.sidecar)
  const verified=verifyReleaseCandidate(first.archive,first.sidecar)
  assert.ok(!verified.entries.some(x=>x.path==='BroBot/.env'||x.path.includes('untracked')||x.path.includes('showcase')))
  assert.ok(verified.entries.some(x=>x.path==='BroBot/LICENSES/Mineflayer.txt'))
  assert.equal(readFileSync(join(f.repo,'showcase/brobot-dev.zip'),'utf8'),'historical')
  assert.equal(verified.manifest.evidence.status,'not_run')
})

test('allowlisted Git symlink and missing required notice both refuse',t=>{
  const f=fixture(t)
  const blob=f.git(['hash-object','-w','--stdin']) // Empty symlink target blob; never followed.
  f.git(['update-index','--add','--cacheinfo',`120000,${blob},src/link`])
  f.git(['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','symlink'])
  assert.throws(()=>buildReleaseCandidate(f.repo,f.git(['rev-parse','HEAD'])),/regular file/)
  f.git(['rm','--cached','src/link']);f.git(['rm','LICENSES/Mineflayer.txt'])
  f.git(['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','missing notice'])
  assert.throws(()=>buildReleaseCandidate(f.repo,f.git(['rev-parse','HEAD'])),/Missing required/)
})

test('safe extraction into a path with spaces verifies, refusing reused destination',t=>{
  const f=fixture(t),built=buildReleaseCandidate(f.repo,f.commit),target=join(f.repo,'candidate extraction')
  const extracted=extractReleaseCandidate(built.archive,built.sidecar,target)
  assert.equal(verifyExtractedCandidate(extracted.root,extracted.manifest),true)
  assert.throws(()=>extractReleaseCandidate(built.archive,built.sidecar,target),/EEXIST/)
  assert.equal(verifyExtractedCandidate(extracted.root,extracted.manifest),true)
})
for(const change of ['file','missing','extra','manifest','mode'])test(`extracted ${change} tampering refuses`,t=>{
  if(change==='mode'&&process.platform==='win32')return t.skip('POSIX mode check')
  const f=fixture(t),built=buildReleaseCandidate(f.repo,f.commit),extracted=extractReleaseCandidate(built.archive,built.sidecar,join(f.repo,'extract'))
  if(change==='file')writeFileSync(join(extracted.root,'src/index.js'),'changed')
  if(change==='missing')rmSync(join(extracted.root,'src/index.js'))
  if(change==='extra')writeFileSync(join(extracted.root,'extra.txt'),'extra')
  if(change==='manifest')writeFileSync(join(extracted.root,'release-candidate.json'),'{}')
  if(change==='mode')chmodSync(join(extracted.root,'start-brobot.sh'),0o644)
  assert.throws(()=>verifyExtractedCandidate(extracted.root,extracted.manifest),/mismatch|missing/)
})

for(const change of ['excluded-file','missing-required','lock-identity','manifest-digest'])test(`self-consistent outer checksums do not hide ${change}`,t=>{
  const f=fixture(t),built=buildReleaseCandidate(f.repo,f.commit),entries=readReleaseZip(built.archive,built.sidecar.sha256)
  const manifestEntry=entries.find(file=>file.path==='BroBot/release-candidate.json'),manifest=JSON.parse(manifestEntry.data)
  if(change==='excluded-file'){
    const extra=entry('BroBot/.env','secret');entries.push(extra)
    manifest.files.push({path:'.env',sha256:sha256(extra.data),bytes:extra.data.length,mode:extra.mode})
  }
  if(change==='missing-required'){
    entries.splice(entries.findIndex(file=>file.path==='BroBot/LICENSES/Mineflayer.txt'),1)
    manifest.files=manifest.files.filter(file=>file.path!=='LICENSES/Mineflayer.txt')
  }
  if(change==='lock-identity'){
    const lock=entries.find(file=>file.path==='BroBot/package-lock.json');lock.data=Buffer.from(JSON.stringify({name:'wrong',version:'1.0.0'}))
    Object.assign(manifest.files.find(file=>file.path==='package-lock.json'),{sha256:sha256(lock.data),bytes:lock.data.length})
  }
  manifest.contentSha256=change==='manifest-digest'?'0'.repeat(64):sha256(JSON.stringify(manifest.files))
  manifestEntry.data=Buffer.from(`${JSON.stringify(manifest,null,2)}\n`)
  const archive=createReleaseZip(entries),sidecar={...built.sidecar,sha256:sha256(archive),bytes:archive.length,manifestSha256:sha256(manifestEntry.data)}
  assert.throws(()=>verifyReleaseCandidate(archive,sidecar))
})
