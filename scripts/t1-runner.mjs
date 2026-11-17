// Keep the proof process alive to write an interrupted/failed receipt.
import {spawn} from 'node:child_process';

/** @param {string[]} command @param {NodeJS.ProcessEnv} env
 * @param {{timeoutMs?:number,graceMs?:number}} [options]
 * @returns {Promise<{status:number|null,signal:NodeJS.Signals|null,error:string|null}>} */
export async function runT1Child(command,env,{timeoutMs=130_000,graceMs=8000}={}){
 const groups=process.platform!=='win32';
 const child=spawn(command[0]??process.execPath,command.slice(1),{env,stdio:'inherit',detached:groups});
 /** @type {NodeJS.Signals|null} */let interrupted=null;
 /** @type {ReturnType<typeof setTimeout>|undefined} */let forced;
 const signal=(/** @type {NodeJS.Signals} */kind)=>{
  try{if(groups&&child.pid!==undefined)process.kill(-child.pid,kind);else child.kill(kind);}
  catch(error){if(/** @type {NodeJS.ErrnoException} */(error).code!=='ESRCH')throw error;}
 };
 const kill=()=>{signal('SIGKILL');};
 const stop=(/** @type {NodeJS.Signals} */kind)=>{interrupted??=kind;signal('SIGTERM');forced??=setTimeout(kill,graceMs);};
 const term=()=>{stop('SIGTERM');},int=()=>{stop('SIGINT');};
 process.once('SIGTERM',term);process.once('SIGINT',int);
 const deadline=setTimeout(term,timeoutMs);
 try{
  return await new Promise(_resolve=>{
   child.once('error',error=>{_resolve({status:null,signal:interrupted,error:error.message});});
   child.once('close',(status,ended)=>{_resolve({status,signal:interrupted??ended,error:null});});
  });
 }finally{kill();clearTimeout(deadline);clearTimeout(forced);process.removeListener('SIGTERM',term);process.removeListener('SIGINT',int);}
}
