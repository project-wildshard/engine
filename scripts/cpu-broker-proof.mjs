// Actual sockets and the shared FIFO policy, with real killed owners; outside hooks.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve as resolvePath} from 'node:path';
import {startCpuBroker,holdBrokerCpu} from './cpu-broker.mjs';
import {holdCpu} from './cpu-admission.mjs';

// FL30: an idle orphan is reclaimed after this many seconds here, 60 in real runs.
process.env.WS_CPU_ORPHAN_IDLE_SECONDS='1';
const directory=resolvePath(process.argv[2]??'tmp/cpu-broker-proof');mkdirSync(directory,{recursive:true});
const work=mkdtempSync(join(directory,'run-')),root=join(work,'cpu'),leases=[],owners=[];
const broker=await startCpuBroker({root,capacity:2});
let killedBroker;
/** @param {number} ms */
const pause=ms=>new Promise(resolve=>{setTimeout(resolve,ms);});
try{
 const a=join(work,'a'),b=join(work,'b');mkdirSync(a);mkdirSync(b);
 const full=await holdBrokerCpu(broker.environment,'all',a);leases.push(full);
 let ready=false;
 const waiting=holdBrokerCpu(broker.environment,1,b).then(lease=>{ready=true;return lease;});
 await pause(60);assert.equal(ready,false);await full.release();
 const one=await waiting,two=await holdCpu(1,{root,capacity:2,repo:a});leases.push(one,two);
 assert.equal(one.proof.slots+two.proof.slots,2);
 let exclusiveReady=false;
 const exclusive=holdBrokerCpu(broker.environment,'all',b).then(lease=>{exclusiveReady=true;return lease;});
 await one.release();await pause(40);assert.equal(exclusiveReady,false);await two.release();
 const all=await exclusive;leases.push(all);await all.release();
 await assert.rejects(holdBrokerCpu(JSON.stringify({...JSON.parse(broker.environment),token:'wrong'}),1,a));
 await assert.rejects(holdBrokerCpu(broker.environment,3,a));

 const childFile=join(work,'client.mjs');
 writeFileSync(childFile,`import {holdBrokerCpu} from ${JSON.stringify(new URL('cpu-broker.mjs',import.meta.url).href)};const lease=await holdBrokerCpu(process.env.BROKER,'all',process.cwd());console.log('ready');process.stdin.resume();`);
 const child=spawn(process.execPath,[childFile],{env:{...process.env,BROKER:broker.environment},stdio:['pipe','pipe','pipe']});
 let output='';child.stdout.on('data',data=>{output+=data;});
 const childEnded=new Promise(resolve=>{child.once('exit',resolve);});
 const began=Date.now();while(!output.includes('ready')&&Date.now()-began<3000)await pause(5);assert.ok(output.includes('ready'));
 child.kill('SIGKILL');await childEnded;
 const afterKill=await holdBrokerCpu(broker.environment,'all',b);leases.push(afterKill);await afterKill.release();
 const lost=await holdBrokerCpu(broker.environment,1,a);leases.push(lost);
 await broker.close();await lost.lost;await lost.release();
 const state=JSON.parse(readFileSync(join(root,'queue.json'),'utf8'));
 assert.deepEqual(state.cpuActive,[]);assert.deepEqual(state.cpuQueue,[]);
 killedBroker=await startCpuBroker({root,capacity:2});
 const held=await holdBrokerCpu(killedBroker.environment,'all',a);leases.push(held);
 assert.ok(killedBroker.pid!==undefined);process.kill(killedBroker.pid,'SIGKILL');
 await assert.rejects(killedBroker.lost);await held.lost;await held.release();
 const recovered=await holdCpu('all',{root,capacity:2,repo:a});leases.push(recovered);await recovered.release();
 await killedBroker.close().catch(()=>undefined);

 // FL30: a stale row never holds the slots. A dead holder, a removed worktree and an idle orphaned run are reclaimed
 // within seconds (the stale broker is stopped); a busy orphaned run keeps its lease.
 const reclaimer=await startCpuBroker({root,capacity:2});killedBroker=reclaimer;
 /** @param {Promise<any>} promise @param {number} ms @param {string} what */
 const within=(promise,ms,what)=>Promise.race([promise,pause(ms).then(()=>{throw new Error(`${what}: no grant within ${ms} ms`);})]);
 const alive=(/** @type {number} */ pid)=>{try{process.kill(pid,0);return true;}catch{return false;}};
 const statePath=join(root,'queue.json');
 const sleeper=spawn('sleep',['60'],{stdio:'ignore'});owners.push(/** @type {number} */ (sleeper.pid));
 const gone=spawn('true',[],{stdio:'ignore'});await new Promise(resolve=>{gone.once('exit',resolve);});
 const seeded=JSON.parse(readFileSync(statePath,'utf8'));
 seeded.cpuActive.push({token:'dead-holder',pid:sleeper.pid,holder:gone.pid,owner:process.pid,repo:a,slots:2,ticket:-1});
 writeFileSync(statePath,JSON.stringify(seeded));
 const pastDead=await within(holdBrokerCpu(reclaimer.environment,'all',b),5000,'dead holder');leases.push(pastDead);await pastDead.release();
 assert.ok(alive(/** @type {number} */ (sleeper.pid)),'a reclaimed row whose pid is not a CPU broker is never signalled');

 const ownerFile=join(work,'owner.mjs');
 writeFileSync(ownerFile,`import {writeFileSync} from 'node:fs';import {startCpuBroker,holdBrokerCpu} from ${JSON.stringify(new URL('cpu-broker.mjs',import.meta.url).href)};const broker=await startCpuBroker({root:process.env.ROOT,capacity:2});await holdBrokerCpu(broker.environment,'all',process.env.REPO);writeFileSync(process.env.READY,JSON.stringify({owner:process.pid,broker:broker.pid}));if(process.env.BUSY==='1')for(;;){}setInterval(()=>undefined,1<<30);`);
 /** Start an owner holding 'all'; orphaned ones are reparented to pid 1 by a shell that exits at once.
  * @param {string} name @param {string} repo @param {{orphan?:boolean,busy?:boolean}} how @returns {Promise<{owner:number,broker:number}>} */
 const own=async(name,repo,how)=>{
  const ready=join(work,`${name}.json`),env={...process.env,ROOT:root,REPO:repo,READY:ready,BUSY:how.busy===true?'1':'0'};
  if(how.orphan===true)spawn('sh',['-c',`"${process.execPath}" "${ownerFile}" </dev/null >/dev/null 2>&1 &`],{env,stdio:'ignore'});
  else spawn(process.execPath,[ownerFile],{env,stdio:'ignore'});
  const began=Date.now();while(!existsSync(ready)&&Date.now()-began<10_000)await pause(20);
  const started=JSON.parse(readFileSync(ready,'utf8'));owners.push(started.owner);return started;
 };
 const worktree=join(work,'worktree');mkdirSync(worktree);
 const removed=await own('removed',worktree,{});rmSync(worktree,{recursive:true,force:true});
 const pastRemoved=await within(holdBrokerCpu(reclaimer.environment,'all',b),5000,'removed worktree');leases.push(pastRemoved);await pastRemoved.release();
 await pause(300);assert.ok(!alive(removed.broker),'the removed worktree\'s broker is stopped');
 process.kill(removed.owner,'SIGKILL');

 const busy=await own('busy',a,{orphan:true,busy:true});
 let busyLost=false;
 const behindBusy=holdBrokerCpu(reclaimer.environment,'all',b).then(lease=>{busyLost=true;return lease;});
 await pause(3000);assert.equal(busyLost,false,'a busy orphaned run keeps its lease');
 process.kill(busy.owner,'SIGKILL');
 const afterBusy=await within(behindBusy,5000,'after the busy owner ended');leases.push(afterBusy);await afterBusy.release();

 const idle=await own('idle',a,{orphan:true});
 const pastIdle=await within(holdBrokerCpu(reclaimer.environment,'all',b),8000,'idle orphan');leases.push(pastIdle);await pastIdle.release();
 await pause(300);assert.ok(!alive(idle.broker),'the idle orphan\'s broker is stopped');
 const after=JSON.parse(readFileSync(statePath,'utf8'));assert.deepEqual(after.cpuActive,[]);
 console.log(JSON.stringify({sharedWithCommandOwners:true,exclusiveFIFO:true,capacity:2,killedClientDrained:true,invalidRequestsRefused:true,brokerLossObserved:true,killedBrokerRecovered:true,deadHolderReclaimed:true,removedWorktreeReclaimed:true,idleOrphanReclaimed:true,busyOrphanKept:true,remaining:0}));
}finally{for(const pid of owners)try{process.kill(pid,'SIGKILL');}catch{/* Already gone. */}
 await Promise.all(leases.map(lease=>lease.release()));await broker.close();if(killedBroker!==undefined)await killedBroker.close().catch(()=>undefined);rmSync(work,{recursive:true,force:true});}
