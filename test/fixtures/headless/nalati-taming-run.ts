// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Load the admitted product and original native physics module.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Assert actual native ownership and checkpoint continuation.
import assert from 'node:assert/strict';
import * as v from 'valibot';
import {builtProduct} from '../builtProduct';
import {loadHeadlessProduct} from '../../../src/server/host/headlessProduct';
import {outputDescriptor} from '../../../src/shared/game/shardfile/outputDescriptor';
import {loadRapier} from '../../../src/shared/engine/physics/rapier';
import {snapshotSimHostBytes,serializeSimSnapshot} from '../../../src/shared/engine/sim/snapshot';
import {nativeTamingOf} from '../../../src/server/game/riding/nativeTaming';
import {mountedPlayerOf} from '../../../src/server/game/riding/native';
import {createNativeProofResident,prepareProductPlan as prepareHeadlessRuntime} from '../headless-native';
import {canonicalSimDigest} from '../../fake/simState';
import {walkNalatiHorsePlains} from '../../proof/nalati-grasslands/horsePlainsWalk';
import {createNalatiTamingPilot} from '../../proof/nalati-grasslands/tamingPilot';
import {TickCommandSchema,type HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import type {PrepareHeadlessRuntime} from '../../../src/server/host/headlessRuntime';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

interface BondedObservation {
  readonly phase:string;readonly upgraded:boolean;readonly flags:readonly string[];
  readonly quests:readonly {id:string;started:boolean;complete:boolean;current:string|null}[];
  readonly player:{readonly x:number;readonly y:number;readonly z:number};
  readonly companion:{readonly id:string;readonly x:number;readonly y:number;readonly z:number}|null;
  readonly companions:string|null;
}
interface TamingProofOptions {
  /** Reinstall the same real owners on both sides of the earned checkpoint. */
  readonly prepare?:PrepareHeadlessRuntime;
  /** Bounded native input after actual adoption, replayed on both owners. */
  readonly postBondCommands?:readonly (readonly HeadlessCommand[])[];
  /** Detached observations only; the verifier cannot mutate either resident. */
  readonly verifyBonded?:(first:BondedObservation,restored:BondedObservation)=>void;
}

/** The real entry, physical approach and every bucking round. A checkpoint
 * is captured from accepted live state, never supplied by the caller. */
export async function runNalatiFieldTaming(options:TamingProofOptions={}):Promise<{ticks:number;approachTicks:number;breakingTicks:number;checkpointTick:number;rounds:number}> {
  const prepare=options.prepare??prepareHeadlessRuntime;
  const after=v.parse(v.pipe(v.array(v.pipe(v.array(TickCommandSchema),v.maxLength(1024))),v.maxLength(600)),options.postBondCommands??[]);
  const directory=builtProduct('nalati-grasslands'),product=await loadHeadlessProduct(directory),shard=product.shardfile;
  const descriptor=outputDescriptor(shard);assert.ok(descriptor);
  const assets=new Map(descriptor.index.files.map(file=>[file.commons===true?`commons:${file.hash}`:file.hash,
    Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const preparation={shard,assets,rapier,product},first=await createNativeProofResident(preparation,prepare);
  let restored:Awaited<ReturnType<typeof createNativeProofResident>>|undefined;
  try{
    const taming=nativeTamingOf(first.host),mounted=mountedPlayerOf(first.host);assert.ok(taming);assert.ok(mounted);
    assert.equal(leadPlayer(first.host).position.x,shard.spawn.x);assert.equal(leadPlayer(first.host).position.z,shard.spawn.z);
    const original=[...first.host.entities.values()].find(actor=>actor.kind==='horse'&&actor.variant==='stallion');assert.ok(original);
    let inputs=0;
    const step=(commands:readonly HeadlessCommand[]):void=>{
      assert.ok(inputs++<80_000,'the input route must stay within its finite allowance');first.step(commands);
      assert.deepEqual(first.effects,[],'walking or taming cannot mint quest completion facts');
    };
    walkNalatiHorsePlains(first.host,step);const approachTicks=first.host.state.tick;
    const pilot=createNalatiTamingPilot();let prompt=false,breakingTicks=0,checkpointTick=0,rounds=0;
    for(let tick=0;tick<40000&&taming.phase!=='bonded';tick++){
      const commands=pilot(first.host,original.entityId);
      prompt ||= taming.interactable.radius>0;
      if(taming.phase==='breaking'){breakingTicks++;rounds=Math.max(rounds,taming.view.round??0);}
      step(commands);restored?.step(commands);
      if(restored===undefined&&taming.phase==='breaking'&&breakingTicks===250){
        const saved=snapshotSimHostBytes(first.host);checkpointTick=first.host.state.tick;
        restored=await createNativeProofResident(preparation,prepare,serializeSimSnapshot(saved));
        assert.equal(canonicalSimDigest(snapshotSimHostBytes(restored.host)),canonicalSimDigest(saved),'the earned mid-round checkpoint restores quietly');
      }
    }
    assert.equal(prompt,true);assert.equal(rounds,5);assert.equal(taming.phase,'bonded');assert.ok(restored);
    assert.equal(taming.companion?.variant,'tulpar');assert.equal(mounted.horse,taming.companion);
    assert.equal(original.alive,true);assert.equal(first.host.entities.get(original.entityId),original);
    assert.equal(original.position.y,-1e4);assert.equal(original.motor,null);
    assert.equal(canonicalSimDigest(snapshotSimHostBytes(restored.host)),canonicalSimDigest(snapshotSimHostBytes(first.host)),
      'the complete actual bucking/adoption suffix survives reinstall');
    for(const commands of after){step(commands);restored.step(commands);}
    assert.equal(canonicalSimDigest(snapshotSimHostBytes(restored.host)),canonicalSimDigest(snapshotSimHostBytes(first.host)),
      'the same real post-bond inputs retain the restored continuation');
    const observe=(owner:typeof first):BondedObservation=>{
      const state=nativeTamingOf(owner.host);assert.ok(state);
      const at=leadPlayer(owner.host).position,companion=state.companion,observation=owner.host.adapters.get('nalati.companions')?.snapshot();
      return {phase:state.phase,upgraded:state.upgraded,flags:[...owner.host.flags.all],player:{x:at.x,y:at.y,z:at.z},
        companion:companion===null?null:{id:companion.entityId,x:companion.position.x,y:companion.position.y,z:companion.position.z},
        companions:observation===undefined?null:typeof observation==='string'?observation:JSON.stringify(observation),
        quests:owner.host.quests.map(quest=>({id:quest.def.id,started:quest.isStarted,complete:quest.isComplete,current:quest.current?.id??null}))};
    };
    options.verifyBonded?.(observe(first),observe(restored));
    return {ticks:first.host.state.tick,approachTicks,breakingTicks,checkpointTick,rounds};
  }finally{restored?.dispose();first.dispose();}
}
