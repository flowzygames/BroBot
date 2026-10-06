import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createReleaseZip, safeReleasePath, sha256 } from './lib/release-archive.js'

const rootFiles=new Set(['.env.example','package.json','package-lock.json','README.md','LICENSE','Start-BroBot.cmd','start-brobot.sh','MINING_CONFIRMATION.md','STARTER_LEAF_SUPPORT.md'])
const roots=new Set(['src','public','scripts','test','docs','LICENSES'])
export const requiredReleaseFiles=['.env.example','package.json','package-lock.json','README.md','LICENSE','LICENSES/Mineflayer.txt','Start-BroBot.cmd','start-brobot.sh','src/index.js','scripts/launch.js','scripts/check.js','public/index.html']
export function allowedReleasePath(path){
  if(!safeReleasePath(path))return false
  if(rootFiles.has(path))return true
  if(!roots.has(path.split('/')[0]))return false
  return !path.split('/').some(part=>part.startsWith('.')||part==='node_modules'||/\.(log|pem|key)$/i.test(part))
}
export function buildReleaseCandidate(repo,revision){
  if(!/^[0-9a-f]{40}$/.test(revision??''))throw Error('Provide a full frozen source commit SHA')
  const git=args=>execFileSync('git',args,{cwd:repo,maxBuffer:32*1024*1024})
  const sourceCommit=git(['rev-parse',`${revision}^{commit}`]).toString().trim()
  const sourceTree=git(['rev-parse',`${sourceCommit}^{tree}`]).toString().trim()
  const rows=git(['ls-tree','-rz','--full-tree',sourceCommit]).toString().split('\0').filter(Boolean)
  const files=[]
  for(const row of rows){
    const match=/^(\d+) (\w+) ([0-9a-f]+)\t(.+)$/.exec(row);if(!match)throw Error('Malformed Git tree entry')
    const [,mode,type,blob,path]=match
    if(!allowedReleasePath(path))continue
    if(type!=='blob'||!['100644','100755'].includes(mode))throw Error(`Release path is not a regular file: ${path}`)
    const data=git(['cat-file','blob',blob])
    files.push({path,data,mode:path==='start-brobot.sh'?0o100755:0o100644})
  }
  files.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)))
  for(const path of requiredReleaseFiles)if(!files.some(file=>file.path===path))throw Error(`Missing required release file: ${path}`)
  const json=path=>JSON.parse(files.find(file=>file.path===path).data.toString())
  const pkg=json('package.json'),lock=json('package-lock.json')
  if(pkg.name!==lock.name||pkg.version!==lock.version||pkg.name!==lock.packages?.['']?.name||pkg.version!==lock.packages?.['']?.version)throw Error('Package and lockfile identities differ')
  const inventory=files.map(({path,data,mode})=>({path,sha256:sha256(data),bytes:data.length,mode}))
  const manifest={schemaVersion:1,channel:'release-candidate',sourceCommit,sourceTree,packageName:pkg.name,packageVersion:pkg.version,
    evidence:{status:'not_run',note:'Source history and README counts are not verification of this artifact. Historical benchmark archives are excluded; consult the frozen source repository.'},
    files:inventory,contentSha256:sha256(JSON.stringify(inventory))}
  const manifestBytes=Buffer.from(`${JSON.stringify(manifest,null,2)}\n`)
  const archive=createReleaseZip([...files.map(file=>({...file,path:`BroBot/${file.path}`})),{path:'BroBot/release-candidate.json',data:manifestBytes,mode:0o100644}])
  const sidecar={schemaVersion:1,archive:`brobot-candidate-${sourceCommit.slice(0,12)}.zip`,sha256:sha256(archive),bytes:archive.length,sourceCommit,sourceTree,manifestSha256:sha256(manifestBytes)}
  return {archive,manifest,sidecar}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [commit,output='dist']=process.argv.slice(2)
  const result=buildReleaseCandidate(process.cwd(),commit),dir=resolve(output)
  mkdirSync(dir,{recursive:true})
  writeFileSync(join(dir,result.sidecar.archive),result.archive,{flag:'wx'})
  writeFileSync(join(dir,`${result.sidecar.archive}.json`),`${JSON.stringify(result.sidecar,null,2)}\n`,{flag:'wx'})
  console.log(JSON.stringify(result.sidecar,null,2))
}
