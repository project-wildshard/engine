import {installBounds} from '../../../src/client/engine/world/bounds';
import {floorBelow} from '../../../src/shared/engine/physics/query';
import type {Bounds} from '../../../src/shared/engine/level/spec';
import type {SimHost} from '../../../src/server/engine/sim';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const declared=new WeakMap<SimHost,Bounds>();
const installed=new WeakSet<SimHost>();
/** Retain authored bounds without adding work to ordinary native replay. */
export function registerNativeWalkBounds(host:SimHost,bounds:Bounds|undefined):void {
  if(bounds!==undefined)declared.set(host,bounds);
}
/** Activate the page's unchanged bounds owner only for native walk proofs. */
export function installNativeWalkBounds(host:SimHost):void {
  const bounds=declared.get(host);if(bounds===undefined||installed.has(host))return;
  installed.add(host);
  const spawn=(x:number,z:number,yaw:number,y:number):void=>{leadPlayer(host).resetPose({x,y,z},yaw);};
  installBounds({addSystem:(spec,scope)=>{
    scope.onDispose(host.onStep(spec.id,dt=>{spec.run(dt,host.clock.now);},undefined,'afterBodies'));
  }},host.scope,bounds,{
    player:{position:leadPlayer(host).position,get yaw(){return leadPlayer(host).yaw;},
      get onGround(){return leadPlayer(host).fall.grounded;},get hover(){return leadPlayer(host).board.on;},spawn},
    suspended:()=>false,
    floorAt:(x,z)=>floorBelow(host.physics,x,z,leadPlayer(host).position.y+0.6,1.2,leadPlayer(host).motor.collider),
    toSpawn:()=>{const {at,yaw}=host.level.player;spawn(at.x,at.z,yaw,at.y);},
  });
}
