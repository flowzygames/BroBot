// Development trace only; instrumentation changes timing. Never label this as
// a normal benchmark score. Use --seconds=120 and a known diagnostic seed.
import {appendFileSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {EmptySearchContinuation} from '../src/empty-search-continuation.js'
import {installSearchTrace} from './lib/search-trace.js'
const output=process.env.BROBOT_SEARCH_TRACE_FILE
if(!output)throw Error('Set BROBOT_SEARCH_TRACE_FILE to an explicit local diagnostic file')
const root=resolve(fileURLToPath(new URL('..',import.meta.url)))
const repo=process.argv.find(a=>a.startsWith('--repo='))?.slice(7)
if(resolve(repo??'.')!==root)throw Error('Trace must run the same repository that owns the instrumented class')
if(!process.argv.find(a=>a.startsWith('--label='))?.slice(8).startsWith('diagnostic-'))throw Error('Use a diagnostic- label; this is not a scored benchmark')
writeFileSync(output,JSON.stringify({kind:'observational-search-trace',timingAffected:true,limit:2000})+'\n',{flag:'wx'})
const restore=installSearchTrace(EmptySearchContinuation,entry=>appendFileSync(output,JSON.stringify(entry)+'\n'))
try{await import('./benchmark-survival.js')}finally{restore()}
