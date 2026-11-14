// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Native owner admission and continuation are asserted in the bounded child.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- The original shipped Rapier module is part of the native product proof.
import {readFileSync} from 'node:fs';
import {beginFolderSession} from './folderSession';
import {createNativeProofResident} from '../headless-native';
import {prepareHeadlessRuntime} from '../nalati-chapter-native';
import {loadRapier} from '../../../src/shared/engine/physics/rapier';
import {decodeSimSnapshot,snapshotSimHost} from '../../../src/shared/engine/sim/snapshot';
import {physicsState,sameBytes} from '../../fake/simState';
import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { leadSnapshot } from '@wildshard/engine/sim/snapshot';

let priorPhase=0;
const phase=(name:string,tick?:number):void=>{const now=performance.now();console.info(JSON.stringify({diagnostic:'nalati-chapter-binding-phase',phase:name,atMs:Math.round(now),phaseMs:Math.round(now-priorPhase),...(tick===undefined?{}:{tick})}));priorPhase=now;};
phase('imports-ready');
const session=await beginFolderSession('nalati-grasslands','nalati-chapter'),{product,assets}=session;
phase('product-session-started');
const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
phase('physics-loaded');
const resident=await createNativeProofResident({shard:product.shardfile,assets,product,rapier},prepareHeadlessRuntime);
phase('resident-created',resident.host.state.tick);
const worker=await session.ready();
phase('worker-ready');
try{
  const {host}=resident,poll=host.adapters.get('nalati.chapter-poll'),closed=host.adapters.get('nalati.king-closed');assert.ok(poll);assert.ok(closed);
  assert.deepEqual(closed.snapshot(),{kind:'closed'});
  const detached=closed.snapshot();assert.ok(detached!==null&&typeof detached==='object');Reflect.set(detached,'kind','entered');assert.deepEqual(closed.snapshot(),{kind:'closed'});
  assert.throws(()=>closed.restore({kind:'entered'}));assert.throws(()=>poll.restore({now:-1,slowT:0,pulseT:0}));assert.throws(()=>poll.restore({now:1,slowT:0,pulseT:0}),/clock differs/u);
  const frames:HeadlessCommand[][]=Array.from({length:128},(_,tick)=>tick%16===0?[{kind:'script',actorId:'nalati.talk',value:0}]:[]);
  for(const commands of frames)resident.step(commands);
  phase('inputs-recorded',host.state.tick);
  const repeated=await worker.verbTapePart({version:1,observe:['nalati.chapter-poll','nalati.king-closed'],segments:[{id:'closed-entry',ticks:frames.length,commands:[],frames}]});
  phase('replay-returned',repeated.commit.tick);
  const {physics:a,...actual}=decodeSimSnapshot(repeated.commit.snapshot),{physics:b,...expected}=snapshotSimHost(host);
  assert.deepEqual(actual,expected);if(!sameBytes(a,b))assert.deepEqual(physicsState(a),physicsState(b));
  phase('canonical-compared',host.state.tick);
  for(const flag of ['talked:elder','tamed:horse','won:kokpar','quest:tulpar','entered:kurgan','dead:golden-king','dead:jel-ata'])assert.equal(host.flags.has(flag),false,flag);
  assert.equal(host.quests.find(row=>row.def.id==='tulpar')?.isStarted,false);assert.deepEqual(resident.effects,[]);
  // A continuation cannot turn the explicit closed loan into a free King
  // entrance. The altered state is negative intake only, never a played tape.
  const saved=snapshotSimHost(host),door=product.shardfile.quests.quests.find(row=>row.id==='golden-king')?.steps.find(row=>row.id==='door')?.markers?.[0]?.at;assert.ok(door);
  const forged={...saved,players:[{...leadSnapshot(saved),position:[door.x,leadPlayer(host).position.y,door.z] as [number,number,number]}]};
  await assert.rejects(()=>createNativeProofResident({shard:product.shardfile,assets,product,rapier},prepareHeadlessRuntime,forged),/Closed King loan/u);
  phase('forged-continuation-refused',host.state.tick);
  console.info(JSON.stringify({story:'nalati-chapter-binding',ticks:frames.length,closed:true,replayed:true}));
  resident.dispose();assert.throws(()=>poll.snapshot(),/retired/u);assert.throws(()=>closed.snapshot(),/retired/u);
}finally{resident.dispose();phase('resident-retired');await worker.dispose();phase('worker-retired');}
