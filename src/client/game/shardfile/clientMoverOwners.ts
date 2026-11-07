/** Concrete entered mover views over construction-owned scene objects and chains. */
import type { Scope } from '@wildshard/engine/app/scope';
import type { ShardContext } from '../plugin/context';
import { installFollowedMovers, type FollowedMovers, type MoverView } from '../plugin/followedMovers';
import { entryOwner } from '../../../shared/game/shardfile/entryOwners';
import { boundResidentWorldScope } from './hybridPresentation';
import { hasLentLook, lentLooksOf, setLentParam, type LentLooks } from './lentLooks';
import { productClosureFile } from '../../../shared/game/shardfile/shardProduct';
import { materialGraphIr } from '@wildshard/format/materials';

export interface MoverMoorRows {readonly look:string;readonly water:number;readonly cleats:readonly [number,number]}
export type MoverOwnerBinding =
  | {readonly id:string;readonly kind:'object';readonly owner:string;readonly order?:'XYZ'|'YXZ';readonly visibility?:'enabled';readonly moor?:MoverMoorRows}
  | {readonly id:string;readonly kind:'chain';readonly owner:string};
export interface MoverOwnerRows {readonly system:string;readonly bindings:readonly MoverOwnerBinding[]}
const installed=new WeakSet<Scope>();
/** Every mover id and original target is admitted before effects. The existing
 * rows pose each collider and view. No authored callback, object path or second
 * native body enters through these bindings. Declared mooring cleats update their
 * vec2 look immediately after each pose. */
export async function installClientMoverOwners(ctx:ShardContext,rows:MoverOwnerRows,install:typeof installFollowedMovers=installFollowedMovers):Promise<FollowedMovers|undefined>{
  const scope=ctx.scope,construction=boundResidentWorldScope(scope);
  const live=():void=>{
    if(scope.disposed||scope.disposing)throw new Error('Mover entry owner has ended');
    if(construction!==undefined&&(construction.disposed||construction.disposing||boundResidentWorldScope(scope)!==construction))throw new Error('Mover construction owner has ended or changed');
  };
  live();
  // A direct native entry kept the authored rest and never owned a client drive.
  // Standalone shardfile entries use hybridInstallation and bind a resident too.
  if(construction===undefined)return undefined;
  const world=ctx.game.runtime?.world;
  if(world===undefined||world===null)throw new Error('Mover entry requires its world');
  if(installed.has(scope))throw new Error('Mover entry is already installed');
  const data=ctx.product.section('world/movers').movers,ids=new Set(rows.bindings.map(row=>row.id));
  if(ids.size!==rows.bindings.length||ids.size!==data.length||data.some(row=>!ids.has(row.id)))throw new Error('Mover owners require the exact admitted id set');
  const loans=rows.bindings.map(row=>{
    const declared=data.find(mover=>mover.id===row.id);
    if(declared===undefined||(declared.kind==='chain')!==(row.kind==='chain'))throw new Error('Mover owner kind differs from its admitted primitive');
    return row.kind==='chain'?{row,value:entryOwner(scope,'chain',row.owner)}:{row,value:entryOwner(scope,'object',row.owner)};
  });
  const moors=new Map<string,[number,number]>(),looks=new Map<string,LentLooks>();
  for(const row of rows.bindings)if(row.kind==='object'&&row.moor!==undefined){
    const moor=row.moor,look=ctx.product.shardfile.look.materials[moor.look];
    if(!Number.isFinite(moor.water)||moor.cleats.some(value=>!Number.isFinite(value)))throw new Error('Mooring requires finite water and two cleats');
    // D74: the look's graph is its graph file
    const bytes=look?.family==='graph'&&'file' in look?await productClosureFile(ctx.product,look.file):undefined;
    if(look?.family!=='graph'||'preset' in look||materialGraphIr(look,()=>bytes).params?.['moor']?.type!=='vec2'||!hasLentLook(moor.look))throw new Error('Mooring requires its declared lent vec2 look');
    moors.set(row.id,[0,0]);looks.set(moor.look,lentLooksOf(moor.look));
  }
  const current=():void=>{
    live();
    for(const [id,look] of looks)if(!hasLentLook(id)||lentLooksOf(id)!==look)throw new Error('Mover look owner changed during admission');
    for(const loan of loans){
      const value=loan.row.kind==='chain'?entryOwner(scope,'chain',loan.row.owner):entryOwner(scope,'object',loan.row.owner);
      if(value!==loan.value)throw new Error('Mover entry owner changed during admission');
    }
  };
  const views=new Map<string,MoverView>();
  // Resolve kinds again without reflected access; each callback is compiled
  // platform presentation over one typed loan, never supplied by authored data.
  for(const row of rows.bindings){
    if(row.kind==='chain'){views.set(row.id,{chain:entryOwner(scope,'chain',row.owner),pose:()=>undefined});continue;}
    const group=entryOwner(scope,'object',row.owner);
    const moor=row.moor,lift=moors.get(row.id);
    views.set(row.id,{pose:pose=>{
      if(row.visibility==='enabled')group.visible=pose.enabled;
      group.position.set(pose.position.x,pose.position.y,pose.position.z);
      group.rotation.set(pose.euler.x,pose.euler.y,pose.euler.z,row.order??'YXZ');
      if(moor!==undefined&&lift!==undefined){
        const heave=pose.position.y-moor.water,pitch=Math.sin(pose.euler.x);
        lift[0]=heave-moor.cleats[0]*pitch;lift[1]=heave-moor.cleats[1]*pitch;
        setLentParam(moor.look,'moor',lift);
      }
    }});
  }
  current();installed.add(scope);scope.onDispose(()=>{installed.delete(scope);});
  for(const row of rows.bindings)if(row.kind==='object')scope.expose(entryOwner(scope,'object',row.owner).userData,'declaredMotion',true);
  const result=install(ctx,world,{data,views,systemId:rows.system,restoreFlags:new Set()});
  current();return result;
}
