import * as v from 'valibot';
import type {SimHost} from '../../src/server/engine/sim';
import {arenaSealCollider} from '../../src/shared/game/boss/arenaCollision';
import type {NalatiKingData} from './nalati-king-data';
import {originalNalatiPhysics} from './nalati-physics-original';

const finite=v.pipe(v.number(),v.finite()),triple=v.tuple([finite,finite,finite]);
const Source=v.object({pieces:v.array(v.object({id:v.string(),colliders:finite,active:v.boolean(),
  follows:v.exactOptional(v.object({matrix:v.array(finite),rotation:v.boolean()}))})),
  solids:v.array(v.object({body:v.exactOptional(v.nullable(finite)),shape:finite,at:triple,rot:v.tuple([finite,finite,finite,finite]),half:v.exactOptional(triple)}))});
const Saved=v.strictObject({handle:finite,sealed:v.boolean()});
/** Borrow the already admitted seal by its complete source pose/box, never
 * a guessed collider index or an invented blocker. No collider is allocated. */
export function nativeKingSeal(host:SimHost,rows:NalatiKingData['room']):{
  readonly set:(on:boolean)=>void;readonly read:()=>boolean;readonly snapshot:()=>v.InferOutput<typeof Saved>;
  readonly restore:(input:unknown)=>void;readonly physicsRestored:()=>void;
} {
  const source=v.parse(Source,originalNalatiPhysics()),owners=source.pieces.filter(piece=>piece.id===rows.sealId),piece=owners[0];
  const {origin}=rows,box=arenaSealCollider(rows),at=[origin.x+box.x,origin.y+box.y,origin.z+box.z].map(Math.fround),
    half=[box.hx,box.hy,box.hz].map(Math.fround);
  const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,origin.x,origin.y,origin.z,1];
  if(owners.length!==1||piece===undefined||piece.colliders!==1||piece.follows?.rotation!==true
    ||piece.follows.matrix.length!==16||piece.follows.matrix.some((value,index)=>!Object.is(value,matrix[index])))throw new Error('King seal lost its original source owner');
  const solids=source.solids.filter(solid=>solid.body===2&&solid.shape===1&&solid.at.every((value,index)=>Object.is(value,at[index]))
    &&solid.half?.every((value,index)=>Object.is(value,half[index]))===true&&solid.rot.every((value,index)=>Object.is(value,[0,0,0,1][index])));
  if(solids.length!==1)throw new Error('King seal has no unique original box');
  const handles:number[]=[];
  const matches=(collider:NonNullable<ReturnType<SimHost['physics']['world']['getCollider']>>):boolean=>{
    if(collider.shapeType()!==host.physics.R.ShapeType.Cuboid||collider.parent()!==null)return false;
    const p=collider.translation(),h=collider.halfExtents(),q=collider.rotation();
    return h!==null&&[p.x,p.y,p.z].every((value,index)=>Object.is(value,at[index]))&&[h.x,h.y,h.z].every((value,index)=>Object.is(value,half[index]))
      &&[q.x,q.y,q.z,q.w].every((value,index)=>Object.is(value,[0,0,0,1][index]));
  };
  host.physics.world.forEachCollider(collider=>{if(matches(collider))handles.push(collider.handle);});
  const handle=handles[0];if(handles.length!==1||handle===undefined)throw new Error('King seal has no unique admitted physical owner');
  let sealed=piece.active;
  const current=()=>{
    if(host.scope.disposed||host.scope.disposing)throw new Error('King seal retired');
    const collider=host.physics.world.getCollider(handle);if(collider===null||!matches(collider))throw new Error('King seal owner replaced');return collider;
  };
  return {set:on=>{if(typeof on!=='boolean')throw new Error('Invalid King seal input');current().setEnabled(on);sealed=on;},
    read:()=>{current();return sealed;},snapshot:()=>{current();return {handle,sealed};},restore:input=>{
      const saved=v.parse(Saved,input);if(saved.handle!==handle)throw new Error('King seal identity differs');current();sealed=saved.sealed;
    },physicsRestored:()=>{if(current().isEnabled()!==sealed)throw new Error('Restored King seal activity differs');}};
}
