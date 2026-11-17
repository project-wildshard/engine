// J400: all T1 suites consume the producer's bytes on that same runner.
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {T1_SHARDS} from './t1-shards.mjs';
import {drainNativeBrowser} from '../test/fixtures/native-browser-drain.mjs';
import {warmNativeInventory} from '../test/fixtures/native-process-inventory.mjs';
import {browserQueueClock} from './browser-queue-clock.mjs';
import {randomUUID} from 'node:crypto';

/** Retain every suite's ordinary exit, and drain all owned children.
 * @param {string[]} command @param {NodeJS.ProcessEnv} [env] */
export async function runT1Batch(command,env=process.env){
 const groups=process.platform!=='win32';
 if(groups)warmNativeInventory();
 const clock=browserQueueClock(env),began=Date.now();
 const scopes=Object.keys(T1_SHARDS).map(()=>randomUUID());clock.scopes(scopes,true);
 const children=Object.keys(T1_SHARDS).map((suite,index)=>spawn(command[0]??process.execPath,command.slice(1),{
  env:{...clock.env,WS_T1_SHARD:suite,WS_BROWSER_QUEUE_SCOPE:scopes[index]},stdio:'inherit',detached:groups,
 }));
 for(const [index,child]of children.entries())child.once('close',()=>{const scope=scopes[index];if(scope!==undefined)clock.scopes([scope],false);});
 const signal=(/** @type {NodeJS.Signals} */kind)=>{for(const child of children){
  if(child.exitCode!==null||child.signalCode!==null)continue;
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
 const deadline=setInterval(()=>{try{if(Date.now()-began-clock.queued(began,Date.now(),scopes)>=180_000)stop();}catch{stop();}},100);
 try{
  const codes=await Promise.all(children.map(child=>new Promise(_resolve=>{
   child.once('error',()=>_resolve(1));child.once('close',code=>_resolve(code??1));
  })));
  return !interrupted&&codes.every(code=>code===0)?0:1;
 }finally{
  clearInterval(deadline);clearTimeout(forced);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  try{if(groups)await Promise.all(children.map(child=>drainNativeBrowser(child,undefined,async()=>{/* The supervisor owns no native profile to dispose. */})));else kill();}finally{clock.close();}
 }
}
if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 process.exitCode=await runT1Batch([process.execPath,'scripts/t1-ci-proof.mjs']);
