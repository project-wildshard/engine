// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Assert real movement and fresh native replay.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Use the admitted repository physics bytes.
import {readFileSync} from 'node:fs';
import * as v from 'valibot';
import {loadRapier} from '../../../src/shared/engine/physics/rapier';
import {snapshotSimHost,serializeSimSnapshot} from '../../../src/shared/engine/sim/snapshot';
import {runTrustedHeadlessTape} from '../../../src/shared/host/headlessTape';
import {StealthRowsSchema} from '@wildshard/format/stealth';
import type {HeadlessCommand,HeadlessEffect} from '../../../src/shared/host/tickProtocol';
import {createNativeProofResident} from '../headless-native';
import {prepareHeadlessRuntime} from '../nalati-stealth-native';
import {beginProductSession} from './productSession';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const session=await beginProductSession('nalati-grasslands','nalati-stealth'),{product,assets}=session;
const hiddenCover=v.parse(v.number(),v.parse(StealthRowsSchema,product.section('player/stealth')).tuning['hiddenCover']);
let replay:Awaited<ReturnType<typeof session.ready>>|undefined;
const resident=await createNativeProofResident({product,assets,shard:product.shardfile,
  rapier:await loadRapier(readFileSync('public/assets/physics/rapier.wasm'))},prepareHeadlessRuntime).catch(async(error:unknown)=>{
  const worker=await session.ready();await worker.dispose();throw error;
});
const State=v.object({law:v.object({state:v.string(),cover:v.number(),canCrouch:v.boolean(),latched:v.boolean()}),
  hints:v.number(),hint:v.string(),label:v.string(),crouching:v.boolean(),grass:v.number()});
const frames:HeadlessCommand[][]=[],effects:HeadlessEffect[]=[];
const player=(fields:{crouch?:boolean;sprint?:boolean;forward?:number;jump?:true}={}):HeadlessCommand=>({kind:'player',moveX:0,moveZ:0,yaw:0,commandVersion:1,
  steer:{keyX:0,keyY:fields.forward??0,stickX:0,stickY:0},...(fields.crouch===undefined?{}:{crouch:fields.crouch}),
  ...(fields.sprint===undefined?{}:{sprint:fields.sprint}),...(fields.jump===undefined?{}:{jump:fields.jump})});
try{
  const owner=resident.host.adapters.get('nalati.stealth');assert.ok(owner);
  const state=()=>{const saved=owner.snapshot();assert.equal(typeof saved,'string');if(typeof saved!=='string')throw new Error('Missing native stealth state');return v.parse(State,JSON.parse(saved));};
  const step=(commands:readonly HeadlessCommand[]):void=>{
    const actual=commands.map(command=>{
      if(command.kind!=='player'||command.commandVersion===1)return command;
      const c=Math.cos(command.yaw),s=Math.sin(command.yaw),clamp=(n:number)=>Math.max(-1,Math.min(1,n));
      return {...command,commandVersion:1 as const,steer:{keyX:0,keyY:0,stickX:clamp(command.moveX*c-command.moveZ*s),stickY:clamp(-command.moveX*s-command.moveZ*c)}};
    });
    frames.push(structuredClone(actual));resident.step(actual);effects.push(...structuredClone(resident.effects));
  };
  const advance=(ticks:number,commands:readonly HeadlessCommand[]=[]):void=>{for(let tick=0;tick<ticks;tick++)step(commands);};
  advance(60);assert.equal(state().grass,0);assert.equal(state().law.canCrouch,false);assert.equal(state().hints,0);
  runTrustedHeadlessTape(resident.host,step,()=>resident.effects,{version:1,observe:[],segments:[{id:'walk-through-camp-gate-to-grass',ticks:3600,commands:[],
    route:[{x:20,z:216},{x:40,z:218},{x:60,z:214},{x:66,z:209.5},{x:60,z:205},{x:45,z:205},{x:34,z:198}]}]});
  advance(60);assert.equal(state().law.canCrouch,true);assert.equal(state().label,'Visible');assert.equal(state().hints,1);
  step([{kind:'script',actorId:'nalati.stealth.toggle',value:1}]);advance(12);
  assert.equal(state().law.latched,true,'the actual crouch disc latches the admitted owner');
  step([player({jump:true})]);advance(90);assert.equal(state().law.latched,false,'a real jump cancels the latch');
  advance(180,[player({crouch:true})]);const hidden=state();assert.equal(hidden.crouching,true);assert.equal(hidden.label,'Hidden');
  assert.ok(hidden.law.cover>=hiddenCover);assert.equal(hidden.hints,1);assert.equal(leadPlayer(resident.host).health.alive,true);
  const checkpoint=serializeSimSnapshot(snapshotSimHost(resident.host)),checkpointTick=frames.length;
  advance(60,[player()]);assert.equal(state().label,'Visible');
  runTrustedHeadlessTape(resident.host,step,()=>resident.effects,{version:1,observe:[],segments:[{id:'leave-real-grass-through-gate',ticks:2400,commands:[],
    route:[{x:45,z:205},{x:60,z:205},{x:66,z:209.5}]}]});
  advance(120);assert.equal(state().law.canCrouch,false);assert.equal(state().law.state,'none');assert.equal(state().hints,1);
  assert.equal(effects.filter(effect=>effect.kind==='hint'&&effect.text===hidden.hint).length,1,'only real entry into grass raises the one-time hint');
  const suffix=frames.slice(checkpointTick),report=runTrustedHeadlessTape(resident.host,commands=>resident.step(commands),()=>resident.effects,
    {version:1,observe:['nalati.stealth'],segments:[{id:'after-stealth-walk',ticks:1,commands:[]}]});
  replay=await session.ready();
  const repeated=await replay.verbTape({version:1,observe:['nalati.stealth'],segments:[
    {id:'captured-stealth-inputs',ticks:frames.length,commands:[],frames},{id:'after-stealth-walk',ticks:1,commands:[]},
  ]});
  assert.deepEqual(repeated.observations.at(-1),report.observations[0],'fresh inputs reproduce grass, threats, crouch state, latch and one-time hint');
  await replay.dispose();replay=undefined;
  const restored=await beginProductSession('nalati-grasslands','nalati-stealth',checkpoint);replay=await restored.ready();
  const continuation=await replay.verbTape({version:1,observe:['nalati.stealth'],segments:[
    {id:'release-and-leave-grass',ticks:suffix.length,commands:[],frames:suffix},{id:'after-stealth-walk',ticks:1,commands:[]},
  ]});
  assert.deepEqual(continuation.observations.at(-1),report.observations[0],'an earned hidden checkpoint retains projected cadence, pending inputs and hint history');
  assert.equal(replay.quarantined,false);
  console.info(JSON.stringify({story:'native-stealth',inputs:frames.length,checkpointTick,cover:hidden.law.cover,hints:state().hints}));
}finally{resident.dispose();replay??=await session.ready();await replay.dispose();}
