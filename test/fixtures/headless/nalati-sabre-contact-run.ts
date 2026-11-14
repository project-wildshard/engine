// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Assert actual contacts and independent native input replay.
import assert from 'node:assert/strict';
import * as v from 'valibot';
import {nativeGroupCollection} from '../../../src/server/game/shardfile/groupRuntime';
import {runTrustedHeadlessTape} from '../../../src/shared/host/headlessTape';
import {snapshotSimHost,serializeSimSnapshot} from '../../../src/shared/engine/sim/snapshot';
import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import {earnNalatiPasture} from './nalati-pasture-session';
import {beginFolderSession} from './folderSession';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const Weapons=v.object({blade:v.object({contacts:v.number(),struck:v.array(v.string())}),swing:v.object({move:v.nullable(v.number()),swingT:v.number()}),moves:v.array(v.string())});
const {resident,population,checkpoint,checkpointTick}=await earnNalatiPasture([
  {x:-135,z:214},{x:-157,z:212,jump:true,jumpAt:7},{x:-175,z:206},
]);
let replay:Awaited<ReturnType<Awaited<ReturnType<typeof beginFolderSession>>['ready']>>|undefined;
try{
  const owner=resident.host.adapters.get('nalati.weapons');assert.ok(owner);
  const read=()=>{const saved=owner.snapshot();assert.equal(typeof saved,'string');if(typeof saved!=='string')throw new Error('Missing actual sabre state');return v.parse(Weapons,JSON.parse(saved));};
  const frames:HeadlessCommand[][]=[];
  const step=(commands:readonly HeadlessCommand[]):void=>{frames.push(structuredClone([...commands]));resident.step(commands);};
  for(let tick=0;tick<120&&population.raid.raids===0;tick++)step([]);
  assert.equal(population.raid.raids,1);
  const groups=nativeGroupCollection(resident.host,'nalati.groups'),pack=groups.packs[population.raid.snapshot().raiders];assert.ok(pack);
  const before=new Map(pack.members.map(actor=>[actor.entityId,actor.hp]));assert.ok(before.size>0);
  step([{kind:'script',actorId:'nalati.weapon.swap',value:1}]);
  for(let tick=0;tick<1800&&read().blade.contacts===0;tick++){
    const feet=leadPlayer(resident.host).position,target=pack.members.filter(actor=>actor.alive)
      .sort((a,b)=>a.position.distanceToSquared(feet)-b.position.distanceToSquared(feet))[0];assert.ok(target);
    const dx=target.position.x-feet.x,dz=target.position.z-feet.z,gap=Math.hypot(dx,dz);
    const commands:HeadlessCommand[]=[{kind:'player',moveX:0,moveZ:0,yaw:Math.atan2(-dx,-dz),commandVersion:1,
      steer:{keyX:0,keyY:gap>2?1:0,stickX:0,stickY:0}},
      {kind:'script',actorId:'nalati.weapon.pitch',value:Math.atan2(target.position.y+.7-feet.y-1.68,gap)}];
    if(tick%20===0&&gap<5)commands.push({kind:'script',actorId:'nalati.weapon.attack',value:1});
    step(commands);
  }
  const hit=read();assert.ok(hit.blade.contacts>0,'the ordinary sweep contacts an actual raider');assert.ok(hit.blade.struck.length>0);
  assert.ok(pack.members.some(actor=>actor.hp<(before.get(actor.entityId)??0)),'the real combat owner accepts sabre damage');
  assert.notEqual(hit.swing.move,null,'capture the actual swing while its struck set is live');
  assert.equal(leadPlayer(resident.host).health.alive,true);
  const middle=serializeSimSnapshot(snapshotSimHost(resident.host)),middleTick=frames.length;
  const pending=await beginFolderSession('nalati-grasslands','nalati-predators',checkpoint);replay=await pending.ready();
  const observed=['nalati.predators','nalati.weapons'];
  const mark=()=>runTrustedHeadlessTape(resident.host,commands=>resident.step(commands),()=>resident.effects,
    {version:1,observe:observed,segments:[{id:'after-sabre-contact',ticks:1,commands:[]}]});
  // Stay in this same swing, with no second attack. A restored struck set must
  // suppress the same body's overlapping rays, just as the uninterrupted one.
  for(let tick=0;tick<2;tick++)step([]);
  assert.equal(read().blade.contacts,hit.blade.contacts);assert.equal(read().swing.move,hit.swing.move);
  const suffix=frames.slice(middleTick),report=mark();
  const repeated=await replay.verbTape({version:1,observe:observed,segments:[
    {id:'captured-sabre-inputs',ticks:frames.length,commands:[],frames},{id:'after-sabre-contact',ticks:1,commands:[]},
  ]});
  assert.deepEqual(repeated.observations.at(-1),report.observations[0],'fresh input replay matches actual contacts, health and complete blade continuation');
  await replay.dispose();replay=undefined;
  const restored=await beginFolderSession('nalati-grasslands','nalati-predators',middle);replay=await restored.ready();
  const continuation=await replay.verbTape({version:1,observe:observed,segments:[
    {id:'continue-live-swing',ticks:suffix.length,commands:[],frames:suffix},{id:'after-sabre-contact',ticks:1,commands:[]},
  ]});
  assert.deepEqual(continuation.observations.at(-1),report.observations[0],'restored mid-contact pose and struck identities reproduce the same suffix without duplicate damage');
  assert.equal(replay.quarantined,false);
  console.info(JSON.stringify({story:'native-sabre-contact',checkpointTick,inputs:frames.length,moves:hit.moves,contacts:hit.blade.contacts,
    damage:pack.members.map(actor=>({id:actor.entityId,before:before.get(actor.entityId),after:actor.hp}))}));
}finally{resident.dispose();await replay?.dispose();}
