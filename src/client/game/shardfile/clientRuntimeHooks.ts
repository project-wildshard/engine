/** Finite world-entry publications over original construction-owned loans. */
import { Group } from 'three';
import type { Bounds } from '@wildshard/engine/level/spec';
import type { ShardRuntime } from '../../../shared/game/shard/runtime';
import type { Scope } from '@wildshard/engine/app/scope';
import type { ShardContext } from '../plugin/context';
import { entryOwner } from '../../../shared/game/shardfile/entryOwners';
// An admitted play-area policy over the current entered world's player; a room reads the same rows (SS6).
import { outerFloor, type RuntimeBoundsRows } from '@wildshard/engine/game/shardfile/playArea';

/** Preserve the authored fall floor inside the declared threshold and without a player.
 * The getter observes the current world rather than retaining an earlier player. */
export function runtimeLevelBounds(runtime: Pick<ShardRuntime, 'world'>, rows: RuntimeBoundsRows, authored: Bounds | undefined): Bounds | undefined {
  if (authored === undefined) return undefined;
  const [x0, x1] = rows.x, [z0, z1] = rows.z;
  return { x0, x1, z0, z1, get floor(): number {
    const position = runtime.world?.player.position;
    return position === undefined ? authored.floor : outerFloor(rows, authored.floor, position.x, position.z);
  } };
}

export interface RuntimeHookRows {
  readonly bounds?:RuntimeBoundsRows;
  readonly floor?:string;
  readonly overhead:readonly string[];
  readonly meleeSilent?:boolean;
}
interface OverheadLoan { users:number; readonly inserted:boolean }
const overheadLoans=new WeakMap<Group[],Map<Group,OverheadLoan>>();
const installed=new WeakSet<Scope>();
const isGroup=(value:unknown):value is Group=>value instanceof Group;

/** Bind only after the original world constructor publishes all loans. This is
 * an entered world capability: later stages can capture the exact floor hook.
 * Nothing constructs, clones or disposes the borrowed floor or scene objects. */
export function installClientRuntimeHooks(ctx:ShardContext,rows:RuntimeHookRows):void{
  const runtime=ctx.game.runtime,scope=ctx.scope;
  if(scope.disposed||scope.disposing||runtime===undefined)throw new Error('Runtime hooks require a living entered owner');
  if(installed.has(scope))throw new Error('Runtime hooks are already installed');
  if(new Set(rows.overhead).size!==rows.overhead.length)throw new Error('Repeated overhead owner');
  const floor=rows.floor===undefined?undefined:entryOwner(scope,'floor',rows.floor);
  const overhead=rows.overhead.map(id=>{
    const object=entryOwner(scope,'object',id);
    if(!isGroup(object))throw new Error('Overhead owner must be a group');
    return object;
  });
  // All original resources are resolved before even the first hook changes.
  installed.add(scope);scope.onDispose(()=>{installed.delete(scope);});
  if(rows.bounds!==undefined){const bounds=rows.bounds;scope.expose(runtime.hooks,'levelBounds',(authored: Bounds | undefined)=>runtimeLevelBounds(runtime,bounds,authored));}
  if(rows.meleeSilent!==undefined)scope.expose(runtime.hooks,'meleeSilent',rows.meleeSilent);
  if(floor!==undefined)scope.expose(runtime.hooks,'spawnFloor',floor);
  let loans=overheadLoans.get(runtime.overhead);
  if(loans===undefined){loans=new Map();overheadLoans.set(runtime.overhead,loans);}
  const entries=loans,list=runtime.overhead;
  for(const group of overhead){
    let loan=entries.get(group);
    if(loan===undefined){loan={users:0,inserted:!list.includes(group)};entries.set(group,loan);if(loan.inserted)list.push(group);}
    loan.users++;
    const borrowed=loan;
    scope.onDispose(()=>{
      if(--borrowed.users!==0)return;
      entries.delete(group);
      if(borrowed.inserted){const index=list.indexOf(group);if(index!==-1)list.splice(index,1);}
    });
  }
}
