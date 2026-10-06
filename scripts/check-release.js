// Candidate acceptance gate only: no Minecraft launch or EULA acceptance.
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { buildReleaseCandidate } from './build-release.js'
import { extractReleaseCandidate, verifyExtractedCandidate } from './verify-release.js'

const [commit,output='dist/artifact-check']=process.argv.slice(2)
if(!process.env.npm_execpath)throw Error('Run through npm run check:release -- <full-commit> [fresh-directory]')
const candidate=buildReleaseCandidate(process.cwd(),commit),directory=resolve(output)
mkdirSync(dirname(directory),{recursive:true})
mkdirSync(directory) // Fresh only. Never replace a tested artifact or installation.
writeFileSync(join(directory,candidate.sidecar.archive),candidate.archive,{flag:'wx'})
writeFileSync(join(directory,`${candidate.sidecar.archive}.json`),`${JSON.stringify(candidate.sidecar,null,2)}\n`,{flag:'wx'})
const extracted=extractReleaseCandidate(candidate.archive,candidate.sidecar,join(directory,'extracted candidate'))
verifyExtractedCandidate(extracted.root,extracted.manifest)
const result={schemaVersion:1,sourceCommit:candidate.sidecar.sourceCommit,archiveSha256:candidate.sidecar.sha256,
  platform:process.platform,node:process.version,started:new Date().toISOString(),passed:false,checks:[]}
try{
  for(const args of [['ci'],['run','check']]){
    const run=spawnSync(process.execPath,[process.env.npm_execpath,...args],{cwd:extracted.root,stdio:'inherit',windowsHide:true})
    result.checks.push({command:['npm',...args].join(' '),exitCode:run.status,error:run.error?.message??null,signal:run.signal??null})
    if(run.error||run.status!==0)throw Error(`Extracted artifact failed npm ${args.join(' ')}`)
  }
  result.passed=true
}finally{
  result.finished=new Date().toISOString()
  writeFileSync(join(directory,'verification.json'),`${JSON.stringify(result,null,2)}\n`,{flag:'wx'})
}
