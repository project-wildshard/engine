// oxlint-disable-next-line import/no-nodejs-modules -- The continuation fixture uses the shipped native physics binary.
import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {createSimHost,type SimHost} from '@wildshard/engine/sim';
import {loadRapier} from '@wildshard/engine/physics/rapier';
import { snapshotSimHost, snapshotSimHostBytes, serializeSimSnapshot, decodeSimSnapshot } from '@wildshard/engine/sim/snapshot';
import { restoreSimHost } from '@wildshard/engine/sim/restore';
import {SIM_LEVEL,fightCommand} from './fixtures/sim-level/level';
import {builtProduct} from './fixtures/builtProduct';
import {loadHeadlessProduct} from '../src/server/host/headlessProduct';
import {createNativeProofAdapter,createNativeProofResident} from './fixtures/headless-native';
import {prepareHeadlessRuntime} from './fixtures/headless/trustedRuntime';
import type {HeadlessCommand} from '../src/shared/host/tickProtocol';
import type {TickWorkerAdapter} from '../src/server/host/tickWorkerLoop';
import { leadCommands } from '@wildshard/engine/sim/leadPlayer';

test('byte capture retains exact native fight checkpoint wire and restored suffix',async()=>{
 const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
 const host=createSimHost(SIM_LEVEL,{rapier});let restored:SimHost|undefined;
 try{
  for(let tick=0;tick<120;tick++)host.step(leadCommands(host, fightCommand(tick)));
  const legacy=serializeSimSnapshot(snapshotSimHost(host)),bytes=snapshotSimHostBytes(host);
  expect(bytes.physics).toBeInstanceOf(Uint8Array);
  expect(serializeSimSnapshot(bytes)).toBe(legacy);
  const frozen=bytes.physics.slice();
  restored=restoreSimHost(SIM_LEVEL,{rapier},decodeSimSnapshot(legacy));
  for(let tick=120;tick<132;tick++){
   host.step(leadCommands(host, fightCommand(tick)));restored.step(leadCommands(restored, fightCommand(tick)));
   const checkpoint=serializeSimSnapshot(snapshotSimHostBytes(host));
   expect(checkpoint).toBe(serializeSimSnapshot(snapshotSimHost(host)));
   expect(serializeSimSnapshot(snapshotSimHostBytes(restored))).toBe(checkpoint);
  }
  expect(bytes.physics).toEqual(frozen);
 }finally{restored?.dispose();host.dispose();}
});

test('trusted adapter retains legacy wire, effects and exact restored native suffix',async()=>{
 let adapter:TickWorkerAdapter|undefined,restored:TickWorkerAdapter|undefined,resident:Awaited<ReturnType<typeof createNativeProofResident>>|undefined;
 try{
  // CI21 (J232): the trusted runtime fixture owns the actor and its reward; the product is only the admitted shell, so the
  // pinned Template product stands in for a freshly built SDK template project (engine can't run the SDK, J65).
  const product=await loadHeadlessProduct(builtProduct('_template')),rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const preparation={product,shard:product.shardfile,assets:new Map<string,Uint8Array>(),rapier};
  adapter=await createNativeProofAdapter(preparation,prepareHeadlessRuntime);resident=await createNativeProofResident(preparation,prepareHeadlessRuntime);
  let rewards=0;
  for(let tick=0;tick<30;tick++){
   const commands:HeadlessCommand[]=[{kind:'script',actorId:'fixture.actor',value:tick},
    {kind:'player',moveX:0,moveZ:0,yaw:0,...(tick===0?{attack:{targetId:'fixture.actor'}}:{})}];
   adapter.step(commands);resident.step(commands);
   const commit=adapter.commit();
   expect(commit.snapshot).toBe(serializeSimSnapshot(snapshotSimHost(resident.host)));
   expect(commit.effects).toEqual(resident.effects);
   rewards+=commit.effects.filter(effect=>effect.kind==='coins').length;
   if(tick===9)restored=await createNativeProofAdapter(preparation,prepareHeadlessRuntime,commit.snapshot);
   else if(tick>9){
    if(restored===undefined)throw new Error('Missing restored trusted adapter');
    restored.step(commands);expect(restored.commit()).toEqual(commit);
   }
  }
  expect(rewards).toBe(1);
  expect(decodeSimSnapshot(adapter.commit().snapshot).entities[0]?.state.motion.hp).toBeLessThan(100);
 }finally{restored?.dispose();adapter?.dispose();resident?.dispose();}
});
