// Outside-hook actual encoder cases and machine scheduler receipt.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve as resolvePath} from 'node:path';

const root=process.cwd();
const worker=process.argv.includes('--worker');
if(process.argv.slice(2).some(arg=>arg!=='--worker'&&!arg.startsWith('--out=')))throw new Error('Expected --worker and/or --out=directory');
const directory=resolvePath(process.argv.find(arg=>arg.startsWith('--out='))?.slice(6)??'tmp/cook-admission-proof');mkdirSync(directory,{recursive:true});
const work=mkdtempSync(join(directory,'run-')),report=join(work,'results.json'),began=performance.now();
const scheduler=process.env.WS_HEAVY_SCHEDULER_ROOT??join(homedir(),'.wildshard-heavy-lanes');
const child=spawn('python3',['scripts/heavy-lane.py','full-test','--checkout-scope','--',process.execPath,'scripts/vitest-tmp.ts','run',worker?'test/cook-worker.test.ts':'test/cook-cpu-limit.test.ts','--maxWorkers=1','--reporter=default','--reporter=json',`--outputFile=${report}`],
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
 assert.equal(code,0,'Original real cook cases must pass');
 const results=JSON.parse(readFileSync(report,'utf8'));
 assert.equal(results.numPassedTests,worker?23:3);assert.equal(results.numFailedTests,0);assert.equal(results.numPendingTests,0);
 assert.ok(samples.length>0,'Actual machine admission must be observed');
 assert.ok(samples.every(row=>row.slots===(worker?4:row.capacity)),worker?'The bounded cook file must own exactly four actual slots':'Uncapped no-grant proof must own all CPU slots');
 console.log(JSON.stringify({actualCookCases:results.numPassedTests,grants:samples.length,slots:worker?4:'all',seconds:(performance.now()-began)/1000}));
}finally{clearInterval(timer);rmSync(work,{recursive:true,force:true});}
