// Real global flock owner, normal hook command and separate bounded wait.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve as resolvePath} from 'node:path';

const base=resolvePath(process.argv[2]??'tmp/queue-admission-proof');mkdirSync(base,{recursive:true});
const work=mkdtempSync(join(base,'run-')),root=join(work,'scheduler'),marker=join(work,'hook-ran');
/** @type {NodeJS.ProcessEnv} */const env={...process.env,WS_FULL_SUITE:'1',WS_HEAVY_ROOT:root,WS_HEAVY_SCHEDULER_ROOT:root};delete env.WS_HEAVY_TOKEN;
const holder=spawn('python3',['scripts/heavy-lane.py','full-test','--',process.execPath,'-e',"console.log('ready');process.stdin.resume()"],{env,stdio:['pipe','pipe','pipe']});
const observed={ready:false};holder.stdout.on('data',data=>{if(data.toString().includes('ready'))observed.ready=true;});
const ended=new Promise(resolve=>{holder.once('exit',resolve);});
try{
 const began=Date.now();while(!observed.ready&&Date.now()-began<5000)await new Promise(resolve=>{setTimeout(resolve,10);});assert.ok(observed.ready);
 const refused=spawn('python3',['scripts/push-queue-admission.py','--checkout',process.cwd(),'--seconds','0.15'],{env,stdio:['ignore','pipe','pipe']});
 assert.equal(await new Promise(resolve=>{refused.once('exit',resolve);}),1);assert.equal(existsSync(marker),false);
 const waiter=spawn('python3',['scripts/push-queue-admission.py','--checkout',process.cwd(),'--seconds','4'],{env,stdio:['ignore','pipe','pipe']});
 let early=false;const admitted=new Promise(resolve=>{waiter.once('exit',code=>{early=true;resolve(code);});});
 await new Promise(resolve=>{setTimeout(resolve,150);});assert.equal(early,false,'A conflicting real owner cannot be skipped');
 holder.stdin.end();await ended;assert.equal(await admitted,0);
 const hook=join(work,'normal-hook.mjs');writeFileSync(hook,`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'normal hook');`);
 execFileSync('python3',['scripts/heavy-lane.py','full-test','--',process.execPath,hook],{env,stdio:'pipe'});
 assert.equal(existsSync(marker),true);
 console.log(JSON.stringify({realGlobalLease:true,waitsBeforeHook:true,normalHookStillAcquires:true,boundedFailureNotUploaded:true}));
}finally{holder.stdin.end();await ended;rmSync(work,{recursive:true,force:true});}
