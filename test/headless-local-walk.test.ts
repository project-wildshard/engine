// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the shipped native motor.
import {readFileSync} from 'node:fs';
import {beforeAll,expect,test} from 'vitest';
import {createSimHost,type SimCommand,type SimHost} from '../src/server/engine/sim';
import {loadRapier,type Rapier} from '../src/shared/engine/physics/rapier';
import { decodeSimSnapshot, leadSnapshot, serializeSimSnapshot, snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import {localWalkingMove,walkVelocity} from '../src/shared/engine/player/walk';
import {SIM_LEVEL} from './fixtures/sim-level/level';
import { leadCommands, leadPlayer } from '@wildshard/engine/sim/leadPlayer';

let rapier:Rapier;
beforeAll(async()=>{rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));});
const level={...SIM_LEVEL,entities:[],quests:[]};
function flat():SimHost {const host=createSimHost(level,{rapier});for(let tick=0;tick<60;tick++)host.step();return host;}
const forward:SimCommand={commandVersion:1,moveX:0,moveZ:0,yaw:-Math.PI/2,steer:{keyX:0,keyY:1,stickX:0,stickY:0}};

test('native projectile readers share the installed live water without advancing the host',()=>{
  const host=flat();let waterLevel=2;
  try{
    expect(host.waterSurfaceAt(3,4)).toBeNull();
    host.useWater({surfaceAt:(x,z)=>x<0?null:waterLevel+x+z});
    const before=snapshotSimHost(host);
    expect(host.waterSurfaceAt(-1,4)).toBeNull();expect(host.waterSurfaceAt(3,4)).toBe(9);
    waterLevel=5;expect(host.waterSurfaceAt(3,4)).toBe(12);
    expect(snapshotSimHost(host)).toEqual(before);
  }finally{host.dispose();}
});

test('raw keyboard and stick axes preserve the page clamp, turn and partial strength',()=>{
  const out={x:0,z:0};
  for(const yaw of [0,.7,-Math.PI/2])for(const steer of [
    {keyX:0,keyY:0,stickX:.2,stickY:.3},
    {keyX:1,keyY:1,stickX:.5,stickY:0},
    {keyX:-1,keyY:0,stickX:1,stickY:-.4},
  ]){
    const x=Math.max(-1,Math.min(1,steer.keyX+steer.stickX)),y=Math.max(-1,Math.min(1,steer.keyY+steer.stickY));
    let mx=-Math.sin(yaw)*y+Math.cos(yaw)*x,mz=-Math.cos(yaw)*y-Math.sin(yaw)*x;
    const length=Math.hypot(mx,mz);if(length>1){mx/=length;mz/=length;}
    localWalkingMove(steer,yaw,out);expect(Object.is(out.x,mx)).toBe(true);expect(Object.is(out.z,mz)).toBe(true);
  }
});

test('versioned native walking consumes sprint, crouch and raw direction through its motor',()=>{
  const host=flat();
  try{
    const start=leadPlayer(host).position.x;
    host.step(leadCommands(host, {...forward,sprint:true}));
    expect(leadPlayer(host).velocity.x).toBe(walkVelocity(0,7.2,14,1/60));
    expect(leadPlayer(host).position.x).toBeGreaterThan(start);
    const running=leadPlayer(host).velocity.x;
    host.step(leadCommands(host, {...forward,sprint:true,crouch:true}));
    expect(leadPlayer(host).velocity.x).toBe(walkVelocity(running,2.2,14,1/60));
    const crouched=leadPlayer(host).velocity.x;
    host.step(leadCommands(host, {...forward,sprint:true,steer:{keyX:0,keyY:-1,stickX:0,stickY:0}}));
    expect(leadPlayer(host).velocity.x).toBe(walkVelocity(crouched,-4.3,14,1/60));
    const back=leadPlayer(host).velocity.x;
    host.step(leadCommands(host, {...forward,steer:{keyX:0,keyY:0,stickX:0,stickY:.25}}));
    expect(leadPlayer(host).velocity.x).toBe(walkVelocity(back,4.3*.25,14,1/60));
  }finally{host.dispose();}
});

test('release and a serialized mid-stride continuation keep the same native motion',()=>{
  const host=flat();let restored:SimHost|undefined;
  try{
    for(let tick=0;tick<30;tick++)host.step(leadCommands(host, {...forward,sprint:true}));
    const saved=decodeSimSnapshot(serializeSimSnapshot(snapshotSimHost(host)));
    restored=restoreSimHost(level,{rapier},saved);
    const prior=leadPlayer(host).velocity.x;host.step();restored.step();
    expect(leadPlayer(host).velocity.x).toBeLessThan(prior);expect(leadPlayer(host).velocity.x).toBeGreaterThan(0);
    for(let tick=0;tick<30;tick++){
      const command=tick<10?{...forward,crouch:true}:tick<20?{...forward,yaw:0}:undefined;
      host.step(leadCommands(host, command));restored.step(leadCommands(restored, command));
      expect(leadPlayer(restored).position.toArray()).toEqual(leadPlayer(host).position.toArray());
      expect(leadPlayer(restored).velocity.toArray()).toEqual(leadPlayer(host).velocity.toArray());
      expect(leadPlayer(restored).fall).toEqual(leadPlayer(host).fall);
    }
  }finally{restored?.dispose();host.dispose();}
});

test('native delegated motion keeps first authority and malformed input changes no state',()=>{
  const host=flat();
  try{
    let commands=0;
    leadPlayer(host).useDriver({input:command=>{expect(command?.steer).toEqual(forward.steer);commands++;return true;},step:()=>undefined});
    host.step(leadCommands(host, forward));expect(commands).toBe(1);
    const before=snapshotSimHost(host);
    expect(()=>host.step(leadCommands(host, {...forward,steer:{keyX:0,keyY:Infinity,stickX:0,stickY:0}}))).toThrow('Invalid raw movement axes');
    expect(snapshotSimHost(host)).toEqual(before);
    const invalid={...before,players:[{...leadSnapshot(before),velocity:[Number.NaN,0,0]}]};
    expect(()=>restoreSimHost(level,{rapier},invalid)).toThrow('Snapshot instance registrations');
  }finally{host.dispose();}
});
