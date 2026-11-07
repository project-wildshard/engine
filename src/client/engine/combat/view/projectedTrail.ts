import { BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Mesh, Vector3, type Camera, type Object3D } from 'three';
import { parse } from 'valibot';
import { ProjectedTrailSchema, type ProjectedTrailRows } from '@wildshard/format/clientTrails';
import { FX, fxMaterial, type FxMaterial } from '../../fx/groundFx';

/** G600 L7b: a camera-facing prediction ribbon over the caller's points (an aimed throw's arc): topology, widths, colour,
 * order and fade are rows; the caller lends the scene and camera. Client-only. */
export class ProjectedTrail {
  readonly points:Float32Array;
  readonly mesh:Mesh<BufferGeometry,FxMaterial>;
  private readonly rows:ProjectedTrailRows;
  private readonly positions:Float32Array;
  private readonly attribute:BufferAttribute;
  private remaining=0;
  private readonly eye=new Vector3();private readonly tangent=new Vector3();private readonly side=new Vector3();
  private readonly camera:Camera;
  constructor(scene:Object3D,camera:Camera,input:unknown){
    this.camera=camera;
    const rows=parse(ProjectedTrailSchema,input);this.rows=rows;this.points=new Float32Array(rows.points*3);
    this.positions=new Float32Array(rows.points*6);this.attribute=new BufferAttribute(this.positions,3);this.attribute.setUsage(DynamicDrawUsage);
    const geometry=new BufferGeometry(),uv=new Float32Array(rows.points*4),indices:number[]=[];
    for(let i=0;i<rows.points;i++){uv.set([i/(rows.points-1),0,i/(rows.points-1),1],i*4);if(i<rows.points-1){const k=i*2;indices.push(k,k+1,k+2,k+1,k+3,k+2);}}
    geometry.setAttribute('position',this.attribute);geometry.setAttribute('normal',new BufferAttribute(new Float32Array(rows.points*6),3));geometry.setAttribute('uv',new BufferAttribute(uv,2));geometry.setIndex(indices);
    this.mesh=new Mesh(geometry,fxMaterial(FX.streak,new Color(...rows.color),0));this.mesh.frustumCulled=false;this.mesh.visible=false;this.mesh.renderOrder=rows.order;scene.add(this.mesh);
  }
  show(count:number):void{
    const {rows,points,positions,tangent,side}=this;if(!Number.isInteger(count)||count<0||count>rows.points)throw new Error('Invalid prediction length');if(count<2)return;
    this.eye.setFromMatrixPosition(this.camera.matrixWorld);
    for(let i=0;i<rows.points;i++){
      const j=Math.min(i,count-1),k=Math.min(j+1,count-1),h=Math.max(0,j-1),x=points[j*3]??0,y=points[j*3+1]??0,z=points[j*3+2]??0;
      tangent.set((points[k*3]??x)-(points[h*3]??x),(points[k*3+1]??y)-(points[h*3+1]??y),(points[k*3+2]??z)-(points[h*3+2]??z));side.set(x-this.eye.x,y-this.eye.y,z-this.eye.z);
      tangent.cross(side).normalize().multiplyScalar(rows.width[0]+rows.width[1]*(j/Math.max(1,count-1)));
      positions.set([x-tangent.x,y-tangent.y,z-tangent.z,x+tangent.x,y+tangent.y,z+tangent.z],i*6);
    }
    this.attribute.needsUpdate=true;this.remaining=rows.lifetime;this.mesh.visible=true;
  }
  advance(dt:number):void{
    if(this.remaining<=0)return;this.remaining-=dt;this.mesh.material.uniforms.uAlpha.value=Math.max(0,this.remaining/this.rows.lifetime)**this.rows.fade;
    if(this.remaining<=0)this.mesh.visible=false;
  }
  dispose():void{this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
