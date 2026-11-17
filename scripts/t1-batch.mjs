// J400: all T1 suites consume the producer's bytes on that same runner.
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {T1_SHARDS} from './t1-shards.mjs';

/** Retain every suite's ordinary exit, and drain all owned children.
 * @param {string[]} command @param {NodeJS.ProcessEnv} [env] */
export async function runT1Batch(command,env=process.env){
 const groups=process.platform!=='win32';
 const children=Object.keys(T1_SHARDS).map(suite=>spawn(command[0]??process.execPath,command.slice(1),{
  env:{...env,WS_T1_SHARD:suite},stdio:'inherit',detached:groups,
 }));
 const signal=(/** @type {NodeJS.Signals} */kind)=>{for(const child of children){
  try{if(groups&&child.pid!==undefined)process.kill(-child.pid,kind);else child.kill(kind);}catch(error){if(/** @type {NodeJS.ErrnoException} */(error).code!=='ESRCH')throw error;}
 }};
 let interrupted=false;
 /** @type {ReturnType<typeof setTimeout>|undefined} */let forced;
 const kill=()=>{signal('SIGKILL');};
 // Each proof has 8 s to stop its own group, then 2 s to write the receipt.
 const stop=()=>{interrupted=true;signal('SIGTERM');forced??=setTimeout(kill,10000);};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 // The proof enforces each original 120 s budget; this also fences a setup
 // hang before it can write a receipt. Keep ordinary child failure nonzero.
 const deadline=setTimeout(stop,180_000);
 try{
  const codes=await Promise.all(children.map(child=>new Promise(_resolve=>{
   child.once('error',()=>_resolve(1));child.once('close',code=>_resolve(code??1));
  })));
  return !interrupted&&codes.every(code=>code===0)?0:1;
 }finally{kill();clearTimeout(deadline);clearTimeout(forced);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 process.exitCode=await runT1Batch([process.execPath,'scripts/t1-ci-proof.mjs']);
