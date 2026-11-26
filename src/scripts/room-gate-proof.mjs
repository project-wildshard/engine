// TS22d: run the ordinary complete gate with actual owned production builds.
// Observe admitted work only; older clients/unmetered applications are outside
// this proof. No test selection, gameplay assertion or timing limit changes.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {closeSync,existsSync,mkdirSync,openSync,readFileSync,realpathSync,watch,writeFileSync} from 'node:fs';
import {join,resolve as resolvePath} from 'node:path';
import {cpuRoot} from './cpu-admission.mjs';
import {pushEnvironment} from '../../.githooks/push-checks.mjs';

const repo=realpathSync(process.cwd()),directory=resolvePath(process.argv[2]??'tmp/codex-netlag',`room-gate-${Date.now()}`);
mkdirSync(directory,{recursive:true});
const git=(/** @type {string[]} */ args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
assert.equal(git(['status','--porcelain','--untracked-files=all']),'','Commit the measurement source before qualification');
const source=git(['rev-parse','HEAD']),metrics=join(directory,'rooms.jsonl'),events=`${metrics}.events.jsonl`;
/** @type {NodeJS.ProcessEnv} */
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('WS_CPU_')&&!key.startsWith('WS_HEAVY_'))),
 WS_HEAVY_SCHEDULER_ROOT:cpuRoot(pushEnvironment(process.env)),WS_ROOM_REPORT:metrics,WS_PUSH_TIMINGS:join(directory,'full-tests.json')};
delete env.WS_PUSH_REFS;
const scheduler=cpuRoot(pushEnvironment(env)),ledger=join(scheduler,'queue.json');
const targets=new Set(['sunscar-dunes','driftwood-isle']);
/** @typedef {{p:import('node:child_process').ChildProcess,done:Promise<number|null>,log:string}} Actor */
/** @typedef {{pid:number,holder?:number,slots:number,repo:string,ownedCommand?:{child?:{pid:number}|null}}} Row */
/** @typedef {{slug:string,pid:number,start:number,end?:number,build:Actor,queuedAt?:number,grantedAt?:number,childPid?:number,slots?:number,queuedAtProducerEnd?:boolean,observationMs:number}} Observation */
/** @type {Map<string,Observation>} */ const rooms=new Map();
/** @type {Actor[]} */ const actors=[];
/** @type {import('node:fs').FSWatcher[]} */ const watches=[];
let consumed=0;
/** @param {string} name @param {string[]} command @returns {Actor} */
function launch(name,command){
 const log=join(directory,`${name}.log`),fd=openSync(log,'wx');
 let p;
 try{p=spawn(command[0]??'',command.slice(1),{env,detached:true,stdio:['ignore',fd,fd]});}finally{closeSync(fd);}
 /** @type {Promise<number|null>} */const done=new Promise((resolve,reject)=>{p.once('error',reject);p.once('close',resolve);});
 const actor={p,done,log};actors.push(actor);return actor;
}
/** @returns {{cpuCapacity:number,cpuActive:Row[],cpuQueue:Row[]}|null} */
function snapshot(){try{return JSON.parse(readFileSync(ledger,'utf8'));}catch{return null;}}
/** Record actual FIFO/publication transitions, with no capabilities in output. */
function sample(){
 const state=snapshot();if(state===null)return;
 for(const room of rooms.values()){
  /** @type {Row|undefined} */const queued=state.cpuQueue.find(row=>row.pid===room.build.p.pid);
  if(queued!==undefined){
   assert.equal(queued.ownedCommand?.child,null,'A queued production command must not have executed');
   room.queuedAt??=Date.now();
  }
  const active=state.cpuActive.find(row=>row.pid===room.build.p.pid);
  if(active!==undefined){
   room.grantedAt??=Date.now();room.slots=active.slots;
   if(active.ownedCommand?.child!==undefined&&active.ownedCommand.child!==null)room.childPid=active.ownedCommand.child.pid;
  }
 }
}
/** @type {(reason:unknown)=>void} */let rejectObservation=()=>{/* Assigned before watchers start. */};
function observe(){
 if(!existsSync(events))return;
 const lines=readFileSync(events,'utf8').split('\n');
 // Wait for a complete append instead of accepting a partial JSON record.
 while(consumed<lines.length-1){
  const event=JSON.parse(lines[consumed++]??'');
  assert.ok(targets.has(event.slug));assert.ok(Number.isInteger(event.pid));assert.ok(Number.isFinite(event.at));
  assert.equal(event.observation?.budget?.parentPid,event.pid,'Producer must validate its actual held file grant');
  assert.equal(event.observation?.budget?.slots,event.observation?.budget?.capacity,'Producer must own all admitted slots at both boundaries');
  if(event.phase==='start'){
   assert.equal(rooms.has(event.slug),false,'One original room case per shard');
   const state=snapshot();assert.ok(state!==null,'Room admission must be observable');
   const owner=state.cpuActive.find(row=>(row.holder??row.pid)===event.pid&&row.repo===repo);
   assert.ok(owner!==undefined,'Actual room worker must own its grant');
   assert.equal(owner.slots,state.cpuCapacity,'Original room owns the complete admitted budget');
   // The build's ordinary 300s admission clock starts here, during timing,
   // rather than at the beginning of the complete gate.
   const build=launch(`server-${event.slug}`,['python3','src/scripts/heavy-lane.py','build','--max','3','--',process.execPath,'src/scripts/build-server.mjs','--build',source,'--out',join(directory,`server-${event.slug}`)]);
   void build.done.then(code=>code===0?undefined:rejectObservation(new Error(`Actual server build exited ${code}; see ${build.log}`)),rejectObservation);
   rooms.set(event.slug,{slug:event.slug,pid:event.pid,start:event.at,build,observationMs:event.observationMs});
  }else{
   assert.equal(event.phase,'end');const room=rooms.get(event.slug);assert.ok(room!==undefined);assert.equal(room.pid,event.pid);room.end=event.at;
   assert.ok(event.observation.queuedOwnedPids.includes(room.build.p.pid),'The actual build must still be queued without a child at the producer end boundary');
   room.queuedAtProducerEnd=true;room.observationMs+=event.observationMs;
  }
 }
 sample();
}
/** @param {Actor} actor */
async function stop(actor){
 if(actor.p.exitCode!==null||actor.p.signalCode!==null)return;
 const signal=(/** @type {NodeJS.Signals} */ value)=>{if(actor.p.pid!==undefined&&actor.p.exitCode===null&&actor.p.signalCode===null){try{process.kill(-actor.p.pid,value);}catch{/* Already drained. */}}};
 signal('SIGTERM');const hard=setTimeout(()=>signal('SIGKILL'),12000);
 try{await actor.done;}finally{clearTimeout(hard);}
}
/** @type {Promise<never>} */ const failed=new Promise((_resolve,reject)=>{rejectObservation=reject;});
const guarded=(/** @type {()=>void} */ action)=>()=>{try{action();}catch(error){rejectObservation(error);}};
const onSignal=()=>{rejectObservation(new Error('Room gate observation interrupted'));};
process.on('SIGTERM',onSignal);process.on('SIGINT',onSignal);
const timeout=setTimeout(()=>{rejectObservation(new Error('Room gate observation exceeded30minutes'));},30*60000);
let cleanupDrained=false;
const commandStarted=Date.now();
try{
 watches.push(watch(directory,guarded(observe)));
 watches.push(watch(scheduler,guarded(sample)));
 const gate=launch('complete-gate',[process.execPath,'.githooks/run-checks.mjs','push']);
 assert.equal(await Promise.race([gate.done,failed]),0,`Complete ordinary gate failed; see ${gate.log}`);
 observe();assert.equal(rooms.size,2,'Both original32-player room cases must execute');
 await Promise.race([Promise.all([...rooms.values()].map(async room=>{assert.equal(await room.build.done,0,`Actual server build failed; see ${room.build.log}`);})),failed]);
 sample();
 const reports=readFileSync(metrics,'utf8').trim().split('\n').map(line=>JSON.parse(line));
 const state=snapshot();assert.ok(state!==null);
 const verdicts=[];
 for(const room of rooms.values()){
  assert.ok(room.end!==undefined);assert.ok(room.queuedAt!==undefined&&room.queuedAt>=room.start&&room.queuedAt<=room.end,'Actual build must queue during original timing');
  assert.ok(room.grantedAt!==undefined&&room.grantedAt>=room.end,'Actual build must not enter the original room interval');
  assert.ok(room.childPid!==undefined,'Actual production child must be published');
  assert.ok(![...state.cpuActive,...state.cpuQueue].some(row=>row.pid===room.build.p.pid),'Actual build CPU reservation must drain');
  const report=reports.find(row=>row.slug===room.slug);assert.ok(report!==undefined);assert.equal(report.players,32);assert.ok(report.p95<1000/60);
  const bundle=JSON.parse(readFileSync(join(directory,`server-${room.slug}`,'bundle.json'),'utf8'));assert.equal(bundle.engineBuild,source);
  verdicts.push({slug:room.slug,roomPid:room.pid,start:room.start,end:room.end,queuedAt:room.queuedAt,observedGrantedAt:room.grantedAt,queuedAtProducerEnd:room.queuedAtProducerEnd,actualChild:room.childPid,slots:room.slots,observationMs:room.observationMs,metrics:report});
 }
 assert.equal(git(['rev-parse','HEAD']),source);assert.equal(git(['status','--porcelain','--untracked-files=all']),'');
 const result={state:'complete ordinary gate and actual competing production builds passed',source,ordinaryGate:true,totalWallMs:Date.now()-commandStarted,roomLimitMs:1000/60,rooms:verdicts,ownGrantsDrained:true,
  scope:'admitted compiler commands only; provider startup bookkeeping, observation, older clients and unmetered applications are outside total-machine exclusivity',directory};
 writeFileSync(join(directory,'result.json'),`${JSON.stringify(result,null,2)}\n`);console.log(JSON.stringify(result));
}finally{
 clearTimeout(timeout);for(const watcher of watches)watcher.close();process.off('SIGTERM',onSignal);process.off('SIGINT',onSignal);
 const stops=await Promise.allSettled(actors.map(stop));
 const until=Date.now()+3000;
 let finalState=snapshot();
 let pending=finalState===null?null:[...finalState.cpuActive,...finalState.cpuQueue].filter(row=>row.repo===repo);
 while((pending===null||pending.length>0)&&Date.now()<until){await new Promise(resolve=>{setTimeout(resolve,50);});finalState=snapshot();pending=finalState===null?null:[...finalState.cpuActive,...finalState.cpuQueue].filter(row=>row.repo===repo);}
 const drained=pending!==null&&pending.length===0&&stops.every(result=>result.status==='fulfilled');
 cleanupDrained=drained;
 writeFileSync(join(directory,'cleanup.json'),JSON.stringify({drained,pendingRows:pending?.length??null,actorRoots:actors.map(actor=>actor.p.pid)}));
}
assert.ok(cleanupDrained,'Room gate actors or CPU rows did not drain');
