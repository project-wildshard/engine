// oxlint-disable-next-line import/no-nodejs-modules -- A bounded native producer creates the fixed production entry.
import {execFile} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Recheck complete bytes before every sandboxed job.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Own only this preparation's private temporary output.
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- No caller supplies an entry or output filename.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Locate the fixed compiler beside this helper.
import {fileURLToPath} from 'node:url';
// oxlint-disable-next-line import/no-nodejs-modules -- Reap the producer before output cleanup.
import {promisify} from 'node:util';
import * as v from 'valibot';

const digest=(bytes:Uint8Array):string=>createHash('sha256').update(bytes).digest('hex');
const hash=v.pipe(v.string(),v.regex(/^[a-f0-9]{64}$/u));
const Manifest=v.strictObject({inputs:v.pipe(v.array(v.strictObject({file:v.string(),hash:v.nullable(hash)})),v.minLength(1)),output:v.strictObject({file:v.string(),hash})});

/** Immutable code only, prepared afresh inside the original suite clock. Every
 * job still owns its ordinary permission-limited Node process and original CPU,
 * memory, network, output and q11 encoder limits. There is no reusable verdict. */
export async function compileCookWorker(signal:AbortSignal):Promise<{readonly script:string;dispose:()=>void}> {
  signal.throwIfAborted();const root=resolve('.');mkdirSync(resolve(root,'tmp'),{recursive:true});
  const directory=mkdtempSync(resolve(root,'tmp','compiled-cook-'));
  try{
    const compiling=promisify(execFile)(process.execPath,['--experimental-transform-types',fileURLToPath(new URL('./buildCookWorker.ts',import.meta.url)),root,directory],{
      cwd:root,maxBuffer:4*1024*1024,timeout:10_000,killSignal:'SIGKILL',
      env:{...process.env,ROLLDOWN_WORKER_THREADS:'1',TOKIO_WORKER_THREADS:'1',RAYON_NUM_THREADS:'1',UV_THREADPOOL_SIZE:'1'},
    });
    const closed=new Promise<void>(done=>{compiling.child.once('close',()=>{done();});});
    const abort=():void=>{compiling.child.kill('SIGKILL');};signal.addEventListener('abort',abort,{once:true});
    let stdout:string;
    try{({stdout}=await compiling);}catch(error){signal.throwIfAborted();throw error;}
    finally{await closed;signal.removeEventListener('abort',abort);}
    signal.throwIfAborted();const manifest=v.parse(Manifest,JSON.parse(stdout)),script=resolve(directory,'cook-job.mjs');
    if(manifest.output.file!==script)throw new Error('Unexpected fixed cook output');
    const verify=():void=>{
      for(const {file,hash}of [...manifest.inputs,manifest.output]){
        if(hash===null){if(!existsSync(file))continue;}
        else try{if(digest(readFileSync(file))===hash)continue;}catch{/* Missing source/output refuses. */}
        throw new Error('Cook preparation bytes changed');
      }
    };
    verify();let retired=false;
    const dispose=():void=>{if(!retired){retired=true;signal.removeEventListener('abort',dispose);rmSync(directory,{recursive:true,force:true});}};
    signal.addEventListener('abort',dispose,{once:true});
    return {get script(){if(retired)throw new Error('Cook preparation is closed');signal.throwIfAborted();verify();return script;},dispose};
  }catch(error){rmSync(directory,{recursive:true,force:true});throw error;}
}
