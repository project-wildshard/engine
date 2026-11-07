// oxlint-disable-next-line import/no-nodejs-modules -- The real native world uses the shipped physics module.
import {readFileSync} from 'node:fs';
import {expect,test,vi} from 'vitest';
import {loadRapier} from '../src/shared/engine/physics/rapier';
import {rideable} from '../src/shared/engine/physics/CharacterMotor';
import {groups} from '../src/shared/engine/physics/groups';
import {createShardfileSim} from '../src/server/game/plugin/simulation';
import {emptyShardfile} from '../src/shared/host/author';
import { leadCommands, leadPlayer } from '@wildshard/engine/sim/leadPlayer';

test.each([true,false])('native moving-body ride and jump (carry=%s)',async(carry)=>{
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const source=emptyShardfile({slug:'carry-proof',name:'Carry proof',author:'Test',revision:1,seed:12});
  const sim=createShardfileSim(source,new Map(),{rapier}),host=sim.host,{world,R}=host.physics;
  const body=world.createRigidBody(R.RigidBodyDesc.dynamic().setGravityScale(0).setTranslation(0,1,0));
  world.createCollider(R.ColliderDesc.cuboid(3,.5,3).setMass(1000).setCollisionGroups(groups('WORLD')),body);rideable(body);
  const move={moveX:0,moveZ:0,yaw:0};
  try{
    leadPlayer(host).position.set(0,2,0);leadPlayer(host).motor.resetAt(leadPlayer(host).position);
    for(let tick=0;tick<60;tick++)host.step(leadCommands(host, move));
    expect(leadPlayer(host).fall.grounded).toBe(true);
    const start=leadPlayer(host).position.clone(),bodyStart=body.translation();
    if(!carry)vi.spyOn(leadPlayer(host).motor,'carry').mockReturnValue(false);
    for(let tick=1;tick<=60;tick++){
      body.setLinvel({x:0,y:0,z:0},true);body.setTranslation({x:tick*.02,y:1+tick*.005,z:0},true);host.step(leadCommands(host, move));
    }
    if(carry){
      // Dynamic bodies respond to the rider's mass; compare actual body motion,
      // not the requested trajectory before that native contact was resolved.
      const end=body.translation();
      expect(Math.abs((leadPlayer(host).position.x-end.x)-(start.x-bodyStart.x))).toBeLessThan(leadPlayer(host).motor.opts.radius);
      expect(Math.abs((leadPlayer(host).position.y-end.y)-(start.y-bodyStart.y))).toBeLessThan(leadPlayer(host).motor.opts.snap);
      expect(leadPlayer(host).fall.grounded).toBe(true);
      const jumped=leadPlayer(host).position.y;host.step(leadCommands(host, {...move,jump:true}));
      expect(leadPlayer(host).position.y).toBeGreaterThan(jumped);expect(leadPlayer(host).fall.grounded).toBe(false);
    }else{
      expect(Math.abs(leadPlayer(host).position.x-start.x)).toBeLessThan(.1);
      expect(Math.abs(leadPlayer(host).position.y-start.y)).toBeLessThan(.1);
    }
  }finally{vi.restoreAllMocks();sim.dispose();}
});
