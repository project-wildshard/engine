import * as THREE from 'three';
import { AmbientGroup } from '../../../shared/game/ambient/flock';
import { terrainHeight } from '@wildshard/engine/world/terrainHeight';
import { parseAmbientFlock } from '@wildshard/format/ambientLife';

const transform=new THREE.Matrix4(),wing=new THREE.Matrix4(),mirror=new THREE.Matrix4().makeScale(-1,1,1),composed=new THREE.Matrix4(),angles=new THREE.Euler(),rotation=new THREE.Quaternion(),point=new THREE.Vector3(),scale=new THREE.Vector3();

interface Layer { readonly id: string; readonly capacity: number; readonly palette: readonly (number | string)[]; readonly flap: readonly [number,number,number] | null }
export interface WingFieldRows { readonly layers: readonly Layer[]; readonly groups: readonly { readonly kind: string; readonly row: unknown; readonly perches: unknown }[] }
/** Client-only paired-wing projection of the existing renderer-free ambient host. Flight is evaluated at 10 Hz; draw poses interpolate. */
export class AmbientWingField {
  readonly group: THREE.Group = new THREE.Group();
  private readonly flocks;
  private readonly layers;
  private time = 0;
  private credit = 0;
  constructor(rows: WingFieldRows, geometry: ReadonlyMap<string,THREE.BufferGeometry>, materials: ReadonlyMap<string,THREE.Material>) {
    this.layers = rows.layers.map(row => { const shape = geometry.get(row.id), material = materials.get(row.id); if(shape===undefined || material===undefined) throw new Error('Missing wing field resource');
      if(!Number.isSafeInteger(row.capacity)||row.capacity<1||row.capacity>4096) throw new Error('Invalid wing field capacity');
      const mesh = new THREE.InstancedMesh(shape,material,row.capacity*2); mesh.name=row.id;mesh.count=0;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;this.group.add(mesh);
      return { row, mesh, palette: row.palette.map(value=>new THREE.Color(value)), count:0 }; });
    this.flocks = rows.groups.map(spec => {
      const layer = this.layers.find(candidate=>candidate.row.id===spec.kind);if(layer===undefined)throw new Error('Missing wing layer');
      const row = parseAmbientFlock(spec.row);
      const wheel = row.wheeling, ground = wheel === null ? 0 : terrainHeight(wheel.centre.x,wheel.centre.z);
      const flock = new AmbientGroup(wheel===null?row:{...row,wheeling:{...wheel,altitude:wheel.altitude.map(value=>value+ground)}},spec.perches);
      return { layer, flock, previous:flock.birds.map(({x,y,z,yaw,pitch,roll,flap})=>({x,y,z,yaw,pitch,roll,flap})) };
    });
  }
  update(dt:number,player:THREE.Vector3):void {
    this.time+=dt;this.credit+=dt;
    if(this.credit>=.1){const step=Math.floor(this.credit/.1)*.1;this.credit-=step;for(const entry of this.flocks){entry.previous=entry.flock.birds.map(({x,y,z,yaw,pitch,roll,flap})=>({x,y,z,yaw,pitch,roll,flap}));entry.flock.update(step,player);}}
    const alpha=Math.min(1,this.credit/.1),time=this.time;
    for(const layer of this.layers)layer.count=0;
    for(const entry of this.flocks)for(const [i,bird]of entry.flock.birds.entries()){
      if(bird.state===0)continue;const before=entry.previous[i]??bird,mix=(a:number,b:number):number=>a+(b-a)*alpha;
      angles.set(-mix(before.pitch,bird.pitch),before.yaw+Math.atan2(Math.sin(bird.yaw-before.yaw),Math.cos(bird.yaw-before.yaw))*alpha+Math.PI,mix(before.roll,bird.roll),'YXZ');
      transform.compose(point.set(mix(before.x,bird.x),mix(before.y,bird.y),mix(before.z,bird.z)),rotation.setFromEuler(angles),scale.setScalar(entry.flock.row.scale*bird.scale));
      const layer=entry.layer,n=layer.count,flap=layer.row.flap===null?mix(before.flap,bird.flap):Math.sin(time*layer.row.flap[0]+bird.phase)*layer.row.flap[1]+layer.row.flap[2];
      if(n+1>=layer.mesh.instanceMatrix.count)continue;
      layer.mesh.setMatrixAt(n,composed.multiplyMatrices(transform,wing.makeRotationZ(flap)));layer.mesh.setMatrixAt(n+1,composed.multiplyMatrices(transform,wing.makeRotationZ(-flap).premultiply(mirror)));
      if(layer.palette.length>0){const color=layer.palette[(n/2)%layer.palette.length]??new THREE.Color();layer.mesh.setColorAt(n,color);layer.mesh.setColorAt(n+1,color);}layer.count+=2;
    }
    for(const {mesh,count}of this.layers){mesh.count=count;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor!==null)mesh.instanceColor.needsUpdate=true;}
  }
}
