// Deliberately narrow deterministic ZIP format: stored regular files only.
import { createHash } from 'node:crypto'

export const sha256 = data => createHash('sha256').update(data).digest('hex')
const fail = message => { throw Error(`Invalid release archive: ${message}`) }
const table = Array.from({ length: 256 }, (_, n) => { for (let i=0;i<8;i++) n=n&1?0xedb88320^(n>>>1):n>>>1; return n>>>0 })
const crc32 = bytes => { let crc=0xffffffff; for (const b of bytes) crc=table[(crc^b)&255]^(crc>>>8); return (crc^0xffffffff)>>>0 }
export function safeReleasePath(path) {
  if (typeof path !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(path) || path.length > 240) return false
  return path.split('/').every(part => part && part!=='.' && part!=='..' && !part.endsWith('.')
    && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(part))
}
function checkedEntries(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 10000) fail('entry count')
  const seen=new Set(), directories=new Map(); let total=0
  for (const entry of entries) {
    if (!safeReleasePath(entry.path) || seen.has(entry.path.toLowerCase())) fail('unsafe or duplicate path')
    const key=entry.path.toLowerCase()
    if(directories.has(key))fail('file/directory collision')
    const parts=entry.path.split('/')
    for(let i=1;i<parts.length;i++){
      const prefix=parts.slice(0,i).join('/'),folded=prefix.toLowerCase()
      if(seen.has(folded)||(directories.has(folded)&&directories.get(folded)!==prefix))fail('file/directory or case alias')
      directories.set(folded,prefix)
    }
    seen.add(key)
    if (!Buffer.isBuffer(entry.data) || ![0o100644,0o100755].includes(entry.mode)) fail('entry type')
    total+=entry.data.length
    if (total>128*1024*1024) fail('size limit')
  }
}
export function createReleaseZip(input) {
  const entries=[...input].sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)))
  checkedEntries(entries)
  const locals=[],central=[];let offset=0
  for(const entry of entries){
    const name=Buffer.from(entry.path),crc=crc32(entry.data),size=entry.data.length
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(0x21,12)
    local.writeUInt32LE(crc,14);local.writeUInt32LE(size,18);local.writeUInt32LE(size,22);local.writeUInt16LE(name.length,26)
    locals.push(local,name,entry.data)
    const header=Buffer.alloc(46);header.writeUInt32LE(0x02014b50);header.writeUInt16LE(0x314,4);header.writeUInt16LE(20,6);header.writeUInt16LE(0x800,8);header.writeUInt16LE(0x21,14)
    header.writeUInt32LE(crc,16);header.writeUInt32LE(size,20);header.writeUInt32LE(size,24);header.writeUInt16LE(name.length,28);header.writeUInt32LE((entry.mode*65536)>>>0,38);header.writeUInt32LE(offset,42)
    central.push(header,name);offset+=local.length+name.length+size
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16)
  if(offset+directory.length+end.length>130*1024*1024)fail('archive size')
  return Buffer.concat([...locals,directory,end])
}
export function readReleaseZip(bytes, expectedSha256) {
  if (!/^[0-9a-f]{64}$/.test(expectedSha256??'') || sha256(bytes)!==expectedSha256) fail('archive checksum')
  if(bytes.length<22 || bytes.length>130*1024*1024)fail('archive size')
  const end=bytes.length-22
  if(bytes.readUInt32LE(end)!==0x06054b50 || bytes.readUInt16LE(end+4) || bytes.readUInt16LE(end+6) || bytes.readUInt16LE(end+20))fail('end record')
  const count=bytes.readUInt16LE(end+8),size=bytes.readUInt32LE(end+12),start=bytes.readUInt32LE(end+16)
  if(count!==bytes.readUInt16LE(end+10)||start+size!==end)fail('directory bounds')
  let cursor=start,localOffset=0;const entries=[]
  for(let i=0;i<count;i++){
    if(cursor+46>end||bytes.readUInt32LE(cursor)!==0x02014b50)fail('central header')
    const h=bytes.subarray(cursor,cursor+46),length=h.readUInt16LE(28),n=bytes.subarray(cursor+46,cursor+46+length)
    if(cursor+46+length>end||h.readUInt16LE(4)!==0x314||h.readUInt16LE(6)!==20||h.readUInt16LE(8)!==0x800||h.readUInt16LE(10)||h.readUInt16LE(12)||h.readUInt16LE(14)!==0x21
      ||h.readUInt16LE(30)||h.readUInt16LE(32)||h.readUInt16LE(34)||h.readUInt16LE(36)||h.readUInt32LE(42)!==localOffset)fail('unsupported central entry')
    const lengthData=h.readUInt32LE(24),mode=h.readUInt32LE(38)>>>16
    if(h.readUInt32LE(38)!==((mode*65536)>>>0))fail('unsupported file attributes')
    if(h.readUInt32LE(20)!==lengthData||localOffset+30+length+lengthData>start)fail('entry bounds')
    const local=bytes.subarray(localOffset,localOffset+30),name=bytes.subarray(localOffset+30,localOffset+30+length)
    if(local.readUInt32LE(0)!==0x04034b50||local.readUInt16LE(4)!==20||local.readUInt16LE(6)!==0x800||local.readUInt16LE(8)||local.readUInt16LE(10)||local.readUInt16LE(12)!==0x21
      ||local.readUInt32LE(14)!==h.readUInt32LE(16)||local.readUInt32LE(18)!==lengthData||local.readUInt32LE(22)!==lengthData||local.readUInt16LE(26)!==length||local.readUInt16LE(28)||!name.equals(n))fail('local/central mismatch')
    const data=bytes.subarray(localOffset+30+length,localOffset+30+length+lengthData)
    if(crc32(data)!==h.readUInt32LE(16))fail('entry checksum')
    entries.push({path:n.toString('utf8'),data,mode});localOffset+=30+length+lengthData;cursor+=46+length
  }
  if(cursor!==end||localOffset!==start)fail('unaccounted archive bytes')
  checkedEntries(entries)
  return entries
}
