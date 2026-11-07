// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Check actual native spawn and continuation, never supplied output.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Load only the admitted product and unchanged native physics bytes.
import {readFileSync} from 'node:fs';
import {builtProduct} from '../builtProduct';
import {loadHeadlessProduct} from '../../../src/server/host/headlessProduct';
import {outputDescriptor} from '../../../src/shared/game/shardfile/outputDescriptor';
import {loadRapier} from '../../../src/shared/engine/physics/rapier';
import {snapshotSimHostBytes,serializeSimSnapshot} from '../../../src/shared/engine/sim/snapshot';
import {canonicalSimDigest} from '../../fake/simState';
import {createNativeProofResident} from '../headless-native';
import {prepareHeadlessRuntime,nalatiPatrolOf} from '../nalati-patrol-native';
import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

let priorPhase = 0;
const phase = (name: string, tick?: number): void => {
  const at = performance.now();
  console.info(JSON.stringify({diagnostic: 'nalati-night-patrol-phase', phase: name, atMs: Math.round(at), phaseMs: Math.round(at - priorPhase), ...(tick === undefined ? {} : {tick})}));
  priorPhase = at;
};
phase('imports-ready');
const directory=builtProduct('nalati-grasslands'); phase('product-selected');
const product=await loadHeadlessProduct(directory),shard=product.shardfile; phase('product-loaded');
const descriptor=outputDescriptor(shard);assert.ok(descriptor);
const assets=new Map(descriptor.index.files.map(file=>[file.commons===true?`commons:${file.hash}`:file.hash,Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
phase('assets-loaded');
const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm')),input={shard,assets,rapier,product}; phase('physics-loaded');
const first=await createNativeProofResident(input,prepareHeadlessRuntime); phase('resident-created');
let restored:Awaited<ReturnType<typeof createNativeProofResident>>|undefined;
try{
  const owner=nalatiPatrolOf(first.host);assert.ok(owner);
  assert.equal(owner.law.riders.length,0,'the entry cannot pre-spawn its night patrol');
  assert.equal(owner.readiness.eligible,false,'the captain cannot start before the actual kill gate');
  const commands:HeadlessCommand[]=[{kind:'player',moveX:0,moveZ:0,yaw:0,commandVersion:1,crouch:true,steer:{keyX:0,keyY:0,stickX:0,stickY:0}}];
  // Natural fixed time, original day schedule and actual default entry only.
  // No input exists for night, roster creation, kills or readiness.
  for(let tick=0;tick<60_000&&owner.law.riders.length===0;tick++){
    first.step(commands);assert.equal(leadPlayer(first.host).health.alive,true);
    assert.equal(owner.readiness.eligible,false);
    for(const effect of first.effects)assert.equal(effect.kind,'hint','waiting cannot grant quest completion or rewards');
    if(first.host.state.tick%6000===0)phase('waiting-for-natural-night',first.host.state.tick);
  }
  assert.ok(owner.law.riders.length>0,'the original night cycle must select its own riders');
  assert.equal(first.host.dayClock?.dayPhase,'night');
  assert.equal(owner.law.killsTonight,0,'materializing actual riders cannot substitute for killing five');
  assert.ok(owner.law.riders.every(row=>row.a.alive));
  const spawnTick=first.host.state.tick; phase('night-earned',spawnTick);
  for(let tick=0;tick<120;tick++)first.step(commands);
  const saved=snapshotSimHostBytes(first.host),digest=canonicalSimDigest(saved); phase('checkpoint-created',first.host.state.tick);
  restored=await createNativeProofResident(input,prepareHeadlessRuntime,serializeSimSnapshot(saved));
  assert.equal(canonicalSimDigest(snapshotSimHostBytes(restored.host)),digest,'an earned populated checkpoint restores quietly'); phase('checkpoint-restored',restored.host.state.tick);
  const continued=nalatiPatrolOf(restored.host);assert.ok(continued);
  const observation=(resident:typeof first):unknown=>({
    patrol:resident.host.adapters.get('nalati.patrol')?.snapshot(),
    bodies:[...resident.host.entities].map(([id,body])=>[id,body.snapshot()]),
    rng:resident.host.rng.snapshot(),feet:leadPlayer(resident.host).position.toArray(),health:leadPlayer(resident.host).health.snapshot(),
  });
  for(let tick=0;tick<120;tick++){
    first.step(commands);restored.step(commands);
    assert.deepEqual(observation(restored),observation(first),'every native rider, pose, arrow, guest clock and RNG continues exactly');
  }
  assert.equal(canonicalSimDigest(snapshotSimHostBytes(restored.host)),canonicalSimDigest(snapshotSimHostBytes(first.host)),'the complete native world retains the same continuation'); phase('suffix-compared',first.host.state.tick);
  assert.equal(owner.readiness.eligible,false);assert.equal(continued.readiness.eligible,false);
  assert.equal(owner.law.killsTonight,0);assert.equal(continued.law.killsTonight,0);
  assert.equal(leadPlayer(first.host).health.alive,true);
  console.info(JSON.stringify({story:'nalati-night-patrol',spawnTick,riders:owner.law.riders.length,kills:owner.law.killsTonight,ready:owner.readiness.eligible}));
}finally{restored?.dispose();first.dispose();}
