// TS22b drives real Vitest setup, nested fixtures and lost-parent cleanup.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve as resolvePath} from 'node:path';
import {holdCpu,parentCpuContext,PARENT_CONTEXT} from './cpu-admission.mjs';
import {startCpuBroker} from './cpu-broker.mjs';

const directory=resolvePath(process.argv[2]??'tmp/focused-cpu-proof',`run-${process.pid}`);mkdirSync(directory,{recursive:true});
const root=join(directory,'cpu'),repo=process.cwd();
/** @type {NodeJS.ProcessEnv} */
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('WS_CPU_')&&!key.startsWith('WS_HEAVY_')&&!key.startsWith('WS_PUSH_')&&!['CI','GITHUB_ACTIONS'].includes(key)));
env.WS_CPU_ROOT=root;env.WS_LANE_NAME??='focused-cpu-proof';env.VITEST_TMP_ROOT=join(directory,'vitest');
/** @type {Awaited<ReturnType<typeof holdCpu>>[]} */ const leases=[];
/** @typedef {{child:import('node:child_process').ChildProcess,done:Promise<number|null>,readonly output:string}} Actor */
/** @type {Actor[]} */ const actors=[];
/** @param {number} ms */ const pause=ms=>new Promise(resolve=>{setTimeout(resolve,ms);});
/** @param {()=>boolean} ready @param {string} reason */
async function until(ready,reason){const end=Date.now()+10000;while(!ready()){assert.ok(Date.now()<end,reason);await pause(10);}}
/** @param {string} name @param {string} content */
function config(name,content){
 const file=join(directory,`${name}.test.mjs`),path=join(directory,`${name}.config.ts`);writeFileSync(file,content);
 writeFileSync(path,`import {defineConfig} from 'vitest/config';import base from ${JSON.stringify(join(repo,'vitest.config.ts'))};const {projects,...test}=base.test??{};export default defineConfig({...base,test:{...test,include:[${JSON.stringify(file)}],maxWorkers:1,fileParallelism:false}});`);
 return {file,path};
}
/** @param {{file:string,path:string}} fixture @param {NodeJS.ProcessEnv} environment @returns {Actor} */
function start(fixture,environment){
 return launch([process.execPath,'src/scripts/vitest-tmp.ts','run','--config',fixture.path,fixture.file],environment);
}
/** @param {string[]} command @param {NodeJS.ProcessEnv} environment @returns {Actor} */
function launch(command,environment){
 const child=spawn(command[0]??'',command.slice(1),{env:environment,stdio:['pipe','pipe','pipe']});
 let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
 /** @type {Promise<number|null>} */ const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 const actor={child,done,get output(){return output;}};actors.push(actor);return actor;
}
const state=(/** @type {string} */ scope)=>JSON.parse(readFileSync(join(scope,'queue.json'),'utf8'));
const marker=join(directory,'started'),nestedMarker=join(directory,'nested');
const group=process.argv[3]??'all';
if(!['all','admission','command'].includes(group))throw new Error('Unknown focused CPU proof group');
const basic=group!=='command',command=group!=='admission';
let broker;
try{
 if(basic){
 const holder=await holdCpu('all',{root});leases.push(holder);
 const focused=config('focused',`import {test} from 'vitest';import {writeFileSync} from 'node:fs';test('actual focused case',()=>{writeFileSync(${JSON.stringify(marker)},'started');});`);
 const first=start(focused,env);
 await until(()=>state(root).cpuQueue.length===1,'Focused worker must reach CPU FIFO');
 assert.equal(existsSync(marker),false);await holder.release();assert.equal(await first.done,0,first.output);assert.ok(existsSync(marker));
 assert.equal(state(root).cpuActive.length,0);
 // This parent really holds one file grant; the nested Vitest invocation
 // borrows it, runs its actual setup and observes exactly one ledger row.
 const nested=config('nested',`import {test,expect} from 'vitest';import {readFileSync,writeFileSync} from 'node:fs';test('actual nested worker',()=>{const state=JSON.parse(readFileSync(${JSON.stringify(join(root,'queue.json'))},'utf8'));expect(state.cpuActive.length).toBe(1);expect(state.cpuQueue.length).toBe(0);writeFileSync(${JSON.stringify(nestedMarker)},'nested');});`);
 const parent=config('parent',`import {test,expect} from 'vitest';import {spawnSync} from 'node:child_process';test('actual parent fixture',()=>{const result=spawnSync(process.execPath,['src/scripts/vitest-tmp.ts','run','--config',${JSON.stringify(nested.path)},${JSON.stringify(nested.file)}],{env:process.env,encoding:'utf8',timeout:15000});expect(result.status,result.stdout+result.stderr).toBe(0);});`);
 const parentActor=start(parent,env);assert.equal(await parentActor.done,0,parentActor.output);assert.ok(existsSync(nestedMarker));assert.equal(state(root).cpuActive.length,0);
 }
 if(command){
 // The pre-push check:saves shape removes the full-test profile/admission
 // flag inside an already admitted command. Queue 'all' ahead of the inner
 // worker: without the command's verified context this is a FIFO deadlock.
 const wrappedRoot=join(directory,'wrapped'),wrappedMarker=join(directory,'wrapped-started');mkdirSync(wrappedRoot);
 const wrapped=config('wrapped',`import {test,expect} from 'vitest';import {readFileSync,writeFileSync} from 'node:fs';import {vitestMaxWorkers} from ${JSON.stringify(join(repo,'src/scripts/vitest-lane.ts'))};test('admitted command child',()=>{const state=JSON.parse(readFileSync(${JSON.stringify(join(wrappedRoot,'queue.json'))},'utf8'));expect(state.cpuActive.length).toBe(1);expect(state.cpuQueue.length).toBe(1);expect(vitestMaxWorkers({...process.env,WS_VITEST_MAX_WORKERS:'8'})).toBe(1);writeFileSync(${JSON.stringify(wrappedMarker)},'yes');});`);
 const ownerProgram=`import {spawnSync} from 'node:child_process';process.stdin.resume();console.log('outer-ready');process.stdin.once('data',()=>{const result=spawnSync('env',['-u','WS_PUSH_GATE_PROFILE','-u','WS_CPU_ADMISSION',process.execPath,'src/scripts/vitest-tmp.ts','run','--config',${JSON.stringify(wrapped.path)},${JSON.stringify(wrapped.file)}],{env:process.env,stdio:'inherit',timeout:15000});process.exit(result.status??1);});`;
 const wrappedActor=launch(['python3','src/scripts/cpu-admission.py','run','--capacity','2','--slots','1','--',process.execPath,'--input-type=module','-e',ownerProgram],{...env,WS_CPU_ROOT:wrappedRoot});
 await until(()=>wrappedActor.output.includes('outer-ready'),'Outer command must acquire its slot');
 let exclusiveReady=false;const pending=holdCpu('all',{root:wrappedRoot,capacity:2}).then(lease=>{exclusiveReady=true;leases.push(lease);return lease;});
 await until(()=>state(wrappedRoot).cpuQueue.length===1,'Exclusive work must precede the nested worker');
 assert.ok(wrappedActor.child.stdin);wrappedActor.child.stdin.write('go');
 assert.equal(await wrappedActor.done,0,wrappedActor.output);assert.ok(existsSync(wrappedMarker));
 const exclusive=await pending;assert.ok(exclusiveReady);await exclusive.release();assert.equal(state(wrappedRoot).cpuActive.length,0);
 }
 if(basic){
 // A private root wins over a broker inherited from another actual domain.
 broker=await startCpuBroker({root:join(directory,'broker'),capacity:2});
 const privateRoot=join(directory,'private'),privateMarker=join(directory,'private-started');mkdirSync(privateRoot);
 const privateCase=config('private',`import {test,expect} from 'vitest';import {readFileSync,writeFileSync} from 'node:fs';test('private worker',()=>{expect(JSON.parse(readFileSync(${JSON.stringify(join(privateRoot,'queue.json'))},'utf8')).cpuActive.length).toBe(1);writeFileSync(${JSON.stringify(privateMarker)},'yes');});`);
 const privateActor=start(privateCase,{...env,WS_CPU_ROOT:privateRoot,WS_CPU_BROKER:broker.environment});assert.equal(await privateActor.done,0,privateActor.output);assert.ok(existsSync(privateMarker));assert.equal(state(privateRoot).cpuActive.length,0);
 }
 if(command){
 // An unexpected loss stops borrowed work; it cannot continue unadmitted.
 const lostMarker=join(directory,'lost-started'),doomed=await holdCpu('all',{root});leases.push(doomed);
 const lostCase=config('lost',`import {test} from 'vitest';import {writeFileSync} from 'node:fs';test('borrowed work',async()=>{writeFileSync(${JSON.stringify(lostMarker)},'started');await new Promise(resolve=>{setTimeout(resolve,20000);});});`);
 const lostActor=start(lostCase,{...env,[PARENT_CONTEXT]:parentCpuContext(doomed.proof,{...env,WS_CPU_ROOT:root})});
 await until(()=>existsSync(lostMarker),'Borrowed worker must start');assert.ok(doomed.pid);process.kill(doomed.pid,'SIGTERM');await doomed.lost;
 assert.notEqual(await lostActor.done,0,lostActor.output);await doomed.release();
 assert.equal(state(root).cpuActive.length,0);
 const follow=await holdCpu('all',{root});leases.push(follow);await follow.release();
 }
 console.log(JSON.stringify({group,ordinaryFocusedWaits:basic?true:null,resumesAfterRelease:basic?true:null,realNestedVitestBorrows:basic?true:null,noSecondGrant:true,admittedCommandAvoidsExclusiveDeadlock:command?true:null,privateBrokerRootStaysDistinct:basic?true:null,lostParentStopsWork:command?true:null,allGrantsReleased:true,actors:actors.length}));
}finally{
 for(const actor of actors)if(actor.child.exitCode===null&&actor.child.signalCode===null){actor.child.kill('SIGTERM');await actor.done;}
 for(const lease of leases)await lease.release();await broker?.close();
}
