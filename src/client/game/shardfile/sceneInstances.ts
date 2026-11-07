import * as THREE from 'three';
import type { SceneInstancesRows } from '@wildshard/format/sceneInstances';
import { createClientChannels, type ClientChannelFrame } from '../../../shared/game/plugin/channels';
import { Rng } from '@wildshard/engine/core/rng';
import { terrainHeight } from '@wildshard/engine/world/terrainHeight';
import { setLentParam } from './lentLooks';
import { gpuOnlyAttributes } from '@wildshard/engine/core/gpuOnly';

/** Client-only repeated pose rows over the existing numeric DAG. Observations never enter game actors or physics. */
export class SceneInstanceFields {
  private readonly fields;
  private time=0;
  constructor(rows:SceneInstancesRows,geometry:ReadonlyMap<string,THREE.BufferGeometry>,materials:ReadonlyMap<string,THREE.Material>,roots:ReadonlyMap<string,THREE.Object3D>){
    const randoms=new Map<string,Rng>();
    this.fields=rows.map(row=>{
      const shape=geometry.get(row.geometry)?.clone(),material=materials.get(row.material),root=roots.get(row.group);
      if(shape===undefined||material===undefined||root===undefined)throw new Error('Missing instanced scene resource');
      for(const attr of row.attributes){if(attr.values.length!==row.states.length*attr.width)throw new Error('Instance attribute count differs');shape.setAttribute(attr.name,new THREE.InstancedBufferAttribute(Float32Array.from(attr.values),attr.width));}
      const mesh=new THREE.InstancedMesh(shape,material,Math.max(1,row.states.length));mesh.name=row.name??row.id;mesh.count=0;mesh.castShadow=row.castShadow;mesh.receiveShadow=row.receiveShadow;
      // This render-only clone is never cloned or deformed again. Picking keeps
      // positions/index; changing instance matrices/colours belong to the mesh.
      gpuOnlyAttributes(shape,'scene.instances');
      const [x,y,z,r]=row.bounds;mesh.boundingSphere=new THREE.Sphere(new THREE.Vector3(x,y+(row.groundBounds?terrainHeight(x,z):0),z),r);root.add(mesh);
      let random:Rng|undefined;
      if(row.random!==undefined){random=randoms.get(row.random.id);if(random===undefined){random=new Rng(row.random.state.initial);random.restore(row.random.state);randoms.set(row.random.id,random);}}
      const programs=row.programs.map(step=>{if(step.inputs.length!==step.row.reads.length||step.row.locals!==undefined)throw new Error('Instance program requires detached input rows without shared recurrence');
        return{row:step,lane:createClientChannels(step.row),values:step.inputs.map(()=>0)};});
      return{row,mesh,random,programs,states:row.states.map(state=>[...state]),credit:row.initialCredit,matrix:new THREE.Matrix4(),position:new THREE.Vector3(),rotation:new THREE.Euler(0,0,0,'YXZ'),orientation:new THREE.Quaternion(),scale:new THREE.Vector3(),colour:new THREE.Color()};
    });
  }
  update(dt:number,viewer:THREE.Vector3,worldTime:number):void{
    this.time+=dt;
    for(const field of this.fields){
      const {row,mesh}=field;field.credit+=dt;if(field.credit<row.step)continue;
      const delta=field.credit;field.credit=0;
      if(row.far!==null&&Math.hypot(row.bounds[0]-viewer.x,row.bounds[2]-viewer.z)>row.far){mesh.visible=false;continue;}mesh.visible=true;
      const time=row.clock==='world'?worldTime:this.time;
      if(row.uniform!==undefined)setLentParam(row.uniform.look,row.uniform.param,time);
      let count=0;
      for(const state of field.states){
        let frame:ClientChannelFrame={};
        for(const program of field.programs){
          program.row.inputs.forEach((input,i)=>{
            let value:number;
            if(input.kind==='state'){const found=state[input.slot];if(found===undefined)throw new Error('Instance state slot is absent');value=found;}
            else if(input.kind==='constant')value=input.value;
            else if(input.kind==='random'){if(field.random===undefined)throw new Error('Instance random stream is absent');value=field.random.next();}
            else if(input.kind==='frame'){const found=frame[input.property];if(found===undefined)throw new Error('Instance frame channel is absent');value=found;}
            else{const x=frame.x,z=frame.z;if(x===undefined||z===undefined)throw new Error('Instance blocking needs a proposed pose');value=Number(row.blocked.some(circle=>Math.hypot(x-circle.x,z-circle.z)<circle.r));}
            program.values[i]=value;
          });
          program.lane.evaluate({time,delta,values:program.values});frame=program.lane.frame;
          for(const output of program.row.outputs){const value=frame[output.property];if(value===undefined)throw new Error('Missing instance output channel');state[output.slot]=value;}
        }
        const value=(index:number|undefined,fallback:number):number=>{if(index===undefined)return fallback;const found=state[index];if(found===undefined)throw new Error('Missing instance pose slot');return found;};
        const x=value(row.pose.x,0),z=value(row.pose.z,0);
        if(row.near>0&&Math.hypot(x-viewer.x,z-viewer.z)<row.near)continue;
        const y=terrainHeight(x,z)+value(row.pose.y,0)+row.ground,s=value(row.pose.scale,1);
        mesh.setMatrixAt(count,field.matrix.compose(field.position.set(x,y,z),field.orientation.setFromEuler(field.rotation.set(value(row.pose.pitch,0),value(row.pose.yaw,0),value(row.pose.roll,0),'YXZ')),field.scale.setScalar(s)));
        if(row.pose.colour!==undefined){const colour=row.palette[value(row.pose.colour,0)];if(colour===undefined)throw new Error('Missing instance palette colour');mesh.setColorAt(count,field.colour.setRGB(...colour));}
        count++;
      }
      mesh.count=count;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor!==null)mesh.instanceColor.needsUpdate=true;
    }
  }
  dispose():void{for(const {mesh}of this.fields){mesh.removeFromParent();mesh.geometry.dispose();}}
}
