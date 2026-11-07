// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Assert the actual native command capture and fresh replay.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the shipped native physics bytes.
import {readFileSync} from 'node:fs';
import * as v from 'valibot';
import {beginProductSession} from './productSession';
import {createNativeProofResident} from '../headless-native';
import {prepareHeadlessRuntime} from '../nalati-weapons-native';
import {loadRapier} from '../../../src/shared/engine/physics/rapier';
import {mountedPlayerOf} from '../../../src/server/game/riding/native';
import {runTrustedHeadlessTape,type HeadlessTapeSegment} from '../../../src/shared/host/headlessTape';
import {BladeRowsSchema} from '@wildshard/format/heldMelee';
import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const input=(actorId:string):HeadlessCommand=>({kind:'script',actorId,value:1});
const player=(heavy=false,sprint=false):HeadlessCommand=>({kind:'player',moveX:0,moveZ:0,yaw:0,commandVersion:1,
  steer:{keyX:0,keyY:sprint?1:0,stickX:0,stickY:0},sprint,...(heavy?{heavy:{}}:{})});
const aim=(ads:number):HeadlessCommand=>({kind:'script',actorId:'nalati.weapon.aim',value:ads});
const look=(pitch:number):HeadlessCommand=>({kind:'script',actorId:'nalati.weapon.pitch',value:pitch});
const State=v.object({slot:v.string(),shots:v.number(),bolts:v.number(),fullDraws:v.number(),aimOn:v.boolean(),aimBlend:v.number(),
  moves:v.array(v.string()),passes:v.number(),passDamage:v.number(),thrusts:v.number(),throws:v.number(),ammo:v.number(),
  draw:v.object({drawT:v.number()}),swing:v.object({charging:v.boolean(),chargeT:v.number()}),
  javelins:v.array(v.object({state:v.number()}))});
const session=await beginProductSession('nalati-grasslands','nalati-weapons'),{product,assets}=session;
const replay=await session.ready();
const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
const resident=await createNativeProofResident({shard:product.shardfile,product,assets,rapier},prepareHeadlessRuntime).catch(async(error:unknown)=>{
  await replay.dispose();throw error;
});
const frames:HeadlessCommand[][]=[],marks:{id:string;tick:number;state:string}[]=[];
const step=(commands:readonly HeadlessCommand[]):void=>{frames.push(structuredClone([...commands]));resident.step(commands);};
const advance=(ticks:number,commands:()=>readonly HeadlessCommand[]=()=>[]):void=>{for(let tick=0;tick<ticks;tick++)step(commands());};
const mark=(id:string)=>{
  const owner=resident.host.adapters.get('nalati.weapons');assert.ok(owner);const saved=owner.snapshot();assert.equal(typeof saved,'string');
  if(typeof saved!=='string')throw new Error('Missing native weapon state');marks.push({id,tick:frames.length,state:saved});return v.parse(State,JSON.parse(saved));
};
try{
  const mounted=mountedPlayerOf(resident.host);assert.ok(mounted);
  const blade=v.parse(BladeRowsSchema,await product.json('weapons/sabre.json'));
  advance(60);const initial=mark('initial');assert.equal(initial.slot,'bow');assert.equal(initial.ammo,3);
  advance(12,()=>[player(true)]);step([]);assert.equal(mark('early-release').shots,initial.shots);
  advance(60);advance(60,()=>[aim(1)]);assert.equal(mark('aim').aimOn,true);
  advance(60,()=>[player(true),aim(1)]);assert.equal(mark('full-draw').draw.drawT,1);
  step([aim(1)]);const loose=mark('full-release');assert.equal(loose.shots,initial.shots+1);assert.equal(loose.bolts,initial.bolts-1);
  advance(60);advance(60,()=>[player(true,true)]);step([]);assert.equal(mark('sprint-blocked').shots,loose.shots);
  step([input('nalati.weapon.swap')]);assert.equal(mark('select-sabre').slot,'blade');
  for(let tap=0;tap<3;tap++){step([input('nalati.weapon.attack')]);advance(30);}
  assert.deepEqual(mark('three-hit-combo').moves.slice(0,3),blade.moves.combo.map(move=>move.name));
  advance(60,()=>[player(true)]);assert.equal(mark('heavy-held').swing.charging,true);step([]);advance(60);
  assert.equal(mark('heavy-release').moves.at(-1),blade.moves.heavy.name);
  step([input('nalati.weapon.swap')]);assert.equal(mark('select-spear').slot,'polearm');
  step([input('nalati.weapon.attack')]);advance(30);assert.ok(mark('thrust').thrusts>0);
  step([look(-.45)]);advance(60,()=>[aim(1)]);advance(30,()=>[aim(0)]);
  const thrown=mark('javelin-release');assert.equal(thrown.throws,1);assert.equal(thrown.ammo,initial.ammo-1);
  advance(180);assert.equal(mark('javelin-landed').javelins.some(row=>row.state===1),false);
  // Each swap is the actual next-slot press; no weapon ownership is granted.
  step([input('nalati.weapon.swap')]);assert.equal(mark('swap-back-to-bow').slot,'bow');
  runTrustedHeadlessTape(resident.host,step,()=>resident.effects,{version:1,observe:[],segments:[{id:'walk-to-real-camp-mount',ticks:6000,commands:[],
    route:[{x:20,z:216},{x:40,z:218},{x:60,z:214},{x:66,z:209.5},{x:66,z:211.5},{x:66.8,z:213.4}]}]});
  step([input('nalati.companion.use')]);assert.equal(mounted.mounted,true);mark('mount-real-horse');
  const ridden=mounted.horse;assert.ok(ridden);const riddenHealth=ridden.hp;
  const reins=(forward:number,turn:number,sprint=false):HeadlessCommand=>({kind:'player',moveX:0,moveZ:0,yaw:leadPlayer(resident.host).yaw,
    commandVersion:1,steer:{keyX:0,keyY:forward,stickX:turn,stickY:0},sprint});
  advance(90,()=>[reins(-1,0)]);
  advance(240,()=>{const delta=Math.atan2(Math.sin(mounted.body.heading+Math.PI/2),Math.cos(mounted.body.heading+Math.PI/2));
    return [reins(0,Math.max(-1,Math.min(1,delta*2)))];});
  step([input('nalati.weapon.swap')]);advance(90,()=>[reins(1,0,true)]);
  step([reins(1,0,true),input('nalati.weapon.attack')]);advance(18,()=>[reins(1,0,true)]);
  const pass=mark('mounted-pass');assert.ok(pass.passes>0);assert.ok(pass.passDamage>0);
  assert.ok(blade.moves.passes.left.name===pass.moves.at(-1)||blade.moves.passes.right.name===pass.moves.at(-1));
  assert.equal(mounted.horse,ridden);assert.equal(ridden.hp,riddenHealth,'a mounted pass never raycasts the ridden horse');
  step([input('nalati.companion.use')]);assert.equal(mounted.mounted,false);mark('dismount');
}catch(error){await replay.dispose();throw error;}finally{resident.dispose();}

try{
  const segments:HeadlessTapeSegment[]=[];let start=0;
  for(const recorded of marks){segments.push({id:recorded.id,ticks:recorded.tick-start,commands:[],frames:frames.slice(start,recorded.tick)});start=recorded.tick;}
  const report=await replay.verbTape({version:1,observe:['nalati.weapons'],segments});
  for(const recorded of marks){const observed=report.observations.find(row=>row.id===recorded.id);assert.ok(observed);
    const actual=observed.adapters.find(owner=>owner.id==='nalati.weapons');assert.ok(actual);
    assert.deepEqual(JSON.parse(actual.state),JSON.parse(recorded.state),'fresh real inputs reproduce the complete weapon continuation');
    assert.equal(observed.flags.includes('tamed:horse'),false);
  }
  assert.equal(report.ticks,frames.length);assert.equal(replay.quarantined,false);
  console.info(JSON.stringify({story:'native-weapons',ticks:report.ticks,marks:marks.map(row=>({id:row.id,tick:row.tick}))}));
}finally{await replay.dispose();}
