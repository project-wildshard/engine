// oxlint-disable-next-line import/no-nodejs-modules -- Build fixed entries in a short-lived, explicitly bounded native producer.
import {execFile} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Verify actual source and output bytes before every fresh world.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and retire only this preparation's private temporary directory.
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- No caller supplies an entry URL or output filename.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Import only the freshly generated fixed host.
import {fileURLToPath,pathToFileURL} from 'node:url';
// oxlint-disable-next-line import/no-nodejs-modules -- Await real compiler completion before admitting any worker.
import {promisify} from 'node:util';
import * as v from 'valibot';
import type {ProductWorkerFactory} from './productSession';

const digest=(bytes:Uint8Array):string=>createHash('sha256').update(bytes).digest('hex');
const hash=v.pipe(v.string(),v.regex(/^[a-f0-9]{64}$/u));
const Manifest=v.strictObject({inputs:v.pipe(v.array(v.strictObject({file:v.string(),hash:v.nullable(hash)})),v.minLength(1)),outputs:v.array(v.strictObject({file:v.string(),hash}))});
const Host=v.object({HeadlessSimulation:v.custom<{create:ProductWorkerFactory}>(value=>
  typeof value==='function'&&'create' in value&&typeof value.create==='function')});

/** Fresh compilation, not a persistent result cache. Each caller still starts
 * its own production Worker and fully admits its product and physics world. */
export async function compileProductWorker(root=resolve('.')):Promise<{
  create:ProductWorkerFactory;directory:string;dispose:()=>void;
}> {
  mkdirSync(resolve(root,'tmp'),{recursive:true});
  const directory=mkdtempSync(resolve(root,'tmp','compiled-product-'));
  try{
    const {stdout}=await promisify(execFile)(process.execPath,['--experimental-transform-types',
      fileURLToPath(new URL('./buildProductWorker.ts',import.meta.url)),root,directory],{
      cwd:root,maxBuffer:4*1024*1024,timeout:30_000,
      env:{...process.env,ROLLDOWN_WORKER_THREADS:'1',TOKIO_WORKER_THREADS:'1',RAYON_NUM_THREADS:'1',UV_THREADPOOL_SIZE:'1'},
    });
    const manifest=v.parse(Manifest,JSON.parse(stdout));
    const outputs=['headless.js','headlessWorker.js'].map(name=>resolve(directory,name));
    if(manifest.outputs.length!==outputs.length||manifest.outputs.some((row,index)=>row.file!==outputs[index]))throw new Error('Unexpected fixed headless output inventory');
    const verify=(files:readonly {file:string;hash:string|null}[],message:string):void=>{
      for(const {file,hash}of files){
        if(hash===null){if(!existsSync(file))continue;}
        else try{if(digest(readFileSync(file))===hash)continue;}catch{/* Missing inputs and outputs both refuse. */}
        throw new Error(message);
      }
    };
    verify(manifest.inputs,'Headless preparation source changed');verify(manifest.outputs,'Headless preparation output changed');
    const imported:unknown=await import(pathToFileURL(resolve(directory,'headless.js')).href);
    const host=v.parse(Host,imported);
    let closed=false;
    return {directory,create:async(...args)=>{
      if(closed)throw new Error('Headless preparation is closed');
      verify(manifest.inputs,'Headless preparation source changed');verify(manifest.outputs,'Headless preparation output changed');
      return host.HeadlessSimulation.create(...args);
    },dispose:()=>{if(!closed){closed=true;rmSync(directory,{recursive:true,force:true});}}};
  }catch(error){rmSync(directory,{recursive:true,force:true});throw error;}
}
