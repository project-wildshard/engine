// Keep the proof process alive to write an interrupted/failed receipt.
import {spawn} from 'node:child_process';
import {drainNativeBrowser} from '../../test/fixtures/native-browser-drain.mjs';
import {warmNativeInventory} from '../../test/fixtures/native-process-inventory.mjs';
import {browserQueueClock} from './browser-queue-clock.mjs';

/** @param {string[]} command @param {NodeJS.ProcessEnv} env
 * @param {{timeoutMs?:number,graceMs?:number,capture?:boolean}} [options]
 * @returns {Promise<{status:number|null,signal:NodeJS.Signals|null,error:string|null,queueMs:number,stdout:string,stderr:string}>} */
export async function runT1Child(command,env,{timeoutMs=130_000,graceMs=8000,capture=false}={}){
 const groups=process.platform!=='win32';
 if(groups)warmNativeInventory();
 const clock=browserQueueClock(env),began=Date.now();
 const child=spawn(command[0]??process.execPath,command.slice(1),{env:clock.env,stdio:capture?['ignore','pipe','pipe']:'inherit',detached:groups});
 let stdout='',stderr='';
 child.stdout?.on('data',data=>{stdout+=data;});child.stderr?.on('data',data=>{stderr+=data;});
 /** @type {NodeJS.Signals|null} */let interrupted=null;
 /** @type {ReturnType<typeof setTimeout>|undefined} */let forced;
 const signal=(/** @type {NodeJS.Signals} */kind)=>{
  if(child.exitCode!==null||child.signalCode!==null)return;
  try{if(groups&&child.pid!==undefined)process.kill(-child.pid,kind);else child.kill(kind);}
  catch(error){if(/** @type {NodeJS.ErrnoException} */(error).code!=='ESRCH')throw error;}
 };
 const kill=()=>{signal('SIGKILL');};
 const stop=(/** @type {NodeJS.Signals} */kind)=>{if(interrupted!==null)return;interrupted=kind;signal('SIGTERM');forced??=setTimeout(kill,graceMs);};
 const term=()=>{stop('SIGTERM');},int=()=>{stop('SIGINT');};
 process.once('SIGTERM',term);process.once('SIGINT',int);
 /** @type {string|null} */let clockError=null;
 let deadlineReached=false;
 const queued=()=>{try{return clock.queued(began,Date.now());}catch(error){clockError=String(error);term();return 0;}};
 const deadline=setInterval(()=>{if(Date.now()-began-queued()>=timeoutMs){deadlineReached=true;term();}},Math.min(50,timeoutMs));
 try{
  return await new Promise(_resolve=>{
   /** @type {string|null} */let launchError=null;
   child.once('error',error=>{launchError=error.message;});
   child.once('close',(status,ended)=>{const queueMs=queued();_resolve({status,signal:interrupted??ended,error:launchError??clockError??(deadlineReached?'ETIMEDOUT':null),queueMs,stdout,stderr});});
  });
 }finally{
  clearInterval(deadline);clearTimeout(forced);process.removeListener('SIGTERM',term);process.removeListener('SIGINT',int);
  try{if(groups)await drainNativeBrowser(child,undefined,async()=>{/* The supervisor owns no native profile to dispose. */});else kill();}finally{clock.close();}
 }
}
