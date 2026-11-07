import { nalatiNativeAssembly } from './nalati-native-assembly';
import * as v from 'valibot';
import type {DamageRequest} from '../../src/shared/engine/combat/pipeline';
import type {HuntBody} from '../../src/server/engine/ai/hunt';
import type {SimHost} from '../../src/server/engine/sim';
import type {PrepareHeadlessRuntime} from '../../src/server/host/headlessRuntime';
import {patrolOf,preparePatrol,readPatrolIntake,type NativePatrol} from '../../src/server/game/boss/patrolNative';
import {prepareNalatiWorld,type NalatiEncounterIntake,type NalatiWorldLoans} from './nalati-world';

export type NativeNalatiPatrol=NativePatrol;
export function nalatiPatrolOf(host:SimHost):NativeNalatiPatrol|undefined{return patrolOf(host);}

/** A later entered arena may add recipes and borrow the same native body
 * scheduler. Defaults preserve the original patrol preparation exactly. */
export interface NalatiPatrolExtras {
  readonly intake:NalatiEncounterIntake;
  readonly bindings:NonNullable<NalatiWorldLoans['observeBindings']>;
  /** TimedEncounters updates its original slot owner immediately before patrol. */
  readonly beforePatrol?:(host:SimHost,dt:number)=>void;
}

/** Bind the product's patrol on a tape's world. */
export async function prepareNalatiPatrol(preparation:Parameters<PrepareHeadlessRuntime>[0],
  eliteDamage?:(host:SimHost,actor:HuntBody,request:DamageRequest)=>number,
  afterPatrol?:(host:SimHost,dt:number)=>void,
  observeWeather?:NalatiWorldLoans['observeWeather'],extras?:NalatiPatrolExtras):Promise<Awaited<ReturnType<PrepareHeadlessRuntime>>>{
  const product=preparation.product,assembly=await nalatiNativeAssembly();
  const {constants}=v.parse(v.object({constants:v.object({nativeTaming:v.object({herds:v.string()}),pageElites:v.object({borrowed:v.array(v.unknown())})})}),assembly);
  const row={step:'nalati.patrol',rows:'combat/timed-encounters.json',actors:'actors/sheep.json',looks:'actors/species-looks.json',herds:constants.nativeTaming.herds,external:constants.pageElites.borrowed};
  const [intake,patrol]=await Promise.all([readPatrolIntake(product,row),preparePatrol(product,row)]);
  const combined=extras===undefined?intake:{...extras.intake,species:[...intake.species,...extras.intake.species],recipes:[...intake.recipes,...extras.intake.recipes]};
  const base=await prepareNalatiWorld(preparation,combined,{...(observeWeather===undefined?{}:{observeWeather}),...(extras===undefined?{}:{observeBindings:extras.bindings})});
  return {...base,install:(host,context)=>{
    const finish=patrol.begin(host,{eliteDamage,afterPatrol,beforePatrol:extras?.beforePatrol});
    base.install(host,context);finish();
  }};
}

export const prepareHeadlessRuntime:PrepareHeadlessRuntime=preparation=>prepareNalatiPatrol(preparation);
