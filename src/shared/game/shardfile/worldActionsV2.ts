/** H4 effects borrow the original concrete owners. This adapter has no queue,
 * tick, registry, contact law, body, RNG or save state of its own. */
import { Vector3 } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import type { SimHost } from '@wildshard/engine/sim';
import type { Player } from '@wildshard/engine/player/Player';
import type {TamingHorse,TamingHerd,TamingServices} from '../riding/bindingTypes';
import {validV2TamingAction,type V2WorldAction} from '@wildshard/format/scriptActionsV2';
import type { NativeMountedPlayer } from '../../../server/game/riding/native';

/** Cell-field storage lends its SAME concrete activate method. Its AS law,
 * delayed writes and update cadence remain with that field owner. */
interface CellFieldPort { activate: (x: number,z: number) => void }
interface Identity { readonly binding: string; readonly target: string; readonly scope: Scope }
interface TamingPresentation<A>{readonly onBonded?:((actor:A)=>void)|undefined;readonly onBreaking?:((on:boolean)=>void)|undefined}
export type TamingActionResult<A>={readonly kind:'mounted';readonly accepted:boolean}|{readonly kind:'adopted'|'retired';readonly actor:A};
export type V2WorldActionLoan<A extends TamingHorse=TamingHorse,H extends TamingHerd<A>=TamingHerd<A>> = Identity & (
  { readonly kind: 'mount'; readonly owner: Pick<NativeMountedPlayer,'mounted' | 'dismount'> }
  | { readonly kind: 'cell-field'; readonly owner: CellFieldPort }
  | { readonly kind: 'native-player'; readonly owner: SimHost }
  | { readonly kind: 'page-player'; readonly owner: Pick<Player,'impulse'> }
  | {readonly kind:'taming';readonly owner:TamingServices<A,H>;readonly services:TamingServices<A,H>;readonly presentation:TamingPresentation<A>}
  | {readonly kind:'taming-herd';readonly owner:H}
  | {readonly kind:'taming-actor';readonly owner:A;readonly services:TamingServices<A,H>;readonly presentation:TamingPresentation<A>}
);
function key(binding: string,target: string): string { return JSON.stringify([binding,target]); }
function live(scope: Scope): void { if (scope.disposed || scope.disposing) throw new Error('Retired v2 action owner'); }
/** Prepared by the original authority alongside other command families.
 * No effect runs until every candidate bank has passed its own preparation. */
export interface PreparedV2WorldActions<A=TamingHorse> {
  readonly validate: () => void;
  readonly operations: readonly (() => TamingActionResult<A>|undefined)[];
}
/** Snapshot scalar operands and concrete loans without applying effects. The
 * combined caller validates every family before interleaving these operations
 * in emitted order. Each operation also fences retirement by an earlier effect.
 * This creates no queue, scheduler, continuation or authored callback surface. */
export function prepareV2WorldActions<A extends TamingHorse=TamingHorse,H extends TamingHerd<A>=TamingHerd<A>>(actions: readonly V2WorldAction[],loans: readonly V2WorldActionLoan<A,H>[]): PreparedV2WorldActions<A> {
  if (actions.length > 128 || loans.length > 256) throw new Error('V2 action owner capacity');
  const owners = new Map<string,V2WorldActionLoan<A,H>>();
  for (const loan of loans) {
    live(loan.scope);const id = key(loan.binding,loan.target);
    if (loan.binding.length === 0 || loan.target.length === 0 || owners.has(id)) throw new Error('Duplicate or empty v2 action loan');
    if (loan.kind === 'native-player' && (loan.owner.scope !== loan.scope || loan.owner.embedded)) throw new Error('Borrowed v2 player impulse authority');
    owners.set(id,{ ...loan });
  }
  const prepared = actions.map(input => {
    const action = { ...input },loan = owners.get(key(action.binding,action.target));
    if(loan===undefined)throw new Error('Unowned v2 world action');const taming=prepareTamingAction(action,loan);if(taming!==null)return taming;
    if(action.kind==='taming')throw new Error('Unowned taming action');
    if ((action.kind === 'dismount' ? loan.kind !== 'mount' : action.kind === 'ignite' ? loan.kind !== 'cell-field' : loan.kind !== 'native-player' && loan.kind !== 'page-player')) throw new Error('Unowned v2 world action');
    if (action.kind !== 'dismount' && (!Number.isFinite(action.x) || !Number.isFinite(action.z) || (action.kind === 'impulse' && !Number.isFinite(action.y)))) throw new Error('Non-finite v2 world action');
    const current = (same: boolean): void => { live(loan.scope);if (!same) throw new Error('Changed v2 action authority'); };
    if (action.kind === 'dismount' && loan.kind === 'mount') {
      const owner = loan.owner,method = owner.dismount;
      const validate = (): void => { current(owner.dismount === method); };
      return { validate,apply: (): undefined => { validate();if (owner.mounted) method.call(owner,action.thrown); } };
    }
    if (action.kind === 'ignite' && loan.kind === 'cell-field') {
      const owner = loan.owner,method = owner.activate;
      const validate = (): void => { current(owner.activate === method); };
      return { validate,apply: (): undefined => { validate();method.call(owner,action.x,action.z); } };
    }
    if (action.kind === 'impulse' && loan.kind === 'native-player') {
      const owner = loan.owner;
      const validate = (): void => { current(owner.scope === loan.scope && !owner.embedded); };
      return { validate,apply: (): undefined => { validate();owner.focusedPlayer.addImpulse(new Vector3(action.x,action.y,action.z)); } };
    }
    if (action.kind === 'impulse' && loan.kind === 'page-player') {
      const owner = loan.owner,method = owner.impulse;
      const validate = (): void => { current(owner.impulse === method); };
      return { validate,apply: (): undefined => { validate();method.call(owner,new Vector3(action.x,action.y,action.z)); } };
    }
    throw new Error('Unowned v2 world action');
  });
  return { validate: (): void => {
    for (const loan of owners.values()) live(loan.scope);
    for (const row of prepared) row.validate();
  },operations: Object.freeze(prepared.map(row => row.apply)) };
}

function prepareTamingAction<A extends TamingHorse,H extends TamingHerd<A>>(action:V2WorldAction,loan:V2WorldActionLoan<A,H>):{validate:()=>void;apply:()=>TamingActionResult<A>|undefined}|null {
  if(action.kind!=='taming'&&!(action.kind==='dismount'&&loan.kind==='taming'))return null;
  const operation=action.kind==='dismount'?23:action.operation,values=action.kind==='dismount'?[Number(action.thrown),0,0,0,0,0] as const:action.values;
  if(loan.kind!=='taming'&&loan.kind!=='taming-herd'&&loan.kind!=='taming-actor'||!validV2TamingAction(operation,loan.kind,values,Number.MAX_VALUE))throw new Error('Unowned taming action');
  const [a,b,c,d,e,f]=values,services=loan.kind==='taming-herd'?null:loan.services,presentation=loan.kind==='taming-herd'?null:loan.presentation;
  const mount=services?.mount,player=services?.player,bond=services?.bond,profile=services?.profile;
  const methods=():readonly unknown[]=>loan.kind==='taming-herd'?[loan.owner.addTrust,loan.owner.leadAway,loan.owner.releaseStallion]:[services?.spawnBonded,services?.retireBonded,services?.hideStallion,services?.hurt,services?.toast,services?.herds,mount?.mount,mount?.dismount,mount?.addMountable,mount?.removeMountable,bond?.write,presentation?.onBonded,presentation?.onBreaking,loan.kind==='taming-actor'?loan.owner.setMotion:null];
  const calls=methods(),validate=():void=>{live(loan.scope);if(calls.some((method,index)=>method!==methods()[index])||services!==null&&(services.mount!==mount||services.player!==player||services.bond!==bond||services.profile!==profile))throw new Error('Changed taming action owner');};
  return {validate,apply:()=>{validate();
    if(loan.kind==='taming-herd'){
      const h=loan.owner;
      if(operation===26){h.addTrust(a);if(b===1)h.alert=c;}else if(operation===27)h.alertOwned=a===1;else if(operation===28)h.leadAway(a,b);else if(operation===34)h.releaseStallion();else throw new Error('Unowned taming action');return undefined;
    }
    if(services===null||mount===undefined||player===undefined||bond===undefined||profile===undefined||presentation===null)throw new Error('Unowned taming action');
    if(loan.kind==='taming-actor'){
      const actor=loan.owner;
      if(operation===29)return {kind:'mounted',accepted:mount.mount(actor,a===1)};
      if(operation===36){mount.removeMountable(actor);services.retireBonded(actor);return {kind:'retired',actor};}
      if(operation===35)services.hideStallion(actor);
      else if(operation===33){bond.write(profile.bonds[a]??profile.bonds[0]);services.toast?.(profile.labels.bonded[a]??profile.labels.bonded[0]);presentation.onBonded?.(actor);}
      else if(operation===31){actor.mem['buck']=a;actor.mem['buckDir']=b;if(c>=0)actor.mem['rear']=c;if(d===1)actor.mem['kick']=1;if(e===1)actor.mem['toss']=1;if(f!==0){actor.setMotion(actor.yaw+Math.sign(f)*2,0,3.2);actor.yaw+=f;}}
      else throw new Error('Unowned taming action');return undefined;
    }
    if(operation===32){const actor=services.spawnBonded(a,b,c,d===1);mount.addMountable(actor,profile.names[d]??profile.names[0]);return {kind:'adopted',actor};}
    if(operation===23)mount.dismount(a===1);
    else if(operation===30)services.hurt(a);
    else if(operation===37){mount.breakRoll=0;mount.breakShake=0;presentation.onBreaking?.(a===1);}
    else if(operation===38)services.toast?.(profile.labels[(['trust','start','thrown'] as const)[a]??'trust']);
    else if(operation===39){player.yaw=a;player.pitch=b;}
    else throw new Error('Unowned taming action');return undefined;
  }};
}
