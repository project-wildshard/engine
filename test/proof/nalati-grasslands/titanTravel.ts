// oxlint-disable-next-line import/no-nodejs-modules -- The physical route must earn every arrival through native inputs.
import assert from 'node:assert/strict';
import type {SimHost} from '../../../src/server/engine/sim';
import {mountedPlayerOf} from '../../../src/server/game/riding/native';
import {PhysicsRouteCursor,type WalkPoint} from '../../../src/shared/host/headlessJourney';
import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import {SKY_ROAD} from '../../../src/shards/nalati-grasslands/generators/layout';
import {nalatiTitanOf} from '../../fixtures/nalati-titan-native';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

/** The real entry, borrowed horse and storm prefix. No wait advances a clock
 * directly; departure follows the admitted weather owner's remaining time. */
export async function reachTitanCairn(host:SimHost,step:(commands:readonly HeadlessCommand[])=>Promise<void>):Promise<void>{
  const mount=mountedPlayerOf(host),titan=nalatiTitanOf(host);assert.ok(mount);assert.ok(titan);
  while(titan.weather().state==='clear'&&titan.weather().left>90)await step([]);
  const route:WalkPoint[]=[{x:0,z:216},{x:20,z:216},{x:40,z:218},{x:60,z:214},{x:66,z:209.5},{x:73,z:206.1},{x:83,z:206},{x:84.8,z:203.8},{x:88,z:204.5},{x:95,z:204},
    {x:94,z:210},{x:91,z:216},{x:86.6,z:219.5},{x:91,z:216},{x:94,z:210},{x:94,z:208.5},
    {x:88,z:207},{x:83,z:206},{x:73,z:206.1},{x:72.4,z:212.9},{x:72,z:210},{x:68,z:210},{x:66,z:211.5},{x:66.8,z:213.4}];
  const cursor=new PhysicsRouteCursor(route,{once:true});
  for(let tick=0;tick<3600;tick++){
    const p=leadPlayer(host).position,command=cursor.command([p.x,p.y,p.z],tick);
    if(cursor.complete)break;assert.equal(cursor.stuck.length,0,'the camp route must remain a real walk');await step([command]);
  }
  assert.equal(cursor.complete,true);
  await step([{kind:'script',actorId:'nalati.companion.use',value:1}]);assert.equal(mount.mounted,true);
  const reins=(forward:number,turn:number,jump=false):HeadlessCommand=>({kind:'player',moveX:0,moveZ:0,yaw:leadPlayer(host).yaw,
    commandVersion:1,steer:{keyX:0,keyY:0,stickX:turn,stickY:forward},...(jump?{jump:true}:{})});
  for(let tick=0;tick<90;tick++)await step([reins(-1,0)]);
  const drive=async(x:number,z:number,radius=2.5):Promise<void>=>{
    for(let tick=0;tick<1800;tick++){
      const p=leadPlayer(host).position,dx=x-p.x,dz=z-p.z;if(Math.hypot(dx,dz)<radius)return;
      assert.equal(mount.mounted,true);
      const target=Math.atan2(dx,dz),delta=Math.atan2(Math.sin(mount.body.heading-target),Math.cos(mount.body.heading-target));
      const brake=Math.abs(delta)>.7&&Math.abs(mount.body.speed)>1.5;
      const forward=brake?-.3:Math.abs(delta)>.7?0:tick>120&&mount.body.speed<1?.3:1;
      await step([reins(forward,brake?0:Math.max(-1,Math.min(1,delta*2.5)),tick>120&&tick%60===0&&mount.body.speed<1)]);
    }
    throw new Error(`Physical Titan route stuck at ${x}, ${z}`);
  };
  for(const [x,z]of [[60,214],[40,218],[20,216],[0,216],[0,205],[0,200],[0,190],[0,183],[0,170],[0,158],[0,147],
    [1,146],[23,146],[27,142],[39,141],[53,139],[57,136],[57,134],[40,133],...SKY_ROAD.slice(4),
    [95,65],[65,55],[20,40],[-20,54],[-30,20],[-30,-10],[-30,-40]] as const)await drive(x,z);
  const at=titan.fight.cairnSpot();await drive(at.x,at.z,1.5);
  for(let tick=0;tick<180;tick++)await step([reins(-.3,0)]);
  for(let tick=0;tick<36_000&&!titan.storm();tick++)await step([]);
  assert.equal(titan.storm(),true,'only the natural storm permits the tie');
  assert.equal(mount.mounted,true);assert.equal(titan.fight.tied,false);assert.equal(titan.boss.state,'dormant');
}
