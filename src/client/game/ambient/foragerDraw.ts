import * as THREE from 'three';
import * as v from 'valibot';
import { ForagerPopulation } from '@wildshard/engine/ai/ambientForager';
import { terrainHeight } from '@wildshard/engine/world/terrainHeight';
import { painterlyMaterial } from '@wildshard/engine/world/painterly';
import { modelContext } from '@wildshard/engine/models/model';
import { TIER } from '@wildshard/engine/core/tier';
import { ForagerDrawSchema } from '@wildshard/format/ambientLife';
import { SpecimenBookSchema } from '@wildshard/format/specimenCatalogue';
import { WildlifePopulationSchema } from '@wildshard/format/wildlifePopulation';
import { createPackedSpecimens, prepareSpecimenCatalogue } from '../models/specimenCatalogue';
import type { ShardContext } from '../plugin/context';

/** Project the actual native population's due poses without advancing its clock.
 * Geometry/material are borrowed native resources; rows contain no query port. */
export class ForagerDraw {
  readonly mesh: THREE.InstancedMesh;
  private readonly rows;
  private readonly matrix=new THREE.Matrix4(); private readonly angles=new THREE.Euler(0,0,0,'YXZ');
  private readonly rotation=new THREE.Quaternion(); private readonly point=new THREE.Vector3(); private readonly size=new THREE.Vector3(1,1,1);
  constructor(private readonly owner:ForagerPopulation,geometry:THREE.BufferGeometry,material:THREE.Material,input:unknown){
    this.rows=v.parse(ForagerDrawSchema,input);
    if(!(owner instanceof ForagerPopulation)||Object.getPrototypeOf(owner)!==ForagerPopulation.prototype)throw new Error('Missing native forager owner');
    this.mesh=new THREE.InstancedMesh(geometry,material,Math.max(1,owner.rows.length));this.mesh.count=owner.rows.length;
    this.mesh.name=this.rows.name;this.mesh.castShadow=false;this.mesh.receiveShadow=true;this.mesh.frustumCulled=false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.write(false);
  }
  project():void{this.write(true);}
  private write(scheduled:boolean):void{
    this.owner.rows.forEach((row,index)=>{
      if(scheduled&&this.owner.due[index]!==1)return;
      this.angles.set(row.sit*this.rows.tilt,row.yaw,0);
      this.point.set(row.x,terrainHeight(row.x,row.z)+row.sink*this.rows.sink,row.z);
      this.mesh.setMatrixAt(index,this.matrix.compose(this.point,this.rotation.setFromEuler(this.angles),this.size));
    });
    this.mesh.instanceMatrix.needsUpdate=true;
  }
}
/** Prepare the existing packed geometry once. Construction later borrows the
 * wildlife owner's body clock; materials and instances retire with the page. */
export async function prepareForagerDraw(ctx:ShardContext,input:unknown):Promise<{create:(owner:ForagerPopulation)=>ForagerDraw}>{
  const row=v.parse(WildlifePopulationSchema,input).foragers?.view,world=ctx.game.runtime?.world;
  if(row===undefined||world===undefined||world===null)throw new Error('Missing native forager presentation');
  const book=v.parse(SpecimenBookSchema,await ctx.product.json(row.books[TIER]));
  if(book.packed===undefined)throw new Error('Forager specimen book is not packed');
  // a product-file pack is read through the product, inflated and checked like every other specimen pack
  const packed=createPackedSpecimens(book.packed,await prepareSpecimenCatalogue(ctx.product,[],ctx.scope,[book.packed]));
  await packed.load();
  const part=packed.parts(row.model,modelContext(world.sky),book.materials)?.[0];
  if(part===undefined)throw new Error('Missing prepared forager geometry');
  ctx.scope.onDispose(()=>{part.geometry.dispose();});
  return {create:owner=>{
    const material=painterlyMaterial(world.sky,{rim:row.rim,bands:row.bands}),view=new ForagerDraw(owner,part.geometry,material,row);
    ctx.scope.onDispose(()=>{view.mesh.removeFromParent();view.mesh.dispose();material.dispose();});return view;
  }};
}
