// oxlint-disable-next-line import/no-nodejs-modules -- Exercise owner activity against the shipped Rapier module.
import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {arenaSealCollider} from '../src/shared/game/boss/arenaCollision';
import {installNativeCollision,type NativeCollisionSolid} from '@wildshard/engine/game/population/nativeBake';
import {loadRapier} from '../src/shared/engine/physics/rapier';
import {createShardfileSim} from '../src/server/game/plugin/simulation';
import {emptyShardfile} from '../src/shared/host/author';
import {nativeArenaSealSolids} from '@wildshard/engine/game/boss/nativeArenaSeal';

const room={origin:{x:10,y:0,z:5},sealId:'test-seal',doorHeight:3,halfWidth:4,doorHalfWidth:1};
const desc=arenaSealCollider(room);
const solid:NativeCollisionSolid={shape:1,groups:131071,friction:0.5,
  at:[Math.fround(room.origin.x+desc.x),Math.fround(room.origin.y+desc.y),Math.fround(room.origin.z+desc.z)],
  rot:[0,0,0,1],half:[Math.fround(desc.hx),Math.fround(desc.hy),Math.fround(desc.hz)]};
const metadata=(active:boolean)=>({pieces:[{id:room.sealId,active,colliders:1,follows:{rotation:true,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,room.origin.x,room.origin.y,room.origin.z,1]}}],solids:[{body:2}]});

test.each([false,true])('the native seal retains initial owner activity %s without removing its body',async active=>{
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim=createShardfileSim(emptyShardfile({slug:'seal-proof',name:'Seal proof',author:'Test',revision:1,seed:1}),new Map(),{rapier});
  try{
    const solids=nativeArenaSealSolids(metadata(active),[solid],room);
    expect(solids).toHaveLength(1);expect(solids[0]).toMatchObject({...solid,enabled:active});
    installNativeCollision(sim.host,{solids,ground:{heights:new Float32Array(4),friction:0.5,groups:131071,scale:{x:1,y:1,z:1},at:{x:0,y:0,z:0}}},{resolution:2});
    sim.host.physics.step();
    const {R,world}=sim.host.physics,hit=world.castRay(new R.Ray({x:room.origin.x,y:1,z:room.origin.z+room.halfWidth+2},{x:0,y:0,z:-1}),4,true);
    expect(hit!==null).toBe(active);
    expect(world.colliders.getAll().some(c=>c.translation().x===solid.at[0]&&c.isEnabled()===active)).toBe(true);
  }finally{sim.dispose();}
});

test('ambiguous or different native seal sources refuse before changing any solid',()=>{
  expect(()=>nativeArenaSealSolids(metadata(false),[{...solid,half:[1,1,1]}],room)).toThrow('correspondence');
  const duplicated=metadata(false);duplicated.solids.push({body:2});
  expect(()=>nativeArenaSealSolids(duplicated,[solid,solid],room)).toThrow('correspondence');
  expect(()=>nativeArenaSealSolids(metadata(false),[solid],{...room,origin:{...room.origin,x:11}})).toThrow('pose differs');
  expect(solid.enabled).toBeUndefined();
});
