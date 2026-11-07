// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the native bounds owner with the shipped physics module.
import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {loadRapier} from '../src/shared/engine/physics/rapier';
import {floorBelow} from '../src/shared/engine/physics/query';
import {createShardfileSim} from '../src/server/game/plugin/simulation';
import {emptyShardfile} from '../src/shared/host/author';
import {installNativeWalkBounds,registerNativeWalkBounds} from './fixtures/headless/nativeBounds';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

test('walk bounds activation is explicit and installs one owner per resident',async()=>{
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim=createShardfileSim(emptyShardfile({slug:'bounds-proof',name:'Bounds proof',author:'Test',revision:1,seed:1}),new Map(),{rapier});
  try{
    const {host}=sim;
    registerNativeWalkBounds(host,{x0:-20,x1:20,z0:-20,z1:20,floor:-3});
    expect(host.hasStep('engine.world.bounds')).toBe(false);
    installNativeWalkBounds(host);
    expect(host.hasStep('engine.world.bounds')).toBe(true);
    expect(()=>installNativeWalkBounds(host)).not.toThrow();
  }finally{sim.dispose();}
});

test('ordered walk legs retain the actual grounded floor for fall recovery',async()=>{
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim=createShardfileSim(emptyShardfile({slug:'safe-floor-proof',name:'Safe floor proof',author:'Test',revision:1,seed:1}),new Map(),{rapier});
  try{
    const {host}=sim;
    registerNativeWalkBounds(host,{x0:-20,x1:20,z0:-20,z1:20,floor:-3});installNativeWalkBounds(host);
    leadPlayer(host).resetPose({x:4,y:1,z:3},0);
    for(let tick=0;tick<120;tick++)host.step();
    expect(leadPlayer(host).fall.grounded).toBe(true);
    const stood=leadPlayer(host).position.clone(),floor=floorBelow(host.physics,stood.x,stood.z,stood.y+0.6,1.2,leadPlayer(host).motor.collider);
    expect(floor).toBeDefined();
    leadPlayer(host).resetPose({x:4,y:-4,z:3},0);host.step();
    // J112: a resting body steps every tick and settles by microns, so the 0.2 s checkpoint sits just behind the last stand.
    expect(leadPlayer(host).position.x).toBeCloseTo(stood.x,4);expect(leadPlayer(host).position.z).toBeCloseTo(stood.z,4);
    expect(leadPlayer(host).position.y).toBeCloseTo(floor??Number.NaN,4);
  }finally{sim.dispose();}
});
