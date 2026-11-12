// A real scoped engine lease/broker grant precedes a plain non-engine pnpm check.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join,resolve as resolvePath} from 'node:path';
import {pathToFileURL} from 'node:url';

const base=resolvePath(process.argv[2]??'tmp/non-engine-admission-proof');mkdirSync(base,{recursive:true});
const work=mkdtempSync(join(base,'run-')),root=join(work,'scheduler'),engine=join(work,'engine'),pine=join(work,'pine'),marker=join(pine,'checked');mkdirSync(engine);mkdirSync(pine);
symlinkSync(resolvePath('scripts'),join(engine,'scripts'),'dir');
writeFileSync(join(pine,'package.json'),JSON.stringify({name:'plain-check-proof',private:true,scripts:{check:'node check.mjs'}}));
writeFileSync(join(pine,'value.json'),'{"value":7}');writeFileSync(join(pine,'check.mjs'),"import assert from'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';assert.equal(JSON.parse(readFileSync('value.json')).value,7);writeFileSync('checked','actual plain check');");
const broker=pathToFileURL(resolvePath('scripts/cpu-broker.mjs')).href,owner=join(engine,'owner.mjs');
writeFileSync(owner,`import{startCpuBroker,holdBrokerCpu}from${JSON.stringify(broker)};const broker=await startCpuBroker({root:${JSON.stringify(root)}}),grant=await holdBrokerCpu(broker.environment,1,${JSON.stringify(engine)});console.log('ready');await new Promise(resolve=>{process.stdin.resume();process.stdin.once('end',resolve);});await grant.release();await broker.close();`);
/** @type {NodeJS.ProcessEnv} */const env={...process.env,WS_FULL_SUITE:'1',WS_HEAVY_ROOT:root,WS_HEAVY_SCHEDULER_ROOT:root};Reflect.deleteProperty(env,'WS_HEAVY_TOKEN');Reflect.deleteProperty(env,'WS_CPU_ADMISSION');Reflect.deleteProperty(env,'WS_PUSH_GATE_PROFILE');
const lane=resolvePath('scripts/heavy-lane.py'),holder=spawn('python3',[lane,'full-test','--checkout-scope','--',process.execPath,owner],{cwd:engine,env:{...env,WS_CPU_ADMISSION:'1'},stdio:['pipe','pipe','pipe']});
const ready={value:false};let holderError='';holder.stdout.on('data',data=>{if(data.toString().includes('ready'))ready.value=true;});holder.stderr.on('data',data=>{holderError+=data;});const ended=new Promise(resolve=>{holder.once('exit',resolve);});
/** @type {Promise<unknown>|undefined} */let waiterEnded;
try{
 const began=performance.now(),start=Date.now();while(!ready.value&&Date.now()-start<5000)await new Promise(resolve=>{setTimeout(resolve,10);});assert.ok(ready.value,holderError);
 const wrongKind=spawnSync('python3',[lane,'build','--admission-wait-seconds','300','--','pnpm','check'],{cwd:pine,env,encoding:'utf8'});assert.equal(wrongKind.status,2);assert.match(wrongKind.stderr,/only supported for full-test/u);assert.equal(existsSync(marker),false);
 const refused=spawn('python3',[lane,'full-test','--admission-wait-seconds','.15','--','pnpm','check'],{cwd:pine,env,stdio:['ignore','pipe','pipe']});let refusal='';refused.stderr.on('data',data=>{refusal+=data;});assert.notEqual(await new Promise(resolve=>{refused.once('exit',resolve);}),0);assert.match(refusal,/timed out after 0.15s waiting for resources/u);assert.equal(existsSync(marker),false);
 const waiter=spawn('python3',[lane,'full-test','--admission-wait-seconds','4','--','pnpm','check'],{cwd:pine,env,stdio:['ignore','pipe','pipe']});const state={exited:false};let error='';waiter.stderr.on('data',data=>{error+=data;});waiterEnded=new Promise(resolve=>{waiter.once('exit',code=>{state.exited=true;resolve(code);});});
 await new Promise(resolve=>{setTimeout(resolve,150);});assert.equal(state.exited,false,'A plain global gate must wait behind the actual scoped engine owner');assert.equal(existsSync(marker),false);
 holder.stdin.end();assert.equal(await ended,0,holderError);assert.equal(await waiterEnded,0,error);assert.equal(existsSync(marker),true);
 console.log(JSON.stringify({actualEngineScopedLease:true,actualCpuBrokerGrant:true,plainCheckProfile:true,boundedAdmissionRefusedBeforeCheck:true,fifoWaitThenActualPnpmCheck:true,seconds:(performance.now()-began)/1000}));
}finally{holder.stdin.end();await ended;await waiterEnded;rmSync(work,{recursive:true,force:true});}
