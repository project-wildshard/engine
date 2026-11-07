import {expect,test} from 'vitest';
import {createSimHost,type SimHost} from '../src/server/engine/sim';
import {loadRapier} from '../src/shared/engine/physics/rapier';
import {fixtureBytes} from '@wildshard/engine/test/nativeBytes';
import {HeightPatch} from '../src/shared/engine/physics/heightPatch';
import {ArenaRoomGround,sandWireName} from '../src/shared/game/boss/arenaGround';
import { snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import {physicsState} from './fake/simState';
import {NativeArenaSand} from '../src/server/game/boss/nativeArenaSand';
import {SIM_LEVEL} from './fixtures/sim-level/level';
import { leadCommands } from '@wildshard/engine/sim/leadPlayer';

const room={origin:{x:0,y:5,z:0},halfWidth:5,corridorHalfWidth:1,corridorEnd:8,sandCells:4,
  cover:{x:0,z:0,wid:2,len:3,plinthH:.3,h:.6},pedestal:{x:1,z:1},beams:[]};
// Frozen numeric loop from BossArenaRoom.writeSand; no candidate helper is
// used to construct the original HeightPatch publication.
function originalGrid(ground:ArenaRoomGround):Float32Array {
  const side=room.sandCells+1,grid=new Float32Array(side*side);
  for(let z=0;z<side;z++)for(let x=0;x<side;x++){
    let sum=0,count=0;
    for(const [dx,dz]of [[-1,-1],[0,-1],[-1,0],[0,0]] as const){
      const i=x+dx,j=z+dz;
      if(i>=0&&j>=0&&i<room.sandCells&&j<room.sandCells){sum+=ground.sand[j*room.sandCells+i]??0;count++;}
    }
    grid[z*side+x]=count>0?sum/count:0;
  }
  return grid;
}
function apply(ground:ArenaRoomGround,tick:number):void {
  if(tick%7===0)ground.addSand(tick%5-2,1,2,.03,.5);
  if(tick>90)ground.drainSand(1/30,.02);
  if(tick===150)ground.clearSand();
}

test('room sand preserves original heightfields and a quiet complete native continuation',async()=>{
  const rapier=await loadRapier(Uint8Array.from(fixtureBytes(new URL('../public/assets/physics/rapier.wasm',import.meta.url))));
  const level={...SIM_LEVEL,entities:[],quests:[]},page=createSimHost(level,{rapier}),native=createSimHost(level,{rapier});
  const original=new ArenaRoomGround(room),patch=new HeightPatch(page.physics,{x:0,y:5,z:0,size:10,res:5,material:'sand',owner:'native.room.sand'});
  const sand=new NativeArenaSand(native,room,'native.room.sand',sandWireName('native.room'));let restored:SimHost|undefined,copy:NativeArenaSand|undefined;
  page.onStep('page.room.sand',dt=>{if(original.pace(dt))patch.set(originalGrid(original));});
  native.onStep('native.room.sand',dt=>{sand.advance(dt);},{snapshot:()=>({...sand.snapshot()}),restore:value=>{sand.restore(value);},physicsRestored:()=>{sand.physicsRestored();}});
  try{
    for(let tick=0;tick<180;tick++){
      apply(original,tick);apply(sand.ground,tick);if(copy!==undefined)apply(copy.ground,tick);
      page.step(leadCommands(page, {moveX:0,moveZ:0,yaw:0}));native.step(leadCommands(native, {moveX:0,moveZ:0,yaw:0}));restored?.step(leadCommands(restored, {moveX:0,moveZ:0,yaw:0}));
      expect(sand.ground.snapshot()).toStrictEqual(original.snapshot());
      expect(physicsState(native.physics.snapshot())).toStrictEqual(physicsState(page.physics.snapshot()));
      if(restored!==undefined&&copy!==undefined){expect(snapshotSimHostBytes(restored)).toStrictEqual(snapshotSimHostBytes(native));expect(copy.snapshot()).toStrictEqual(sand.snapshot());}
      if(tick===58){
        const saved=snapshotSimHostBytes(native);
        restored=restoreSimHost(level,{rapier},saved,host=>{
          const next=new NativeArenaSand(host,room,'native.room.sand',sandWireName('native.room'));copy=next;
          host.onStep('native.room.sand',dt=>{next.advance(dt);},{snapshot:()=>({...next.snapshot()}),restore:value=>{next.restore(value);},physicsRestored:()=>{next.physicsRestored();}});
        });
        expect(snapshotSimHostBytes(restored)).toStrictEqual(saved);
      }
    }
    const saved=sand.snapshot();
    expect(()=>sand.restore({...saved,grid:[1]})).toThrow('continuation');
    expect(sand.snapshot()).toStrictEqual(saved);
  }finally{page.dispose();native.dispose();restored?.dispose();}
},30_000);

test('room sand refuses foreign saved data, replaced geometry and a retired owner',async()=>{
  const rapier=await loadRapier(Uint8Array.from(fixtureBytes(new URL('../public/assets/physics/rapier.wasm',import.meta.url))));
  const host=createSimHost({...SIM_LEVEL,entities:[],quests:[]},{rapier}),sand=new NativeArenaSand(host,room,'native.room.sand',sandWireName('native.room'));
  try{
    sand.ground.addSand(0,0,3,.4,.5);
    for(let tick=0;tick<4;tick++)sand.advance(1/30);
    const saved=sand.snapshot(),grid=saved.grid;if(saved.collider===null||grid===null)throw new Error('Missing real published heightfield');
    expect(()=>sand.restore({...saved,version:2})).toThrow();
    expect(()=>sand.restore({...saved,recipe:'foreign'})).toThrow('continuation');
    expect(()=>sand.restore({...saved,collider:-1})).toThrow();
    expect(()=>sand.restore({...saved,grid:grid.map((value,index)=>index===0?Math.PI:value)})).toThrow('continuation');
    expect(sand.snapshot()).toStrictEqual(saved);
    const collider=host.physics.world.getCollider(saved.collider);if(collider===null)throw new Error('Missing original collider');
    collider.setTranslation({x:.1,y:5,z:0});expect(()=>sand.snapshot()).toThrow('original geometry');
    collider.setTranslation({x:0,y:5,z:0});expect(sand.snapshot()).toStrictEqual(saved);
    host.dispose();expect(()=>sand.advance(1/30)).toThrow('retired');expect(()=>sand.snapshot()).toThrow('retired');
  }finally{host.dispose();}
});
