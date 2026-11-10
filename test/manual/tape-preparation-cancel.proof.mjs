// Explicit outer-edge lifecycle proof; never imported by test or Git hooks.
// node --experimental-transform-types test/manual/tape-preparation-cancel.proof.mjs
// oxlint-disable-next-line import/no-nodejs-modules -- Assert real process exit and owned-output retirement.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Start and cancel only the actual owned producer and fixed fixture.
import {spawn,execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Observe only this proof's uniquely created output folders.
import {readdirSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve fixed checked-in fixture and native loader paths.
import {resolve as resolvePath} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Import only the fixed source simulation loader.
import {pathToFileURL} from 'node:url';
import {compileProductWorker} from '../fixtures/headless/compileProductWorker.ts';

const pause=ms=>new Promise(resolve=>{setTimeout(resolve,ms);});
const within=async(pending,ms,message)=>{let timer;try{return await Promise.race([pending,new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]);}finally{clearTimeout(timer);}};
const folders=()=>new Set(readdirSync('tmp').filter(name=>name.startsWith('compiled-product-')));
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
const until=async predicate=>{const end=performance.now()+4000;for(;;){const value=predicate();if(value)return value;if(performance.now()>end)throw new Error('Owned child never reached preparation boundary');await pause(5);}};
const children=parent=>execFileSync('ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).trim().split('\n').map(line=>/^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line)).filter(row=>row&&Number(row[2])===parent&&row[3].includes('buildProductWorker.ts')).map(row=>Number(row[1]));
const clean=before=>assert.deepEqual([...folders()].filter(name=>!before.has(name)),[],'owned preparation folder survived cancellation');

// Stop the actual native producer, not a stand-in: abort must kill and reap it
// even while it cannot process an ordinary termination event.
{
 const before=folders(),controller=new AbortController();let pid,live;
 const pending=compileProductWorker(undefined,controller.signal);
 void pending.then(value=>{live=value;return undefined;}).catch(()=>undefined);
 try{
  pid=await until(()=>children(process.pid)[0]);process.kill(pid,'SIGSTOP');
  controller.abort();
  await within(assert.rejects(pending,/abort/iu),1500,'Stopped compiler survived abort');
  assert.equal(alive(pid),false,'abort returned before compiler reaping');clean(before);
 }finally{
  if(pid&&alive(pid))process.kill(pid,'SIGKILL');
  await pending.catch(()=>undefined);live?.dispose();
 }
}

// Terminate the real bounded fixture after its fixed code is ready, while it
// owns fresh native worker startup. The same SIGTERM path is used at20seconds.
{
 const before=folders(),child=spawn(process.execPath,['--experimental-transform-types','--import',pathToFileURL(resolvePath('scripts/sim-node-loader.mjs')).href,resolvePath('test/fixtures/headless/tape-parts-run.mjs')],{stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
 const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{resolve({code,signal});});});
 try{
  await until(()=>stdout.includes('tape worker preparation complete'));
  assert.notEqual(child.pid,undefined);assert.equal(child.exitCode,null);child.kill('SIGTERM');
  const result=await within(closed,1500,`Fixture did not retire after SIGTERM: ${stderr}`);
  assert.equal(result.code,143);assert.equal(alive(child.pid),false);assert.deepEqual(children(child.pid),[]);clean(before);
 }finally{
  if(child.exitCode===null&&child.signalCode===null){
   const producers=children(child.pid);child.kill('SIGTERM');
   try{await within(closed,1500,'Fixture cleanup did not close');}
   finally{for(const pid of producers)if(alive(pid))process.kill(pid,'SIGKILL');if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;}
  }
 }
}
console.info('real stopped compiler and running tape fixture retire with no producer or output left');
