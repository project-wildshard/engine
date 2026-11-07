// oxlint-disable-next-line import/no-nodejs-modules -- Assert real native outcomes and their independent replay.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Read only the admitted product and actual physics bytes.
import {readFileSync} from 'node:fs';
import {builtProduct} from '../builtProduct';
import {loadHeadlessProduct} from '../../../src/server/host/headlessProduct';
import {outputDescriptor} from '../../../src/shared/game/shardfile/outputDescriptor';
import {loadRapier} from '../../../src/shared/engine/physics/rapier';
import {snapshotSimHost,serializeSimSnapshot} from '../../../src/shared/engine/sim/snapshot';
import {nativePopulationOf,type NativePopulation} from '../../../src/server/game/riding/nativePopulation';
import {runTrustedHeadlessTape} from '../../../src/shared/host/headlessTape';
import type {WalkPoint} from '../../../src/shared/host/headlessJourney';
import {createNativeProofResident} from '../headless-native';
import {prepareHeadlessRuntime} from '../nalati-predators-native';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

interface EarnedPasture {
  resident:Awaited<ReturnType<typeof createNativeProofResident>>;
  product:Awaited<ReturnType<typeof loadHeadlessProduct>>;
  assets:Map<string,Uint8Array>;rapier:Awaited<ReturnType<typeof loadRapier>>;
  population:NativePopulation;flock:NativePopulation['flocks'][number];
  sheep:number;originalWolves:string[];delay:number;arrivalTick:number;checkpoint:string;checkpointTick:number;
}

/** Earn a checkpoint through the physical entry and unchanged natural raid clock. */
export async function earnNalatiPasture(interception?:readonly WalkPoint[]):Promise<EarnedPasture>{
  const directory=builtProduct('nalati-grasslands'),product=await loadHeadlessProduct(directory),shard=product.shardfile;
  const descriptor=outputDescriptor(shard);assert.ok(descriptor);
  const assets=new Map(descriptor.index.files.map(file=>[file.commons===true?`commons:${file.hash}`:file.hash,
    Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const resident=await createNativeProofResident({shard,assets,rapier,product},prepareHeadlessRuntime);
  try{
    const population=nativePopulationOf(resident.host);assert.ok(population);
    const flock=population.flocks[0];assert.ok(flock);
    const sheep=flock.alive,originalWolves=[...resident.host.entities.values()].filter(actor=>actor.kind==='wolf').map(actor=>actor.entityId);
    const delay=population.raid.snapshot().state.raidT;assert.ok(delay>0);
    runTrustedHeadlessTape(resident.host,commands=>resident.step(commands),()=>resident.effects,{version:1,observe:[],segments:[{
      id:'walk-and-jump-to-pasture',ticks:6000,commands:[],route:[{x:-10,z:232,jump:true,jumpAt:6},{x:-30,z:228},{x:-60,z:222},{x:-100,z:212}],
    }]});
    let arrivalTick=resident.host.state.tick;
    assert.ok(Math.hypot(leadPlayer(resident.host).position.x-flock.cx,leadPlayer(resident.host).position.z-flock.cz)<30);
    if(interception!==undefined){
      runTrustedHeadlessTape(resident.host,commands=>resident.step(commands),()=>resident.effects,{version:1,observe:[],segments:[{
        id:'walk-to-interception',ticks:6000,commands:[],route:[...interception],
      }]});
      arrivalTick=resident.host.state.tick;
    }
    for(let tick=0;tick<18_000&&population.raid.snapshot().state.raidT>.2;tick++)resident.step([]);
    assert.equal(population.raid.raids,0,'the checkpoint precedes the actual scheduled raid');
    assert.ok(population.raid.snapshot().state.raidT<=.2,'the real clock reaches its scheduled attempt');
    const checkpoint=serializeSimSnapshot(snapshotSimHost(resident.host)),checkpointTick=resident.host.state.tick;
    return {resident,product,assets,rapier,population,flock,sheep,originalWolves,delay,arrivalTick,checkpoint,checkpointTick};
  }catch(error){resident.dispose();throw error;}
}
