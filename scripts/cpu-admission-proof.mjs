// Real weighted owners, cancellation and checkout locks; outside local hooks.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve as resolvePath} from 'node:path';
import {holdCpu} from './cpu-admission.mjs';
import {parallelChecks} from '../.githooks/push-checks.mjs';

const directory=resolvePath(process.argv[2]??'tmp/cpu-admission-proof');mkdirSync(directory,{recursive:true});
const work=mkdtempSync(join(directory,'run-')),leases=[];
/** @type {{readonly ready:boolean,close:()=>Promise<void>,stop:()=>Promise<void>}[]} */
const commands=[];
/** @param {number} ms */
const pause=ms=>new Promise(resolve=>{setTimeout(resolve,ms);});
try{
 const a=join(work,'repo-a'),b=join(work,'repo-b');for(const repo of [a,b]){mkdirSync(repo);execFileSync('git',['init','--quiet'],{cwd:repo});}
 const options={root:join(work,'cpu'),capacity:2};
 const full=await holdCpu('all',{...options,repo:a});leases.push(full);
 let grantedB=false,grantedC=false;
 const pendingB=holdCpu(1,{...options,repo:b}).then(value=>{grantedB=true;return value;}),pendingC=holdCpu(1,{...options,repo:a}).then(value=>{grantedC=true;return value;});
 await pause(80);assert.equal(grantedB||grantedC,false);await full.release();
 const [one,two]=await Promise.all([pendingB,pendingC]);leases.push(one,two);assert.equal(one.proof.slots+two.proof.slots,2);
 let exclusiveReady=false;const pendingExclusive=holdCpu('all',{...options,repo:b}).then(value=>{exclusiveReady=true;return value;});
 await one.release();await pause(50);assert.equal(exclusiveReady,false);await two.release();
 const exclusive=await pendingExclusive;leases.push(exclusive);assert.ok(exclusive.pid!==undefined);
 const pendingAfterKill=holdCpu('all',{...options,repo:a});process.kill(exclusive.pid,'SIGKILL');
 const recovered=await pendingAfterKill;leases.push(recovered);await recovered.release();

 /** @param {string} repo @param {boolean} scoped */
 const command=(repo,scoped)=>{
  const env={...process.env,WS_FULL_SUITE:'1',WS_CPU_ADMISSION:'1',WS_HEAVY_ROOT:join(work,'heavy'),WS_HEAVY_SCHEDULER_ROOT:join(work,'heavy')};Reflect.deleteProperty(env,'WS_HEAVY_TOKEN');
  const child=spawn('python3',[resolvePath('scripts/heavy-lane.py'),'full-test',...(scoped?['--checkout-scope']:[]),'--',process.execPath,'-e',"process.stdin.resume();console.log('ready')"],{cwd:repo,env,stdio:['pipe','pipe','pipe']});
  let ready=false,queued=false,output='',errors='';child.stdout.on('data',data=>{output+=data;if(output.includes('ready'))ready=true;});
  child.stderr.on('data',data=>{errors+=data;if(errors.includes('queued full-test ticket'))queued=true;});
  const exited=new Promise(resolve=>{child.once('exit',resolve);});
  const handle={get ready(){return ready;},get queued(){return queued;},close:async()=>{child.stdin.end();await exited;},stop:async()=>{child.kill('SIGTERM');await exited;}};commands.push(handle);return handle;
 };
 /** @param {{readonly ready:boolean}} child */
 const waitReady=async child=>{const start=Date.now();while(!child.ready&&Date.now()-start<5000)await pause(10);assert.ok(child.ready,'Real command must acquire its lease');};
 const first=command(a,true),second=command(b,true);await Promise.all([waitReady(first),waitReady(second)]);
 const same=command(a,true);const waiting=Date.now();while(!same.queued&&Date.now()-waiting<5000)await pause(10);assert.ok(same.queued);
 const global=command(b,false);await pause(150);assert.equal(same.ready,false);assert.equal(global.ready,false);
 await first.close();await waitReady(same);assert.equal(global.ready,false);
 await Promise.all([second.close(),same.close()]);await waitReady(global);
 const last=command(a,true);await pause(100);assert.equal(last.ready,false);await global.close();await waitReady(last);await last.close();
 const pid=join(work,'grandchild.pid'),holder=join(work,'holder.mjs'),failure=join(work,'failure.mjs');
 writeFileSync(holder,`import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});writeFileSync(${JSON.stringify(pid)},String(child.pid));setInterval(()=>{},1000);`);
 writeFileSync(failure,`import{existsSync}from'node:fs';while(!existsSync(${JSON.stringify(pid)}))await new Promise(resolve=>setTimeout(resolve,10));process.exitCode=1;`);
 const root=join(work,'failure-cpu');
 const refused=await parallelChecks([{name:'holder',commands:[[process.execPath,holder]]},{name:'failure',commands:[[process.execPath,failure]]}],{env:{...process.env,WS_CPU_ADMISSION:'1',WS_CPU_ROOT:root}});
 assert.equal(refused.ok,false);const orphan=Number(readFileSync(pid,'utf8'));let alive=true;
 for(let turn=0;turn<50&&alive;turn++){try{process.kill(orphan,0);await pause(10);}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ESRCH'))throw error;alive=false;}}
 assert.equal(alive,false);const all=await holdCpu('all',{root,repo:a});leases.push(all);await all.release();
 console.log(JSON.stringify({twoRepositories:true,capacity:2,exclusiveFIFO:true,killedOwnerRecovered:true,sameCheckoutSerialized:true,differentCheckoutsOverlap:true,legacyGlobalExcludes:true,admittedFailureDrained:true,orphan:false}));
}finally{for(const lease of leases)await lease.release();await Promise.all(commands.map(command=>command.stop()));rmSync(work,{recursive:true,force:true});}
