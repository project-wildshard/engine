import type {SimHost} from '../../src/server/engine/sim';
import type {HuntBody} from '../../src/server/engine/ai/hunt';
import type {NativeEliteBindings} from '../../src/server/engine/ai/eliteRoster';
import {prepareSlots,slotsOf,type SlotHeld} from '../../src/server/game/boss/slotsNative';
import type {SlotEncounterLaw,SlotTell} from '../../src/shared/game/boss/slotLaw';
import {prepareNalatiTitan} from './nalati-titan-native';
import {readEncounterIntake} from '../../src/server/game/population/encounterBook';
import {readNalatiWeaponObservation} from './nalati-weapon-observation';
import type {NalatiEncounterIntake} from './nalati-world';
import type {PrepareHeadlessRuntime} from '../../src/server/host/headlessRuntime';
import {leadPlayer} from '@wildshard/engine/sim/leadPlayer';

const SLOTS={step:'nalati.patrol',rows:'combat/timed-encounters.json',actors:'actors/sheep.json',looks:'actors/species-looks.json'} as const;
export interface NativeNalatiBalbals {readonly law:SlotEncounterLaw<HuntBody,SlotTell>;readonly contacts:()=>number;readonly adoptAdd:(body:HuntBody)=>void}
export interface NalatiBalbalPreparation {readonly intake:NalatiEncounterIntake;readonly bindings:(host:SimHost,bindings:NativeEliteBindings)=>void;
  readonly closedInputOwner?:(host:SimHost)=>void}
const owners=new WeakMap<SimHost,NativeNalatiBalbals>();
export function nalatiBalbalsOf(host:SimHost):NativeNalatiBalbals|undefined{return owners.get(host);}

/** The real slot owner (`slotsNative`) on this harness: only what a test
 * reads beside it lives here, the contacts it counts and the arms it holds. */
export async function prepareNalatiBalbals(preparation:Parameters<PrepareHeadlessRuntime>[0],extra?:NalatiBalbalPreparation):Promise<Awaited<ReturnType<PrepareHeadlessRuntime>>>{
  const [intake,plan]=await Promise.all([readEncounterIntake(preparation.product,['balbal']),prepareSlots(preparation.product,SLOTS)]);
  if(plan===null)throw new Error('Balbals require their timed slot actors');
  const bindings=new WeakMap<SimHost,NativeEliteBindings>();
  const combined=extra===undefined?intake:{...extra.intake,species:[...intake.species,...extra.intake.species],recipes:[...intake.recipes,...extra.intake.recipes]};
  const base=await prepareNalatiTitan(preparation,{intake:combined,...(extra?.closedInputOwner===undefined?{}:{closedInputOwner:extra.closedInputOwner}),beforePatrol:(host,dt)=>{plan.advance(host,dt);},bindings:(host,owner)=>{
    bindings.set(host,owner);extra?.bindings(host,owner);
  }});
  return {...base,install:(host,context)=>{
    base.install(host,context);
    const elite=bindings.get(host);
    if(elite===undefined||owners.has(host))throw new Error('Balbal owner lacks its original bindings');
    const held:SlotHeld=()=>{
      const weapon=host.adapters.get('nalati.weapons');if(weapon===undefined)throw new Error('Balbal damage requires its actual held owner');
      return readNalatiWeaponObservation(weapon);
    };
    plan.install(host,elite,context.restoring,held);
    const slots=slotsOf(host);if(slots===undefined)throw new Error('Balbal slots did not install');
    let contacts=0;
    host.events.on('damage.dealt',event=>{if(event.req.target===leadPlayer(host).health)contacts++;},host.scope);
    owners.set(host,{law:slots.law,contacts:()=>contacts,adoptAdd:slots.adopt});
    host.scope.onDispose(()=>{owners.delete(host);bindings.delete(host);});
  }};
}
export const prepareHeadlessRuntime:PrepareHeadlessRuntime=preparation=>prepareNalatiBalbals(preparation);
