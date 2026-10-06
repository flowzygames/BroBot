import { mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync } from 'node:fs'
import { resolve, join, dirname, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readReleaseZip, sha256, safeReleasePath } from './lib/release-archive.js'
import { requiredReleaseFiles, allowedReleasePath } from './build-release.js'

export function verifyReleaseCandidate(bytes,sidecar){
  if(sidecar?.schemaVersion!==1||bytes.length!==sidecar.bytes)throw Error('Release sidecar size or version mismatch')
  const entries=readReleaseZip(bytes,sidecar.sha256),entry=entries.find(file=>file.path==='BroBot/release-candidate.json')
  if(!entry||sha256(entry.data)!==sidecar.manifestSha256)throw Error('Release manifest checksum mismatch')
  const manifest=JSON.parse(entry.data.toString())
  if(manifest.schemaVersion!==1||manifest.channel!=='release-candidate'||!/^[0-9a-f]{40}$/.test(manifest.sourceCommit)||!/^[0-9a-f]{40}$/.test(manifest.sourceTree)
    ||manifest.sourceCommit!==sidecar.sourceCommit||manifest.sourceTree!==sidecar.sourceTree||!Array.isArray(manifest.files)
    ||sha256(JSON.stringify(manifest.files))!==manifest.contentSha256)throw Error('Release manifest identity mismatch')
  const expected=new Map()
  for(const file of manifest.files){
    if(!safeReleasePath(file.path)||!allowedReleasePath(file.path)||expected.has(file.path.toLowerCase()))throw Error('Invalid release manifest path')
    expected.set(file.path.toLowerCase(),file)
  }
  if(entries.length!==expected.size+1)throw Error('Release file set differs')
  for(const file of entries){
    if(file===entry)continue
    if(!file.path.startsWith('BroBot/'))throw Error('Release file outside root')
    const record=expected.get(file.path.slice(7).toLowerCase())
    if(!record||`BroBot/${record.path}`!==file.path||file.data.length!==record.bytes||file.mode!==record.mode||sha256(file.data)!==record.sha256)throw Error('Release file identity mismatch')
  }
  for(const path of requiredReleaseFiles)if(!expected.has(path.toLowerCase()))throw Error(`Missing required release file: ${path}`)
  const json=path=>JSON.parse(entries.find(file=>file.path===`BroBot/${path}`).data.toString())
  const pkg=json('package.json'),lock=json('package-lock.json')
  if(pkg.name!==manifest.packageName||pkg.version!==manifest.packageVersion||pkg.name!==lock.name||pkg.version!==lock.version||pkg.name!==lock.packages?.['']?.name||pkg.version!==lock.packages?.['']?.version)throw Error('Release package identity mismatch')
  return {entries,manifest}
}
export function extractReleaseCandidate(bytes,sidecar,destination){
  const verified=verifyReleaseCandidate(bytes,sidecar),root=resolve(destination)
  mkdirSync(root) // Refuse an existing directory, including a symlink.
  for(const file of verified.entries){
    const target=join(root,file.path)
    mkdirSync(dirname(target),{recursive:true})
    writeFileSync(target,file.data,{flag:'wx',mode:file.mode&0o777})
  }
  return {root:join(root,'BroBot'),manifest:verified.manifest}
}
export function verifyExtractedCandidate(directory,manifest){
  if(lstatSync(directory).isSymbolicLink())throw Error('Extracted root cannot be a symlink')
  if(readFileSync(join(directory,'release-candidate.json'),'utf8')!==`${JSON.stringify(manifest,null,2)}\n`)throw Error('Extracted manifest mismatch')
  const expected=new Map(manifest.files.map(file=>[file.path,file])),seen=new Set()
  const walk=dir=>{for(const name of readdirSync(dir)){const path=join(dir,name),stat=lstatSync(path),rel=relative(directory,path).replaceAll('\\','/');if(stat.isSymbolicLink())throw Error('Extracted symlink is forbidden');if(stat.isDirectory()){walk(path);continue}if(!stat.isFile())throw Error('Unexpected extracted file type');if(rel==='release-candidate.json')continue;const file=expected.get(rel);if(!file||sha256(readFileSync(path))!==file.sha256||stat.size!==file.bytes)throw Error(`Extracted file mismatch: ${rel}`);if(process.platform!=='win32'&&(stat.mode&0o777)!==(file.mode&0o777))throw Error(`Extracted mode mismatch: ${rel}`);seen.add(rel)}}
  walk(directory)
  if(seen.size!==expected.size)throw Error('Extracted release files are missing')
  return true
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [archive,sidecar,destination]=process.argv.slice(2)
  if(!archive||!sidecar||!destination)throw Error('Usage: node scripts/verify-release.js archive.zip sidecar.json fresh-directory')
  const result=extractReleaseCandidate(readFileSync(archive),JSON.parse(readFileSync(sidecar,'utf8')),destination)
  verifyExtractedCandidate(result.root,result.manifest)
  console.log(JSON.stringify({verified:true,sourceCommit:result.manifest.sourceCommit,directory:result.root}))
}
