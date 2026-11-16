// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Assert real contacts and independent native replay.
import assert from 'node:assert/strict';
import * as v from 'valibot';
import {Vector3} from 'three';
import {ThrownWeaponProfileSchema} from '@wildshard/format/weaponProfiles';
import {parseHeldSlots} from '@wildshard/format/heldArms';
import {nativeGroupCollection} from '../../../src/server/game/shardfile/groupRuntime';
import {runTrustedHeadlessTape} from '../../../src/shared/host/headlessTape';
import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import {earnNalatiPasture} from './nalati-pasture-session';
import {beginFolderSession} from './folderSession';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const mode=process.argv[2];if(mode!=='thrust'&&mode!=='javelin')throw new Error('Unknown fixed native polearm proof');
const {resident,product,population,checkpoint,checkpointTick}=await earnNalatiPasture([
  {x:-135,z:214},{x:-157,z:212,jump:true,jumpAt:7},{x:-175,z:206},
]);
let replay:Awaited<ReturnType<Awaited<ReturnType<typeof beginFolderSession>>['ready']>>|undefined;
try{
  const slots=parseHeldSlots(await product.json('held/slots.json')),slot=slots.slots.find(row=>row.kind==='polearm');assert.ok(slot);
  const item=product.shardfile.items.rows.find(row=>row.id===slot.item);assert.ok(item?.kind==='weapon');
  const thrown=v.parse(ThrownWeaponProfileSchema,item.profile);
  const frames:HeadlessCommand[][]=[];
  const step=(commands:readonly HeadlessCommand[]):void=>{frames.push(structuredClone([...commands]));resident.step(commands);};
  for(let tick=0;tick<120&&population.raid.raids===0;tick++)step([]);
  assert.equal(population.raid.raids,1);
  const groups=nativeGroupCollection(resident.host,'nalati.groups'),pack=groups.packs[population.raid.snapshot().raiders];assert.ok(pack);
  const initial=new Map(pack.members.map(actor=>[actor.entityId,actor.hp]));assert.ok(initial.size>0);
  const damaged=()=>pack.members.some(actor=>actor.hp<(initial.get(actor.entityId)??0));
  const nearest=()=>pack.members.filter(actor=>actor.alive).sort((a,b)=>a.position.distanceToSquared(leadPlayer(resident.host).position)-b.position.distanceToSquared(leadPlayer(resident.host).position))[0];
  for(let swap=0;swap<2;swap++)step([{kind:'script',actorId:'nalati.weapon.swap',value:1}]);
  if(mode==='thrust'){
    for(let tick=0;tick<1800&&!damaged();tick++){
      const feet=leadPlayer(resident.host).position,target=nearest();assert.ok(target);
      const dx=target.position.x-feet.x,dz=target.position.z-feet.z,gap=Math.hypot(dx,dz);
      const commands:HeadlessCommand[]=[{kind:'player',moveX:0,moveZ:0,yaw:Math.atan2(-dx,-dz),commandVersion:1,
        steer:{keyX:0,keyY:gap>2?1:0,stickX:0,stickY:0}},
        {kind:'script',actorId:'nalati.weapon.pitch',value:Math.atan2(target.position.y+.7-feet.y-1.68,gap)}];
      if(tick%30===0&&gap<3)commands.push({kind:'script',actorId:'nalati.weapon.attack',value:1});
      step(commands);
    }
  }else{
    // Walk toward a real moving raider before raising AIM. Only observed body
    // motion is led; no target identity, pose or damage crosses the input port.
    for(let tick=0;tick<1200;tick++){
      const feet=leadPlayer(resident.host).position,target=nearest();assert.ok(target);
      const dx=target.position.x-feet.x,dz=target.position.z-feet.z;if(Math.hypot(dx,dz)<6)break;
      step([{kind:'player',moveX:0,moveZ:0,yaw:Math.atan2(-dx,-dz),commandVersion:1,steer:{keyX:0,keyY:1,stickX:0,stickY:0}}]);
    }
    const previous=new Map(pack.members.map(actor=>[actor.entityId,actor.position.clone()])),velocities=new Map<string,Vector3>();
    const sample=(commands:readonly HeadlessCommand[]):void=>{step(commands);for(const actor of pack.members){const last=previous.get(actor.entityId);assert.ok(last);
      velocities.set(actor.entityId,actor.position.clone().sub(last).multiplyScalar(60));last.copy(actor.position);}};
    const rear=new Vector3(),front=new Vector3(),center=new Vector3();
    const aim=(held:boolean):HeadlessCommand[]=>{
      const feet=leadPlayer(resident.host).position,target=nearest();assert.ok(target);
      target.bodyCapsule(rear,front);center.addVectors(rear,front).multiplyScalar(.5);
      const time=Math.hypot(center.x-feet.x,center.z-feet.z)/thrown.speed,velocity=velocities.get(target.entityId);
      if(velocity!==undefined)center.addScaledVector(velocity,time);center.y+=.5*thrown.gravity*time*time;
      const yaw=Math.atan2(-(center.x-feet.x),-(center.z-feet.z));center.x-=Math.cos(yaw)*.22;center.z+=Math.sin(yaw)*.22;center.y-=.05;
      const dx=center.x-feet.x,dz=center.z-feet.z;
      return [{kind:'player',moveX:0,moveZ:0,yaw:Math.atan2(-dx,-dz),commandVersion:1,steer:{keyX:0,keyY:0,stickX:0,stickY:0}},
        {kind:'script',actorId:'nalati.weapon.aim',value:held?1:0},
        {kind:'script',actorId:'nalati.weapon.pitch',value:Math.atan2(center.y-feet.y-1.68,Math.hypot(dx,dz))-.035}];
    };
    for(let shot=0;shot<thrown.carried&&!damaged();shot++){
      for(let tick=0;tick<60;tick++)sample(aim(true));for(let tick=0;tick<60;tick++)sample(aim(false));
    }
  }
  assert.ok(damaged(),`real ${mode} inputs damage an actual moving raider`);
  assert.equal(leadPlayer(resident.host).health.alive,true);
  const owner=resident.host.adapters.get('nalati.weapons');assert.ok(owner);const saved=owner.snapshot();assert.equal(typeof saved,'string');
  if(typeof saved!=='string')throw new Error('Missing actual polearm continuation');
  const state=v.parse(v.object({thrusts:v.number(),throws:v.number(),ammo:v.number()}),JSON.parse(saved));
  if(mode==='thrust')assert.ok(state.thrusts>0);else{assert.ok(state.throws>0);assert.equal(state.ammo,thrown.carried-state.throws);}
  const pending=await beginFolderSession('nalati-grasslands','nalati-predators',checkpoint);replay=await pending.ready();
  const observed=['nalati.predators','nalati.weapons'];
  const report=runTrustedHeadlessTape(resident.host,commands=>resident.step(commands),()=>resident.effects,
    {version:1,observe:observed,segments:[{id:'after-polearm-contact',ticks:1,commands:[]}]});
  const repeated=await replay.verbTape({version:1,observe:observed,segments:[
    {id:'captured-polearm-inputs',ticks:frames.length,commands:[],frames},{id:'after-polearm-contact',ticks:1,commands:[]},
  ]});
  assert.deepEqual(repeated.observations.at(-1),report.observations[0],'fresh real inputs reproduce HP, decision, ammo and complete flight state');
  assert.equal(replay.quarantined,false);
  console.info(JSON.stringify({story:`native-polearm-${mode}`,checkpointTick,inputs:frames.length,...state,
    targets:pack.members.map(actor=>({id:actor.entityId,before:initial.get(actor.entityId),after:actor.hp}))}));
}finally{resident.dispose();await replay?.dispose();}
