// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Assert actual native contacts and independent replay.
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import * as v from 'valibot';
import {decodeSimSnapshot,snapshotSimHost,serializeSimSnapshot} from '../../../src/shared/engine/sim/snapshot';
import {canonicalSimDigest} from '../../fake/simState';
import {BladeRowsSchema} from '@wildshard/format/heldMelee';
import {MeleeWeaponProfileSchema} from '@wildshard/format/weaponProfiles';
import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import {beginProductSession} from './productSession';
import {checkedReplayPipeline} from './checkedReplayPipeline';
import {earnNalatiMountedRaid} from './nalati-mounted-raid';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const State=v.object({passes:v.number(),moves:v.array(v.string()),pass:v.object({passChain:v.number(),chainT:v.number()}),
  blade:v.object({contacts:v.number(),struck:v.array(v.string())})});
const {resident,product,mount,pack,ridden,riddenHealth,move,reins}=await earnNalatiMountedRaid();
let replay:Awaited<ReturnType<Awaited<ReturnType<typeof beginProductSession>>['ready']>>|undefined;
let stopReplay:(()=>Promise<void>)|undefined;
try{
  const host=resident.host;
  const blade=v.parse(BladeRowsSchema,await product.json('weapons/sabre.json'));
  const item=product.shardfile.items.rows.find(row=>row.id==='weapon.sabre');assert.equal(item?.kind,'weapon');
  if(item?.kind!=='weapon')throw new Error('Missing actual mounted sabre profile');
  const profile=v.parse(MeleeWeaponProfileSchema,item.profile),passes=[blade.moves.passes.left,blade.moves.passes.right];
  const passReach=Math.min(...passes.map(row=>row.reach??profile.reach)),passWindup=Math.min(...passes.map(row=>row.windup));
  const lookLimit=Math.PI*140/180; // The page mount's ordinary look limit, not its breaking limit.
  const rear=new Vector3(),front=new Vector3(),aimPoint=new Vector3();
  const before=new Map([...host.entities.values()].map(actor=>[actor.entityId,{kind:actor.kind,hp:actor.hp}]));
  const checkpoint=serializeSimSnapshot(snapshotSimHost(host)),checkpointTick=host.state.tick;
  const pending=await beginProductSession('nalati-grasslands','nalati-predators',checkpoint);replay=await pending.ready();const worker=replay;
  const owner=host.adapters.get('nalati.weapons');assert.ok(owner);
  const read=()=>{const raw=owner.snapshot();assert.equal(typeof raw,'string');if(typeof raw!=='string')throw new Error('Missing native mounted weapon state');return v.parse(State,JSON.parse(raw));};
  const frames:HeadlessCommand[][]=[],contacts:{tick:number;struck:string[]}[]=[];
  interface Part {start:number;tick:number;digest:string}
  const parts:Part[]=[];let offset=0,replayed=0,middle:string|undefined,middleTick=0,contactCount=0;
  const pipeline=checkedReplayPipeline<Part>(async part=>{
    const chunk=frames.slice(part.start,part.tick),result=await worker.verbTapePart({version:1,observe:['nalati.weapons','nalati.predators'],segments:[
      {id:`mounted-chain-${part.tick}`,ticks:chunk.length,commands:[],frames:chunk},
    ]});
    assert.equal(result.report.ticks,chunk.length);assert.equal(result.commit.tick,checkpointTick+part.tick);
    assert.equal(canonicalSimDigest(decodeSimSnapshot(result.commit.snapshot)),part.digest,'fresh mounted input reproduces every native body, hit and weapon cursor');
    replayed+=result.report.ticks;
  });stopReplay=pipeline.stop;
  const flush=async():Promise<void>=>{
    if(offset===frames.length)return;
    assert.ok(frames.length-offset<=512);
    const part={start:offset,tick:frames.length,digest:canonicalSimDigest(snapshotSimHost(host))};parts.push(part);
    await pipeline.offer(part);offset=frames.length;
  };
  const step=async(commands:readonly HeadlessCommand[]):Promise<void>=>{
    pipeline.check();frames.push(structuredClone([...commands]));move(commands);
    const saved=read();
    if(saved.blade.contacts>contactCount){contacts.push({tick:frames.length,struck:[...saved.blade.struck]});contactCount=saved.blade.contacts;}
    if(middle===undefined&&saved.pass.passChain===1){middle=serializeSimSnapshot(snapshotSimHost(host));middleTick=frames.length;await flush();}
    if(frames.length-offset>=512)await flush();
  };
  await step([{kind:'script',actorId:'nalati.weapon.swap',value:1}]);
  for(let tick=0;tick<3600&&read().pass.passChain<2;tick++){
    const p=leadPlayer(host).position,target=pack.members.filter(actor=>actor.alive).sort((a,b)=>a.position.distanceToSquared(p)-b.position.distanceToSquared(p))[0];assert.ok(target);
    const dx=target.position.x-p.x,dz=target.position.z-p.z,distance=Math.hypot(dx,dz),direct=Math.atan2(dx,dz);
    const heading=Math.atan2(target.position.x+Math.cos(direct)*1.6-p.x,target.position.z-Math.sin(direct)*1.6-p.z);
    const delta=Math.atan2(Math.sin(mount.body.heading-heading),Math.cos(mount.body.heading-heading));
    const brake=(Math.abs(delta)>.9||distance<2.5)&&Math.abs(mount.body.speed)>3;
    target.bodyCapsule(rear,front);aimPoint.addVectors(rear,front).multiplyScalar(.5);
    const aimDx=aimPoint.x-p.x,aimDz=aimPoint.z-p.z,gap=Math.hypot(aimDx,aimPoint.y-p.y-1.68,aimDz);
    const vx=mount.rider.velocity.x-Math.sin(target.yaw)*target.speed,vz=mount.rider.velocity.z-Math.cos(target.yaw)*target.speed;
    const closing=Math.max(0,(vx*dx+vz*dz)/Math.max(distance,.001)),pressRange=passReach+target.dims.bodyRadius*target.scale+closing*passWindup;
    const base=mount.body.heading-Math.PI,look=Math.atan2(Math.sin(Math.atan2(-aimDx,-aimDz)-base),Math.cos(Math.atan2(-aimDx,-aimDz)-base));
    // A pass slash sweeps its own side of the view and misses what sits at the centre, so the rider holds the wolf out on that side.
    const side=dx*Math.cos(base)-dz*Math.sin(base)>=0?1:-1;
    const commands:HeadlessCommand[]=[reins(brake?-.8:Math.abs(delta)>.9?0:distance<6?.85:1,brake?0:Math.max(-1,Math.min(1,delta*2.5)),!brake&&distance>=4,false,base+Math.max(-lookLimit,Math.min(lookLimit,look))+.7*side),
      {kind:'script',actorId:'nalati.weapon.pitch',value:Math.atan2(aimPoint.y-p.y-1.68,Math.hypot(aimDx,aimDz))}];
    if(gap<=pressRange&&Math.abs(look)<=lookLimit&&tick%10===0)commands.push({kind:'script',actorId:'nalati.weapon.attack',value:1});
    await step(commands);
  }
  assert.ok(read().pass.passChain>=2,'only actual accepted mounted contacts earn a two-hit chain');assert.ok(middle);
  for(let tick=0;tick<12;tick++)await step([reins(0,0)]);
  assert.ok(read().pass.passChain>=2);assert.ok(read().pass.chainT>0);assert.ok(read().blade.contacts>=2);assert.ok(contacts.length>=2);
  assert.equal(mount.horse,ridden);assert.equal(ridden.hp,riddenHealth,'the actual ridden horse is never struck');
  for(const contact of contacts)for(const id of contact.struck){assert.ok(before.has(id));assert.ok(host.entities.get(id));}
  const damage=[...host.entities.values()].filter(actor=>actor.hp<(before.get(actor.entityId)?.hp??actor.hp))
    .map(actor=>({id:actor.entityId,kind:actor.kind,before:before.get(actor.entityId)?.hp,after:actor.hp}));
  assert.ok(damage.length>0,'the chain must accompany real native damage, never synthetic hit messages');
  await flush();await pipeline.finish();assert.equal(replayed,frames.length);assert.equal(replay.quarantined,false);
  await replay.dispose();replay=undefined;
  const restored=await beginProductSession('nalati-grasslands','nalati-predators',middle);replay=await restored.ready();
  let suffix=0;
  for(const part of parts.filter(row=>row.tick>middleTick)){
    assert.equal(part.start,middleTick+suffix);
    const chunk=frames.slice(part.start,part.tick),result=await replay.verbTapePart({version:1,observe:['nalati.weapons','nalati.predators'],segments:[
      {id:`continue-chain-${part.tick}`,ticks:chunk.length,commands:[],frames:chunk},
    ]});
    assert.equal(result.report.ticks,chunk.length);assert.equal(result.commit.tick,checkpointTick+part.tick);
    assert.equal(canonicalSimDigest(decodeSimSnapshot(result.commit.snapshot)),part.digest,'an earned one-hit checkpoint continues the same contacts and chain');suffix+=result.report.ticks;
  }
  assert.equal(suffix,frames.length-middleTick);assert.equal(replay.quarantined,false);
  console.info(JSON.stringify({story:'native-mounted-chain',approach:checkpointTick,inputs:frames.length,parts:parts.length,middleTick,contacts,chain:read().pass,damage}));
}finally{await stopReplay?.();resident.dispose();await replay?.dispose();}
