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
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';

interface BondedObservation {
  readonly phase:string;readonly upgraded:boolean;readonly flags:readonly string[];
  readonly quests:readonly {id:string;started:boolean;complete:boolean;current:string|null}[];
  readonly player:{readonly x:number;readonly y:number;readonly z:number};
  readonly companion:{readonly id:string;readonly x:number;readonly y:number;readonly z:number}|null;
  readonly companions:string|null;
}
interface TamingProofOptions {
  /** Reinstall the same real owners on both sides of every save. */
  readonly prepare?:PrepareHeadlessRuntime;
  /** Where the player stands, as an offset from the grazing stallion: a position set, as FL12's own `stand()` does. */
  readonly approach:{readonly x:number;readonly z:number};
}
interface RoundsProofOptions extends TamingProofOptions {
  /** Bounded native input after actual adoption, replayed on both owners. */
  readonly postBondCommands?:readonly (readonly HeadlessCommand[])[];
  /** Detached observations only; the verifier cannot mutate either resident. */
  readonly verifyBonded?:(first:BondedObservation,restored:BondedObservation)=>void;
  /** The breaking tick of the earned mid-round checkpoint; the restored world runs in step from there. */
  readonly checkpointAt:number;
}
type Resident=Awaited<ReturnType<typeof createNativeProofResident>>;
type Preparation=Parameters<typeof createNativeProofResident>[0];
interface Stallion {
  readonly taming:NonNullable<ReturnType<typeof nativeTamingOf>>;
  readonly mounted:NonNullable<ReturnType<typeof mountedPlayerOf>>;
  readonly original:AnimalSim;
}

async function nalatiPreparation():Promise<{preparation:Preparation;spawn:{readonly x:number;readonly z:number}}> {
  const directory=builtProduct('nalati-grasslands'),product=await loadHeadlessProduct(directory),shard=product.shardfile;
  const descriptor=outputDescriptor(shard);assert.ok(descriptor);
  const assets=new Map(descriptor.index.files.map(file=>[file.commons===true?`commons:${file.hash}`:file.hash,
    Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return {preparation:{shard,assets,rapier,product},spawn:shard.spawn};
}
/** The one living wild stallion, its taming law and the native mounted owner. */
function stallionOf(resident:Resident):Stallion {
  const taming=nativeTamingOf(resident.host),mounted=mountedPlayerOf(resident.host);assert.ok(taming);assert.ok(mounted);
  const original=[...resident.host.entities.values()].find(actor=>actor.kind==='horse'&&actor.variant==='stallion');assert.ok(original);
  return {taming,mounted,original};
}
/** A position set, as a player would stand there: the stallion is still wild, unbroken and untrusting. */
function standBy(resident:Resident,{taming,original}:Stallion,at:{readonly x:number;readonly z:number}):void {
  assert.equal(taming.phase,'wild');assert.equal(taming.interactable.radius,0);
  const player=leadPlayer(resident.host),x=original.position.x+at.x,z=original.position.z+at.z;
  player.position.set(x,resident.host.groundHeightAt(x,z)+.05,z);player.motor.resetAt(player.position);
}
/** Each step is held to the route's finite allowance and may not mint a quest fact. */
function checkedStep(resident:Resident):(commands:readonly HeadlessCommand[])=>void {
  let inputs=0;
  return commands=>{
    assert.ok(inputs++<80_000,'the input route must stay within its finite allowance');resident.step(commands);
    assert.deepEqual(resident.effects,[],'walking or taming cannot mint quest completion facts');
  };
}
/** Save accepted live state and reinstall it on a fresh resident; the two must agree exactly. */
async function restoreQuietly(from:Resident,preparation:Preparation,prepare:PrepareHeadlessRuntime,message:string):Promise<Resident> {
  const saved=snapshotSimHostBytes(from.host),restored=await createNativeProofResident(preparation,prepare,serializeSimSnapshot(saved));
  try{assert.equal(canonicalSimDigest(snapshotSimHostBytes(restored.host)),canonicalSimDigest(saved),message);}
  catch(error){restored.dispose();throw error;}
  return restored;
}
/** Dispose every resident, each independently: one throwing never leaves another live. */
function disposeAll(...residents:readonly (Resident|undefined)[]):void {
  const errors:unknown[]=[];
  for(const resident of residents){try{resident?.dispose();}catch(error){errors.push(error);}}
  if(errors.length===1)throw errors[0];if(errors.length>1)throw new AggregateError(errors,'resident disposal failed');
}
/** Flags and quest state that walking, the approach or taming may never grant on their own. */
export const UNEARNED_FLAGS=['tamed:horse','talked:elder','won:kokpar','quest:tulpar','quest:golden-king','quest:father-wind'] as const;
function assertNothingUnearned(resident:Resident):void {
  for(const flag of UNEARNED_FLAGS)assert.equal([...resident.host.flags.all].includes(flag),false,`taming never grants ${flag}`);
  const tulpar=resident.host.quests.find(quest=>quest.def.id==='tulpar');assert.ok(tulpar);
  assert.deepEqual({started:tulpar.isStarted,complete:tulpar.isComplete,current:tulpar.current?.id??null},{started:false,complete:false,current:null});
}

/** FAST-SLOW-TESTS FS4, leg 1 of 2: from spawn, the real walk to the plains, then a physical approach that earns the
 * living stallion's prompt with no trust grant or forced break, and the press that starts breaking. That breaking
 * start is saved from accepted live state; the restored world matches it and rides on in step for a second. */
export async function runNalatiFieldApproach(options:TamingProofOptions):Promise<{approachTicks:number;promptTick:number;breakingTick:number}> {
  const prepare=options.prepare??prepareHeadlessRuntime,{preparation,spawn}=await nalatiPreparation();
  const first=await createNativeProofResident(preparation,prepare);let restored:Resident|undefined;
  try{
    const stallion=stallionOf(first),{taming,mounted,original}=stallion,step=checkedStep(first);
    assert.equal(leadPlayer(first.host).position.x,spawn.x);assert.equal(leadPlayer(first.host).position.z,spawn.z);
    walkNalatiHorsePlains(first.host,step);const approachTicks=first.host.state.tick;
    standBy(first,stallion,options.approach);
    const pilot=createNalatiTamingPilot();let promptTick=0;
    for(let tick=0;tick<40000&&taming.phase!=='breaking';tick++){
      if(promptTick===0&&taming.interactable.radius>0)promptTick=first.host.state.tick;
      step(pilot(first.host,original.entityId));
    }
    assert.ok(promptTick>approachTicks,'the physical approach earns the prompt');assert.equal(taming.phase,'breaking');
    assert.equal(mounted.horse,original);assert.equal(original.alive,true);
    const breakingTick=first.host.state.tick;
    restored=await restoreQuietly(first,preparation,prepare,'the earned breaking start restores quietly');
    for(let tick=0;tick<60;tick++){const commands=pilot(first.host,original.entityId);step(commands);restored.step(commands);}
    assert.equal(taming.phase,'breaking');
    assert.equal(canonicalSimDigest(snapshotSimHostBytes(restored.host)),canonicalSimDigest(snapshotSimHostBytes(first.host)),
      'the restored breaking start rides on in step');
    assertNothingUnearned(first);assertNothingUnearned(restored);
    return {approachTicks,promptTick,breakingTick};
  }finally{disposeAll(restored,first);}
}

/** FAST-SLOW-TESTS FS4, leg 2 of 2: every bucking round, the earned mid-round checkpoint, adoption and the post-bond
 * call. Leg 1 proves the walk and the earned prompt. Here the same kind of breaking start is reached the FS3 way: the
 * player stands by the living stallion and the law's own `forceBreak()` puts them on. That start is saved, and the
 * rounds run on the world restored from the save. The mid-round checkpoint is captured from accepted live state,
 * never supplied by the caller. */
export async function runNalatiFieldRounds(options:RoundsProofOptions):Promise<{ticks:number;breakingTicks:number;checkpointTick:number;rounds:number}> {
  const prepare=options.prepare??prepareHeadlessRuntime,{preparation,spawn}=await nalatiPreparation();
  const after=v.parse(v.pipe(v.array(v.pipe(v.array(TickCommandSchema),v.maxLength(1024))),v.maxLength(600)),options.postBondCommands??[]);
  let seed:Resident|undefined=await createNativeProofResident(preparation,prepare),first:Resident|undefined,restored:Resident|undefined;
  try{
    const stallion=stallionOf(seed),seedStep=checkedStep(seed),seedPilot=createNalatiTamingPilot();
    assert.equal(leadPlayer(seed.host).position.x,spawn.x);assert.equal(leadPlayer(seed.host).position.z,spawn.z);
    standBy(seed,stallion,options.approach);
    for(let tick=0;tick<30;tick++)seedStep(seedPilot(seed.host,stallion.original.entityId));
    assert.equal(stallion.taming.phase,'wild');stallion.taming.forceBreak();assert.equal(stallion.taming.phase,'breaking');
    first=await restoreQuietly(seed,preparation,prepare,'the breaking start restores quietly');
    const retired=seed;seed=undefined;retired.dispose();
    const {taming,mounted,original}=stallionOf(first),step=checkedStep(first);
    assert.equal(nativeTamingOf(first.host)?.phase,'breaking','the restored world is still breaking');assert.equal(mounted.horse,original);
    const pilot=createNalatiTamingPilot();let breakingTicks=0,checkpointTick=0,rounds=0;
    for(let tick=0;tick<40000&&taming.phase!=='bonded';tick++){
      const commands=pilot(first.host,original.entityId);
      if(taming.phase==='breaking'){breakingTicks++;rounds=Math.max(rounds,taming.view.round??0);}
      step(commands);restored?.step(commands);
      if(restored===undefined&&taming.phase==='breaking'&&breakingTicks===options.checkpointAt){
        checkpointTick=first.host.state.tick;
        restored=await restoreQuietly(first,preparation,prepare,'the earned mid-round checkpoint restores quietly');
      }
    }
    assert.equal(rounds,5);assert.equal(taming.phase,'bonded');assert.ok(restored);
    assert.equal(taming.companion?.variant,'tulpar');assert.equal(mounted.horse,taming.companion);
    assert.equal(original.alive,true);assert.equal(first.host.entities.get(original.entityId),original);
    assert.equal(original.position.y,-1e4);assert.equal(original.motor,null);
    assert.equal(canonicalSimDigest(snapshotSimHostBytes(restored.host)),canonicalSimDigest(snapshotSimHostBytes(first.host)),
      'the complete actual bucking/adoption suffix survives reinstall');
    for(const commands of after){step(commands);restored.step(commands);}
    assert.equal(canonicalSimDigest(snapshotSimHostBytes(restored.host)),canonicalSimDigest(snapshotSimHostBytes(first.host)),
      'the same real post-bond inputs retain the restored continuation');
    const observe=(owner:Resident):BondedObservation=>{
      const state=nativeTamingOf(owner.host);assert.ok(state);
      const at=leadPlayer(owner.host).position,companion=state.companion,observation=owner.host.adapters.get('nalati.companions')?.snapshot();
      return {phase:state.phase,upgraded:state.upgraded,flags:[...owner.host.flags.all],player:{x:at.x,y:at.y,z:at.z},
        companion:companion===null?null:{id:companion.entityId,x:companion.position.x,y:companion.position.y,z:companion.position.z},
        companions:observation===undefined?null:typeof observation==='string'?observation:JSON.stringify(observation),
        quests:owner.host.quests.map(quest=>({id:quest.def.id,started:quest.isStarted,complete:quest.isComplete,current:quest.current?.id??null}))};
    };
    options.verifyBonded?.(observe(first),observe(restored));
    return {ticks:first.host.state.tick,breakingTicks,checkpointTick,rounds};
  }finally{disposeAll(restored,first,seed);}
}
