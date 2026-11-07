// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Assert actual damage and independent real-input replay.
import assert from 'node:assert/strict';
import * as v from 'valibot';
import {Vector3} from 'three';
import {HeldBowFileSchema} from '@wildshard/format/weaponProfiles';
import {heldBowBase} from '../../../src/shared/game/weapons/heldBowBase';
import {bowLaunchSpeed} from '../../../src/shared/engine/combat/bowLaw';
import {runTrustedHeadlessTape} from '../../../src/shared/host/headlessTape';
import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import {beginProductSession} from './productSession';
import {earnNalatiPasture} from './nalati-pasture-session';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const {resident,product,population,flock,sheep,originalWolves,checkpoint,checkpointTick}=await earnNalatiPasture();
let replay:Awaited<ReturnType<Awaited<ReturnType<typeof beginProductSession>>['ready']>>|undefined;
try{
  const source=v.parse(HeldBowFileSchema,await product.json('weapons/bow-page.json')),bow=heldBowBase({bow:source.bow,base:source.base});
  const pending=await beginProductSession('nalati-grasslands','nalati-predators',checkpoint);replay=await pending.ready();
  const frames:HeadlessCommand[][]=[],head=new Vector3();
  const step=(commands:readonly HeadlessCommand[]):void=>{frames.push(structuredClone([...commands]));resident.step(commands);};
  for(let tick=0;tick<660;tick++)step([]);
  assert.equal(population.raid.raids,1);assert.equal(population.raid.raiding,true);
  const raiders=()=>[...resident.host.entities.values()].filter(actor=>actor.kind==='wolf'&&!originalWolves.includes(actor.entityId));
  const initial=new Map(raiders().map(actor=>[actor.entityId,actor.hp]));assert.ok(initial.size>0);
  const aim=(held:boolean):HeadlessCommand[]=>{
    const feet=leadPlayer(resident.host).position;
    const target=raiders().filter(actor=>actor.alive).sort((a,b)=>a.position.distanceToSquared(feet)-b.position.distanceToSquared(feet))[0];
    if(target===undefined)return [];
    target.headWorld(head);
    // A controller may lead its observed target. Only yaw/pitch/hold inputs
    // cross the boundary; the ordinary projectile law decides every contact.
    const time=Math.hypot(head.x-feet.x,head.z-feet.z)/bowLaunchSpeed(bow.base,1);
    head.x+=Math.sin(target.yaw)*target.speed*time;head.z+=Math.cos(target.yaw)*target.speed*time;
    head.y+=.5*bow.rows.arrow.gravity*time*time;
    const dx=head.x-feet.x,dz=head.z-feet.z;
    return [{kind:'player',moveX:0,moveZ:0,yaw:Math.atan2(-dx,-dz),commandVersion:1,
      steer:{keyX:0,keyY:0,stickX:0,stickY:0},...(held?{heavy:{}}:{})},
      {kind:'script',actorId:'nalati.weapon.aim',value:1},
      {kind:'script',actorId:'nalati.weapon.pitch',value:Math.atan2(head.y-feet.y-1.68,Math.hypot(dx,dz))}];
  };
  const hold=Math.ceil((bow.base.draw?.drawTime??.75)*60)+15;
  for(let shot=0;shot<8;shot++){
    for(let tick=0;tick<hold;tick++)step(aim(true));
    step(aim(false));for(let tick=0;tick<75;tick++)step([]);
  }
  assert.ok(raiders().some(actor=>actor.hp<(initial.get(actor.entityId)??0)),'real full-draw arrows damage an actual raider');
  assert.ok(raiders().some(actor=>!actor.alive),'an actual raider dies through the projectile contact law');
  assert.equal(flock.alive,sheep);assert.equal(population.raid.taken,0);assert.equal(population.raid.drivenOff,1);
  assert.equal(leadPlayer(resident.host).health.alive,true);
  const owner=resident.host.adapters.get('nalati.weapons');assert.ok(owner);
  const saved=owner.snapshot();assert.equal(typeof saved,'string');
  if(typeof saved!=='string')throw new Error('Missing actual native bow continuation');
  const weapons=v.parse(v.object({shots:v.number(),bolts:v.number()}),JSON.parse(saved));
  assert.equal(weapons.shots,8);assert.equal(weapons.bolts,bow.base.quiver-weapons.shots);
  const observed=['nalati.predators','nalati.weapons'];
  const report=runTrustedHeadlessTape(resident.host,commands=>resident.step(commands),()=>resident.effects,{version:1,observe:observed,
    segments:[{id:'after-real-wolf-fight',ticks:1,commands:[]}]});
  const repeated=await replay.verbTape({version:1,observe:observed,segments:[
    {id:'captured-wolf-fight',ticks:frames.length,commands:[],frames},
    {id:'after-real-wolf-fight',ticks:1,commands:[]},
  ]});
  assert.deepEqual(repeated.observations.at(-1),report.observations[0],
    'fresh-worker inputs reproduce actual HP/deaths, flock, raid, complete bow and projectile continuation');
  assert.equal(replay.quarantined,false);
  const predator=resident.host.adapters.get('nalati.predators');assert.ok(predator);
  const observedState=predator.snapshot();assert.equal(typeof observedState,'string');
  if(typeof observedState!=='string')throw new Error('Missing actual predator observation');
  const signals=v.parse(v.object({signals:v.array(v.object({name:v.string()}))}),JSON.parse(observedState));
  console.info(JSON.stringify({story:'native-wolf-fight',checkpointTick,inputs:frames.length,shots:weapons.shots,
    hits:raiders().map(actor=>({id:actor.entityId,before:initial.get(actor.entityId),after:actor.hp})),
    killed:raiders().filter(actor=>!actor.alive).length,sheep:flock.alive,drivenOff:population.raid.drivenOff,signals:signals.signals.map(row=>row.name)}));
}finally{resident.dispose();await replay?.dispose();}
