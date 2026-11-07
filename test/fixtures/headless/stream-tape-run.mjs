// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst.ts';
import assert from 'node:assert/strict';
import {hrtime} from 'node:process';
import {HeadlessSimulation} from '../../../src/server/host/headless.ts';
import {TickWorkerHost} from '../../../src/server/host/tickWorkerHost.ts';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {emptyShardfile} from '../../../src/shared/host/author.ts';
import {decodeSimSnapshotBytes, leadSnapshot } from '../../../src/shared/engine/sim/snapshot.ts';
const source=emptyShardfile({slug:'stream-tape-fixture',name:'Stream tape',author:'Test',revision:1,seed:435});
source.serverBudget.commandsPerTick=1024;
const open=()=>HeadlessSimulation.create(source,new Map(),undefined,{deadline:'advisory'});
const input={kind:'player',moveX:.2,moveZ:0,yaw:0};
async function* parts(rows){for(const row of rows)yield row;}
const stream=await open(),ordinary=await open();
try{
 await assert.rejects(stream.streamVerbTape([],{[Symbol.asyncIterator](){throw new Error('iterator creation failed');}}),/iterator creation failed/);
 assert.equal(stream.quarantined,false);
 const initial=stream.checkpoint,frames=Array.from({length:72},(_,tick)=>tick<48?[{...input,moveZ:tick<24?0:-.3,yaw:tick/100}]:[]);
 for(const commands of frames)await ordinary.step([{source:'control',commands}]);
 const report=await stream.streamVerbTape([],parts([0,24,48].map((from,index)=>({id:String(index),ticks:24,commands:[],frames:frames.slice(from,from+24)}))));
 assert.equal(report.ticks,72);assert.deepEqual(report.observations.map(row=>row.tick),[24,48,72]);
 assert.deepEqual(report.observations.at(-1).position,leadSnapshot(decodeSimSnapshotBytes(ordinary.checkpoint.snapshot)).position);
 assert.deepEqual(stream.checkpoint,initial);assert.equal(stream.quarantined,false);
 await assert.rejects(stream.step(),/validation finished/);await assert.rejects(stream.verbTape({version:1,observe:[],segments:[{id:'later',ticks:1,commands:[]}]}),/already finished/);
}finally{await stream.dispose();await ordinary.dispose();}
for(const [name,rows,pattern] of [
 ['empty',[],/Empty streamed tape/],
 ['duplicate',[{id:'x',ticks:1,commands:[]},{id:'x',ticks:1,commands:[]}],/aggregate allowance/],
 ['segments',Array.from({length:129},(_,index)=>({id:String(index),ticks:1,commands:[]})),/aggregate allowance/],
 // Declared ticks count even for an already-arrived genuine native route.
 ['ticks',Array.from({length:4},(_,index)=>({id:String(index),ticks:index===3?6001:18000,commands:[],route:[{x:0,z:0},{x:0,z:0}]})),/aggregate allowance/],
 ['commands',Array.from({length:60},(_,index)=>({id:String(index),ticks:1,commands:Array.from({length:index===59?609:1024},()=>input)})),/aggregate allowance/],
]){
 const sim=await open();try{const initial=sim.checkpoint;await assert.rejects(sim.streamVerbTape([],parts(rows)),pattern,name);assert.equal(sim.quarantined,true);assert.deepEqual(sim.checkpoint,initial);}finally{await sim.dispose();}
}
const failed=await open();try{
 async function* broken(){yield {id:'first',ticks:1,commands:[]};throw new Error('capture owner failed');}
 await assert.rejects(failed.streamVerbTape([],broken()),/capture owner failed/);assert.equal(failed.quarantined,true);
}finally{await failed.dispose();}
const synchronous=await open();try{
 const inputSource={[Symbol.asyncIterator](){return {next(){throw new Error('synchronous producer failed');}};}};
 await assert.rejects(synchronous.streamVerbTape([],inputSource),/synchronous producer failed/);assert.equal(synchronous.quarantined,true);
}finally{await synchronous.dispose();}
const closed=await open();try{
 let entered;const producing=new Promise(resolve=>{entered=resolve;});
 const stalled={async *[Symbol.asyncIterator](){entered();await new Promise(()=>{});yield {id:'unreachable',ticks:1,commands:[]};}};
 const pending=closed.streamVerbTape([],stalled);const result=assert.rejects(pending,/disposed/);
 const competing=assert.rejects(closed.step(),/unavailable or busy|validation finished/);
 await producing;await competing;await closed.dispose();await result;
}finally{await closed.dispose();}
const deadline=await open(),realClock=hrtime.bigint;try{
 async function* late(){yield {id:'first',ticks:1,commands:[]};const now=realClock();hrtime.bigint=()=>now+31_000_000_000n;yield {id:'late',ticks:1,commands:[]};}
 await assert.rejects(deadline.streamVerbTape([],late()),/request deadline exceeded/);assert.equal(deadline.quarantined,true);
}finally{hrtime.bigint=realClock;await deadline.dispose();}
const runtime=await HeadlessSimulation.create(source,new Map());try{
 await assert.rejects(runtime.streamVerbTape([],parts([{id:'x',ticks:1,commands:[]}])),/trusted offline timing/);assert.equal(runtime.checkpoint.tick,0);
}finally{await runtime.dispose();}
console.log('streamed native parity, aggregate budgets, producer failure, disposal and global deadline pass');

const wide=new TickWorkerHost(new URL('./stream-wide-worker.mjs',import.meta.url),{},
 {tickMicros:16666,commandsPerTick:1},['--experimental-transform-types','--import',pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href],'advisory');
try{
 await wide.initialized();
 await assert.rejects(wide.streamVerbTape(Array.from({length:6},(_,index)=>`wide-${index}`),parts(Array.from({length:3},(_,index)=>({id:String(index),ticks:1,commands:[]})))),/Tape observation allowance exceeded/);
 assert.equal(wide.quarantined,true);
}finally{await wide.dispose();}
console.log('streamed cumulative reply allowance pass');
