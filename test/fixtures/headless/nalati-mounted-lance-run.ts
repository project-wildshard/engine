// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Assert real mounted contact and independent native replay.
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import * as v from 'valibot';
import {decodeSimSnapshot,snapshotSimHost,serializeSimSnapshot} from '../../../src/shared/engine/sim/snapshot';
import {canonicalSimDigest} from '../../fake/simState';
import {parseHeldSlots} from '@wildshard/format/heldArms';
import {PolearmRowsSchema} from '@wildshard/format/heldMelee';
import type {HeadlessCommand,HeadlessEffect,HeadlessTapePartReport} from '../../../src/shared/host/tickProtocol';
import {beginProductSession} from './productSession';
import {checkedReplayPipeline} from './checkedReplayPipeline';
import {earnNalatiMountedRaid} from './nalati-mounted-raid';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const State=v.object({slot:v.string(),thrusts:v.number(),throws:v.number(),ammo:v.number(),
  polearm:v.object({lanceActive:v.boolean(),rehit:v.array(v.tuple([v.string(),v.number()]))})});
console.info(JSON.stringify({phase:'mounted-approach-start'}));
const {resident,product,mount,pack,ridden,riddenHealth,move,reins}=await earnNalatiMountedRaid();
let replay:Awaited<ReturnType<Awaited<ReturnType<typeof beginProductSession>>['ready']>>|undefined;
let stopReplay:(()=>Promise<void>)|undefined;
try{
  const host=resident.host,slots=parseHeldSlots(await product.json('held/slots.json'));
  const slot=slots.slots.find(row=>row.kind==='polearm');assert.ok(slot);assert.equal(slot.kind,'polearm');
  if(slot.kind!=='polearm')throw new Error('Missing actual mounted spear');
  const spear=v.parse(PolearmRowsSchema,await product.json(slot.file));
  const bodies=new Map(pack.members.map(actor=>[actor.entityId,actor])),before=new Map(pack.members.map(actor=>[actor.entityId,actor.hp]));
  assert.ok(bodies.size>0);
  const checkpoint=serializeSimSnapshot(snapshotSimHost(host)),checkpointTick=host.state.tick;
  console.info(JSON.stringify({phase:'mounted-approach-done',tick:checkpointTick}));
  const pending=await beginProductSession('nalati-grasslands','nalati-predators',checkpoint);replay=await pending.ready();const worker=replay;
  const owner=host.adapters.get('nalati.weapons');assert.ok(owner);
  const read=()=>{const raw=owner.snapshot();assert.equal(typeof raw,'string');if(typeof raw!=='string')throw new Error('Missing actual lance continuation');return v.parse(State,JSON.parse(raw));};
  const initial=read(),frames:HeadlessCommand[][]=[];
  const initialHits=new Map(initial.polearm.rehit);
  interface Part {start:number;tick:number;digest:string;effects:HeadlessEffect[]}
  interface Contact {id:string;tick:number;stamp:number;speed:number;before:number;after:number}
  const parts:Part[]=[],effects:HeadlessEffect[]=[];
  let offset=0,replayed=0,contact:Contact|undefined,middle:string|undefined;
  const pipeline=checkedReplayPipeline<Part>(async part=>{
    const chunk=frames.slice(part.start,part.tick),started=performance.now();
    const result=await worker.verbTapePart({version:1,observe:['nalati.weapons','nalati.predators'],segments:[
      {id:`mounted-lance-${part.tick}`,ticks:chunk.length,commands:[],frames:chunk},
    ]});
    assert.equal(result.report.ticks,chunk.length);assert.equal(result.commit.tick,checkpointTick+part.tick);
    assert.equal(canonicalSimDigest(decodeSimSnapshot(result.commit.snapshot)),part.digest,'fresh real inputs match every native body, HP and weapon cursor');
    assert.deepEqual(result.report.observations[0]?.effects,part.effects,'fresh replay retains all contact and wildlife effects in source order');
    replayed+=result.report.ticks;
    console.info(JSON.stringify({phase:'lance-replay-part',ticks:chunk.length,tick:result.commit.tick,milliseconds:performance.now()-started}));
  });stopReplay=pipeline.stop;
  const flush=async():Promise<void>=>{
    if(offset===frames.length)return;
    assert.ok(frames.length-offset<=512);
    const part={start:offset,tick:frames.length,digest:canonicalSimDigest(snapshotSimHost(host)),effects:effects.splice(0)};parts.push(part);
    await pipeline.offer(part);offset=frames.length;
  };
  const step=async(commands:readonly HeadlessCommand[]):Promise<void>=>{
    pipeline.check();frames.push(structuredClone([...commands]));move(commands);effects.push(...structuredClone(resident.effects));
    const saved=read();
    if(contact===undefined){
      const accepted=saved.polearm.rehit.find(([id,stamp])=>bodies.has(id)&&stamp!==initialHits.get(id));
      if(accepted!==undefined){
        const body=bodies.get(accepted[0]),hp=before.get(accepted[0]);assert.ok(body);assert.ok(hp!==undefined&&hp>0);
        assert.equal(saved.polearm.lanceActive,true);assert.ok(mount.body.speed>=spear.profile.lance.minSpeed);
        assert.ok(body.hp<hp,'the accepted native contact must damage the original living raider');
        contact={id:accepted[0],tick:frames.length,stamp:accepted[1],speed:mount.body.speed,before:hp,after:body.hp};
        middle=serializeSimSnapshot(snapshotSimHost(host));await flush();
        console.info(JSON.stringify({phase:'actual-lance-contact',...contact}));
      }
    }
    if(frames.length-offset>=512)await flush();
  };
  // Two ordinary next-slot presses: the admitted bow -> sabre -> spear order.
  await step([{kind:'script',actorId:'nalati.weapon.swap',value:1}]);
  await step([{kind:'script',actorId:'nalati.weapon.swap',value:1}]);assert.equal(read().slot,slot.id);
  const rear=new Vector3(),front=new Vector3(),aimPoint=new Vector3(),lookLimit=Math.PI*140/180;
  for(let tick=0;tick<3600;tick++){
    if(contact!==undefined)break;
    const p=leadPlayer(host).position,target=pack.members.filter(actor=>actor.alive).sort((a,b)=>a.position.distanceToSquared(p)-b.position.distanceToSquared(p))[0];assert.ok(target);
    const dx=target.position.x-p.x,dz=target.position.z-p.z,distance=Math.hypot(dx,dz),direct=Math.atan2(dx,dz);
    // A lance strikes inside its cone at speed, so the pilot rides straight at the raider, sprints to catch it and never slows for it.
    const delta=Math.atan2(Math.sin(mount.body.heading-direct),Math.cos(mount.body.heading-direct));
    const brake=Math.abs(delta)>.9&&Math.abs(mount.body.speed)>3;
    target.bodyCapsule(rear,front);aimPoint.addVectors(rear,front).multiplyScalar(.5);
    const aimDx=aimPoint.x-p.x,aimDz=aimPoint.z-p.z,base=mount.body.heading-Math.PI;
    const look=Math.atan2(Math.sin(Math.atan2(-aimDx,-aimDz)-base),Math.cos(Math.atan2(-aimDx,-aimDz)-base));
    await step([reins(brake?-.8:Math.abs(delta)>.9?0:distance<6?.85:1,brake?0:Math.max(-1,Math.min(1,delta*2.5)),!brake&&distance>=3,false,base+Math.max(-lookLimit,Math.min(lookLimit,look))),
      {kind:'script',actorId:'nalati.weapon.pitch',value:Math.atan2(aimPoint.y-p.y-1.68,Math.hypot(aimDx,aimDz))}]);
  }
  const landed=contact;assert.ok(landed);assert.ok(middle);
  for(let tick=0;tick<12;tick++)await step([reins(0,0)]);
  const final=read();assert.equal(final.thrusts,initial.thrusts);assert.equal(final.throws,initial.throws);assert.equal(final.ammo,initial.ammo);
  assert.equal(final.polearm.rehit.find(([id])=>id===landed.id)?.[1],landed.stamp,'the spent contact retains its original rehit clock');
  assert.equal(mount.horse,ridden);assert.equal(ridden.hp,riddenHealth);assert.equal(leadPlayer(host).health.alive,true);
  assert.ok(frames.every(frame=>frame.every(command=>command.kind==='player'&&command.attack===undefined&&command.heavy===undefined||command.kind==='script'&&
    (command.actorId==='nalati.weapon.swap'||command.actorId==='nalati.weapon.pitch'))),'the input tape cannot request attacks, hits, damage or throws');
  await flush();await pipeline.finish();assert.equal(replayed,frames.length);assert.equal(replay.quarantined,false);
  await replay.dispose();replay=undefined;
  const restored=await beginProductSession('nalati-grasslands','nalati-predators',middle);replay=await restored.ready();
  let suffix=0;
  for(const part of parts.filter(row=>row.tick>landed.tick)){
    assert.equal(part.start,landed.tick+suffix);
    const chunk=frames.slice(part.start,part.tick);
    const result:HeadlessTapePartReport=await replay.verbTapePart({version:1,observe:['nalati.weapons','nalati.predators'],segments:[
      {id:`continue-lance-${part.tick}`,ticks:chunk.length,commands:[],frames:chunk},
    ]});
    assert.equal(result.report.ticks,chunk.length);assert.equal(result.commit.tick,checkpointTick+part.tick);
    assert.equal(canonicalSimDigest(decodeSimSnapshot(result.commit.snapshot)),part.digest,'earned post-contact restoration retains the exact native suffix');
    assert.deepEqual(result.report.observations[0]?.effects,part.effects);suffix+=result.report.ticks;
  }
  assert.equal(suffix,frames.length-landed.tick);assert.equal(replay.quarantined,false);
  console.info(JSON.stringify({story:'native-mounted-lance',approach:checkpointTick,inputs:frames.length,parts:parts.length,contact:landed,ammo:final.ammo,riddenHealth}));
}finally{await stopReplay?.();resident.dispose();await replay?.dispose();}
