// Outside-hook actual encoder cases and machine scheduler receipt.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve as resolvePath} from 'node:path';

const root=process.cwd();
const scheduler=process.env.WS_HEAVY_SCHEDULER_ROOT??join(homedir(),'.wildshard-heavy-lanes');
const child=spawn('python3',['scripts/heavy-lane.py','full-test','--checkout-scope','--',process.execPath,'scripts/vitest-tmp.ts','run','test/cook-cpu-limit.test.ts','--maxWorkers=1'],
 {env:{...process.env,WS_FULL_SUITE:'1',WS_CPU_ADMISSION:'1',WS_PUSH_GATE_PROFILE:'full-v1'},stdio:'inherit'});
/** @type {{slots:number,capacity:number}[]} */const samples=[];
/** @type {Map<number,boolean>} */const owned=new Map();
/** @param {number} candidate */
function belongs(candidate){
 if(owned.has(candidate))return owned.get(candidate);
 const parents=new Map(execFileSync('ps',['-Ao','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split(/\s+/u).map(Number)).map(([pid,parent])=>[pid,parent]));
 const visited=new Set();
 /** @type {number|undefined} */
 let pid=candidate;
 while(pid!==undefined&&pid>1&&!visited.has(pid)&&pid!==child.pid){visited.add(pid);pid=parents.get(pid);}
 const result=pid===child.pid;owned.set(candidate,result);return result;
}
const timer=setInterval(()=>{
 try{
  const state=JSON.parse(readFileSync(join(scheduler,'queue.json'),'utf8'));
  for(const row of state.cpuActive??[])if(row.repo===resolvePath(root)&&belongs(row.pid))samples.push({slots:row.slots,capacity:state.cpuCapacity});
 }catch{ /* The scheduler can be absent before its first actual owner. */ }
},5);
try{
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 assert.equal(code,0,'Original real q11 byte/pool cases must pass');
 assert.ok(samples.length>0,'Actual machine admission must be observed');
 assert.ok(samples.every(row=>row.slots===row.capacity),'Uncapped no-grant proof must own all CPU slots');
 console.log(JSON.stringify({actualEncoderCases:3,grants:samples.length,allSlots:true}));
}finally{clearInterval(timer);}
