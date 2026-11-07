import * as v from 'valibot';
import {arenaSealCollider,type ArenaSealDimensions} from '../../../shared/game/boss/arenaCollision';
import type {NativeCollisionSolid} from '../population/nativeBake';

const finite=v.pipe(v.number(),v.finite());
const metadata=v.object({pieces:v.array(v.object({id:v.string(),colliders:finite,active:v.boolean(),
  follows:v.exactOptional(v.object({matrix:v.array(finite),rotation:v.boolean()}))})),
  solids:v.array(v.object({body:v.exactOptional(v.nullable(finite))}))});

/** Restore the retained seal owner's initial activity. Match its complete
 * source-derived box and pose, never a flattened index or a route location.
 * The arena view and this reader share the defining collider arithmetic. */
export function nativeArenaSealSolids(input:unknown,solids:readonly NativeCollisionSolid[],
  room:ArenaSealDimensions & {readonly sealId:string;readonly origin:{readonly x:number;readonly y:number;readonly z:number}}):readonly NativeCollisionSolid[] {
  const source=v.parse(metadata,input),pieces=source.pieces.filter(piece=>piece.id===room.sealId);
  const piece=pieces[0],{origin}=room;
  if(pieces.length!==1||piece===undefined||piece.colliders!==1||piece.follows?.rotation!==true)throw new Error('Missing native seal owner');
  const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,origin.x,origin.y,origin.z,1];
  if(piece.follows.matrix.length!==16||piece.follows.matrix.some((n,i)=>n!==matrix[i]))throw new Error('Native seal owner pose differs');
  if(source.solids.length!==solids.length)throw new Error('Native seal solid inventory differs');
  const box=arenaSealCollider(room),at=[origin.x+box.x,origin.y+box.y,origin.z+box.z].map(Math.fround),half=[box.hx,box.hy,box.hz].map(Math.fround);
  const matching=solids.map((solid,index)=>({solid,index})).filter(({solid,index})=>source.solids[index]?.body===2&&solid.shape===1
    &&solid.at.every((n,i)=>n===at[i])&&solid.rot.every((n,i)=>n===[0,0,0,1][i])&&solid.half?.every((n,i)=>n===half[i]));
  const match=matching[0];if(matching.length!==1||match===undefined)throw new Error('Native seal collider correspondence differs');
  return solids.map((solid,index)=>index===match.index?{...solid,enabled:piece.active}:solid);
}
