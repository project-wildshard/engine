import * as THREE from 'three';
import * as v from 'valibot';
import { FlockBrain } from '@wildshard/engine/ai/flock';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import { TIER } from '@wildshard/engine/core/tier';
import { PATCH_ORDER, patchShader } from '@wildshard/engine/render/shaderPatches';
import { attachFogUniforms } from '@wildshard/engine/world/Atmosphere';
import { CrowdPresentationSchema } from '@wildshard/format/crowdPresentation';
import { CrowdTargets } from '../../../shared/game/shardfile/crowdRuntime';

export interface CrowdBody { readonly geometry: THREE.BufferGeometry; readonly pivots: readonly (readonly [number,number,number])[]; readonly parts: readonly string[] }
interface CrowdRig { readonly geometry: THREE.BufferGeometry; readonly map: THREE.Texture | null; readonly joints: readonly { readonly name: string }[] }
const scalar = (value: number): string => Number.isInteger(value) ? `${value}.0` : String(value);
const vector = (value: readonly number[]): string => `vec3(${value.map(scalar).join(',')})`;
/** Client-only instanced projection of a concrete flock owner. Rows describe
 * joint gait, bob, death roll, tint and bounds; no author shader or hook enters.
 * Source geometry/materials are borrowed; the wrapper owns its instance buffer. */
export class CrowdDraw extends CrowdTargets {
  readonly mesh: THREE.InstancedMesh;
  dog: Animal | null = null;
  private readonly row;
  private readonly time = { value: 0 };
  private readonly motion: THREE.InstancedBufferAttribute;
  private readonly matrix = new THREE.Matrix4(); private readonly rotation = new THREE.Quaternion();
  private readonly point = new THREE.Vector3(); private readonly size = new THREE.Vector3();
  private readonly pose = { x: 0,y: 0,z: 0,yaw: 0,speed: 0,phase: 0,graze: 0,dead: false,deathTime: 0,scale: 1,wool: 0 };
  constructor(controller: FlockBrain,private readonly body: CrowdBody,private readonly material: THREE.MeshLambertMaterial,input: unknown) {
    const row = v.parse(CrowdPresentationSchema,input);
    super(controller,row);this.row=row;
    if (!(controller instanceof FlockBrain) || body.parts.length!==row.motion.joints.length || body.pivots.length!==body.parts.length) throw new Error('Invalid crowd owner or joints');
    this.motion=new THREE.InstancedBufferAttribute(new Float32Array(this.n*4),4);this.motion.setUsage(THREE.DynamicDrawUsage);
    const geometry=new THREE.InstancedBufferGeometry();for(const [key,attribute]of Object.entries(body.geometry.attributes))geometry.setAttribute(key,attribute);
    geometry.setIndex(body.geometry.getIndex());geometry.setAttribute(row.attributes[0],this.motion);
    this.mesh=new THREE.InstancedMesh(geometry,material,this.n);this.mesh.name=row.name;this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.patch(material,false);const depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});this.patch(depth,true);this.mesh.customDepthMaterial=depth;
    this.mesh.castShadow=TIER!=='phone';this.mesh.receiveShadow=true;this.mesh.frustumCulled=true;
    const colors=row.wool.map(rgb=>new THREE.Color(...rgb));for(let i=0;i<this.n;i++)this.mesh.setColorAt(i,colors[controller.readPose(i,this.pose).wool]??new THREE.Color(1,1,1));
    if(this.mesh.instanceColor!==null)this.mesh.instanceColor.needsUpdate=true;
    this.mesh.boundingSphere=new THREE.Sphere(new THREE.Vector3(this.cx,controller.readPose(0,this.pose).y,this.cz),row.cullRadius);this.write();
  }
  /** Paused projection keeps both shader time and instance uploads unchanged. */
  project(time?: number): void { if(time!==undefined){this.time.value=time;this.write();} }
  /** Adopt immutable rig arrays, preserving the one live instance channel. */
  useRig(rig: CrowdRig): void {
    if(rig.joints.length!==this.body.parts.length||rig.joints.some((joint,i)=>joint.name!==this.body.parts[i]))throw new Error('Crowd rig joint mismatch');
    const source=rig.geometry,indices=source.getAttribute('skinIndex'),weights=source.getAttribute('skinWeight'),packed=new Float32Array(indices.count*3);
    for(let i=0;i<indices.count;i++){
      let a=0,wa=-1,b=0,wb=-1;for(let c=0;c<4;c++){const w=weights.getComponent(i,c),k=indices.getComponent(i,c);if(w>wa){b=a;wb=wa;a=k;wa=w;}else if(w>wb){b=k;wb=w;}}
      const total=wa+Math.max(0,wb);packed[i*3]=a;packed[i*3+1]=wb>0?b:a;packed[i*3+2]=total>0&&wb>0?wb/total:0;
    }
    const geometry=new THREE.BufferGeometry();for(const key of ['position','normal','uv','color']as const)geometry.setAttribute(key,source.getAttribute(key));
    geometry.setAttribute('aRig',new THREE.BufferAttribute(packed,3));geometry.setAttribute(this.row.attributes[0],this.motion);geometry.setIndex(source.getIndex());geometry.computeBoundingSphere();
    const old=this.mesh.geometry;this.mesh.geometry=geometry;old.dispose();this.material.map=rig.map;this.material.needsUpdate=true;
  }
  private write(): void {
    for(let i=0;i<this.n;i++){
      const pose=this.controller.readPose(i,this.pose),t=pose.dead?pose.deathTime:0,death=t*t*(3-2*t);
      this.rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP,pose.yaw);this.matrix.compose(this.point.set(pose.x,pose.y+this.row.feetY,pose.z),this.rotation,this.size.setScalar(pose.scale));
      this.mesh.setMatrixAt(i,this.matrix);this.motion.setXYZW(i,pose.phase,pose.speed,pose.graze,death);
    }
    this.mesh.instanceMatrix.needsUpdate=true;this.motion.needsUpdate=true;
  }
  private patch(material: THREE.Material,depth: boolean): void {
    const row=this.row,m=row.motion,f=scalar,pivots=this.body.pivots.map(vector).join(','),angles=m.joints.map((j,i)=>`if(b<${f(i+.5)})return an.z*(${f(j[0])}+${f(j[1])}*sin(uCrowdTime*${f(j[2])}+seed*${f(j[3])}))+walk*${f(j[4])}*sin((an.x+${f(j[5])})*${f(j[6])});`).join('\n');
    patchShader(material,`${row.name}${depth?'.depth':''}`,PATCH_ORDER.decorate,shader=>{
      attachFogUniforms(shader);shader.uniforms['uCrowdTime']=this.time;
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
attribute vec3 aRig;attribute vec4 ${row.attributes[0]};uniform float uCrowdTime;
const vec3 CROWD_PIV[${String(m.joints.length)}]=vec3[${String(m.joints.length)}](${pivots});
float crowdAngle(float b,vec4 an,float seed){float walk=min(an.y*${f(m.walk[0])},${f(m.walk[1])});${angles}return 0.0;}
vec3 crowdRot(vec3 q,float a){float c=cos(a),s=sin(a);return vec3(q.x,q.y*c-q.z*s,q.y*s+q.z*c);}
vec3 crowdDeath(vec3 q){float d=${row.attributes[0]}.w*${f(m.deathAngle)};return vec3(q.x*cos(d)-q.y*sin(d),q.x*sin(d)+q.y*cos(d),q.z);}
vec3 crowdPos(vec3 p){float seed=float(gl_InstanceID);vec4 an=${row.attributes[0]};
vec3 p0=CROWD_PIV[int(aRig.x)]+crowdRot(p-CROWD_PIV[int(aRig.x)],crowdAngle(aRig.x,an,seed));
vec3 p1=CROWD_PIV[int(aRig.y)]+crowdRot(p-CROWD_PIV[int(aRig.y)],crowdAngle(aRig.y,an,seed));vec3 r=mix(p0,p1,aRig.z);
r.y+=an.y>${f(m.movingAt)}?${f(m.movingBob[0])}*min(an.y,${f(m.movingBob[1])})*abs(sin(an.x*${f(m.movingBob[2])})):${f(m.idleBob[0])}*sin(uCrowdTime*${f(m.idleBob[1])}+seed);
return ${vector(m.deathPivot)}+crowdDeath(r-${vector(m.deathPivot)});}
vec3 crowdNrm(vec3 n){float seed=float(gl_InstanceID);vec4 an=${row.attributes[0]};return crowdDeath(normalize(mix(crowdRot(n,crowdAngle(aRig.x,an,seed)),crowdRot(n,crowdAngle(aRig.y,an,seed)),aRig.z)));}
`).replace('#include <begin_vertex>','vec3 transformed=crowdPos(vec3(position));');
      if(!depth){shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>','vec3 objectNormal=crowdNrm(vec3(normal));');shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#if defined(USE_COLOR)||defined(USE_INSTANCING_COLOR)
float crowdL=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));diffuseColor.rgb*=mix(vec3(1.0),vColor.rgb,smoothstep(${f(m.tint[0])},${f(m.tint[1])},crowdL));
#endif`);}
    },{key:key=>`${key}|${row.name}${depth?'-depth':''}|${JSON.stringify([m,this.body.pivots,row.attributes])}`});
  }
}
