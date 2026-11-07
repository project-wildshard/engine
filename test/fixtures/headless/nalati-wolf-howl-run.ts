// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Assert the earned native encounter and independent input replay.
import assert from 'node:assert/strict';
import * as v from 'valibot';
import {Vector3} from 'three';
import {HeldBowFileSchema} from '@wildshard/format/weaponProfiles';
import {heldBowBase} from '../../../src/shared/game/weapons/heldBowBase';
import {bowLaunchSpeed} from '../../../src/shared/engine/combat/bowLaw';
import {nativeGroupCollection} from '../../../src/server/game/shardfile/groupRuntime';
import {runTrustedHeadlessTape} from '../../../src/shared/host/headlessTape';
import type {HeadlessCommand,HeadlessEffect} from '../../../src/shared/host/tickProtocol';
import {earnNalatiPasture} from './nalati-pasture-session';
import {beginProductSession} from './productSession';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const {resident,product,population,flock,sheep,checkpoint,checkpointTick,arrivalTick}=await earnNalatiPasture([
  {x:-135,z:214},{x:-157,z:212,jump:true,jumpAt:7},{x:-175,z:206},
]);
let replay:Awaited<ReturnType<Awaited<ReturnType<typeof beginProductSession>>['ready']>>|undefined;
try{
  const definition=v.parse(HeldBowFileSchema,await product.json('weapons/bow-page.json')),bow=heldBowBase({bow:definition.bow,base:definition.base});
  const pending=await beginProductSession('nalati-grasslands','nalati-predators',checkpoint);replay=await pending.ready();
  const frames:HeadlessCommand[][]=[],effects:HeadlessEffect[]=[],head=new Vector3();
  const step=(commands:readonly HeadlessCommand[]):void=>{
    frames.push(structuredClone([...commands]));resident.step(commands);effects.push(...structuredClone(resident.effects));
  };
  for(let tick=0;tick<120&&population.raid.raids===0;tick++)step([]);
  assert.equal(population.raid.raids,1);
  const groups=nativeGroupCollection(resident.host,'nalati.groups'),pack=groups.packs[population.raid.snapshot().raiders];
  assert.ok(pack);const leader=pack.alpha;assert.ok(leader);assert.equal(leader.alive,true);
  const aim=(held:boolean):HeadlessCommand[]=>{
    const feet=leadPlayer(resident.host).position;
    const target=pack.members.filter(actor=>actor.alive&&actor!==leader)
      .sort((a,b)=>a.position.distanceToSquared(feet)-b.position.distanceToSquared(feet))[0];
    if(target===undefined)return [];
    target.headWorld(head);
    const time=Math.hypot(head.x-feet.x,head.z-feet.z)/bowLaunchSpeed(bow.base,1);
    head.x+=Math.sin(target.yaw)*target.speed*time;head.z+=Math.cos(target.yaw)*target.speed*time;
    head.y+=.5*bow.rows.arrow.gravity*time*time;
    const dx=head.x-feet.x,dz=head.z-feet.z;
    return [{kind:'player',moveX:0,moveZ:0,yaw:Math.atan2(-dx,-dz),commandVersion:1,
      steer:{keyX:0,keyY:0,stickX:0,stickY:0},...(held?{heavy:{}}:{})},
      {kind:'script',actorId:'nalati.weapon.aim',value:1},
      {kind:'script',actorId:'nalati.weapon.pitch',value:Math.atan2(head.y-feet.y-1.68,Math.hypot(dx,dz))}];
  };
  let releases=0;
  for(;releases<12&&!pack.members.some(actor=>!actor.alive);releases++){
    for(let tick=0;tick<60;tick++)step(aim(true));step(aim(false));for(let tick=0;tick<75;tick++)step([]);
  }
  assert.ok(pack.members.some(actor=>actor!==leader&&!actor.alive),'real arrows kill a non-leader before the regroup');
  assert.equal(leader.alive,true);
  for(let tick=0;tick<1800;tick++)step([]);
  assert.equal(flock.alive,sheep);assert.equal(population.raid.taken,0);assert.equal(leadPlayer(resident.host).health.alive,true);
  for(const text of ['Wolves are raiding the flock — the shepherd rides out','A wolf howls — the pack has your scent'])
    assert.ok(effects.some(effect=>effect.kind==='hint'&&effect.text===text),'only real native events deliver each admitted message');
  const observed=['nalati.predators','nalati.weapons'];
  const report=runTrustedHeadlessTape(resident.host,commands=>resident.step(commands),()=>resident.effects,{version:1,observe:observed,
    segments:[{id:'after-earned-regroup',ticks:1,commands:[]}]});
  const repeated=await replay.verbTape({version:1,observe:observed,segments:[
    {id:'captured-regroup-inputs',ticks:frames.length,commands:[],frames},{id:'after-earned-regroup',ticks:1,commands:[]},
  ]});
  assert.deepEqual(repeated.observations[0]?.effects,effects,'fresh replay raises the same ordered native cues');
  assert.deepEqual(repeated.observations.at(-1),report.observations[0],'all actual bodies, flock, notice cooldowns and projectile cursors continue identically');
  assert.equal(replay.quarantined,false);
  console.info(JSON.stringify({story:'native-wolf-howl',arrivalTick,checkpointTick,releases,inputs:frames.length,
    killed:pack.members.filter(actor=>!actor.alive).length,sheep:flock.alive,drivenOff:population.raid.drivenOff}));
}finally{resident.dispose();await replay?.dispose();}
