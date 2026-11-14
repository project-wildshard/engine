import { sceneLivingBytes } from '@wildshard/format/worldScenePages';
import {Euler,Matrix4,Quaternion,Vector3} from 'three';
import * as v from 'valibot';
import {KinematicMover} from '../../src/shared/engine/physics/mover';
import {ForestPageSchema} from '@wildshard/format/forestPage';
import {buildingDoor,toggleBuildingDoor,stepBuildingDoor,buildingDoorYaw,buildingDoorCollides} from '../../src/shared/game/shardfile/buildingDoor';
import {eyeReaches} from '../../src/shared/game/quest/interactionRows';
import type {PrepareHeadlessRuntime} from '../../src/server/host/headlessRuntime';
import {prepareFolderPlan} from './headless-native';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const finite=v.pipe(v.number(),v.finite());
const savedDoor=v.strictObject({id:v.string(),open:v.boolean(),t:v.pipe(finite,v.minValue(0),v.maxValue(1)),enabled:v.boolean(),handle:finite});
/** The shipping door state and physics primitive over the admitted cabin
 * topology. Fixed test commands can use a real nearby door, never set a pose. */
export const prepareHeadlessRuntime:PrepareHeadlessRuntime=async preparation=>{
  const base=await prepareFolderPlan(preparation),page=v.parse(ForestPageSchema,await preparation.product.json('world/forest-page.json'));
  const variant=page.buildings.variants.find(row=>row.tier==='phone'&&!row.shadow&&!row.shared);
  if(variant===undefined)throw new Error('Missing admitted phone cabins');
  const living=sceneLivingBytes(await preparation.product.file(variant.file),variant);
  const nodes=new Map(living.graph.nodes.map(row=>[row.id,row]));
  const worldMatrix=(id:string,seen=new Set<string>()):Matrix4=>{
    if(id===living.graph.root)return new Matrix4();
    const row=nodes.get(id);if(row===undefined||row.matrixBits===undefined||seen.has(id))throw new Error('Missing or cyclic cabin frame');
    seen.add(id);
    const local=new Matrix4().fromArray(new Float64Array(Uint32Array.from(row.matrixBits).buffer));
    return worldMatrix(row.parent,seen).multiply(local);
  };
  const frames=living.life.doors.map(row=>{
    const position=new Vector3(),rotation=new Quaternion(),scale=new Vector3();worldMatrix(row.pivot).decompose(position,rotation,scale);
    if(Math.max(Math.abs(scale.x-1),Math.abs(scale.y-1),Math.abs(scale.z-1))>1e-6)throw new Error('Native door requires unit rigid frame');
    return {row,position,rotation};
  });
  const look=page.buildings.life.door,collision=look.collision;
  if(collision===undefined)throw new Error('Door requires admitted collision law');
  return {...base,install:(host,context)=>{
    base.install(host,context);
    const doors=frames.map(frame=>({...frame,state:buildingDoor(frame.row.id),body:undefined as KinematicMover|undefined}));
    const handles=new Map<string,number>();
    const q=new Quaternion(),swing=new Quaternion(),euler=new Euler(0,0,0,'YXZ');
    const pose=(door:typeof doors[number])=>{
      q.copy(door.rotation).multiply(swing.setFromAxisAngle(new Vector3(0,1,0),buildingDoorYaw(door.state.t,look.angle)));
      euler.setFromQuaternion(q,'YXZ');
      return {position:door.position,euler:{x:euler.x,y:euler.y,z:euler.z},enabled:door.state.enabled};
    };
    const body=(door:typeof doors[number],handle?:number)=>{
      const slab=door.row.slab,rotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),slab.yaw??0);
      return new KinematicMover(host.physics,[{...slab,rot:rotation}],pose(door),door.row.id,false,handle);
    };
    if(!context.restoring)for(const door of doors)door.body=body(door);
    host.onStep('pine.doors',dt=>{
      for(const command of context.commands()){
        if(command.kind!=='script'||command.actorId!=='pine.door')continue;
        const door=doors[command.value];if(door===undefined)throw new Error('Unknown admitted Pine door');
        const [x,y,z]=door.row.at;
        if(eyeReaches(leadPlayer(host).position,{x,y,z,radius:door.row.reach}))toggleBuildingDoor(door.state);
      }
      for(const door of doors){
        stepBuildingDoor(door.state,dt,look.seconds);
        buildingDoorCollides(door.state,()=>door.position.distanceToSquared(leadPlayer(host).position)>collision.rearmRadius**2);
        if(door.body===undefined)throw new Error('Missing native door body');door.body.setPose(pose(door));
      }
    },{snapshot:()=>doors.map(door=>{
      if(door.body===undefined)throw new Error('Missing native door continuation');return {...door.state,handle:door.body.body.handle};
    }),restore:value=>{
      const saved=v.parse(v.array(savedDoor),value);
      if(saved.length!==doors.length||saved.some((row,i)=>row.id!==doors[i]?.row.id))throw new Error('Door continuation differs from admitted roster');
      for(const [i,door] of doors.entries()){
        const row=saved[i];if(row===undefined)throw new Error('Missing saved door');
        Object.assign(door.state,{open:row.open,t:row.t,enabled:row.enabled});handles.set(door.row.id,row.handle);
      }
    },physicsRestored:()=>{
      for(const door of doors){const handle=handles.get(door.row.id);if(handle===undefined)throw new Error('Missing restored door body');door.body=body(door,handle);}
    }});
    host.scope.onDispose(()=>{for(const door of doors)door.body?.dispose();});
  }};
};
