import { nalatiNativeAssembly } from '../../fixtures/nalati-native-assembly';
// oxlint-disable-next-line import/no-nodejs-modules -- Only real native inputs and owner transitions satisfy this proof.
import assert from 'node:assert/strict';
import * as v from 'valibot';
import {Vector3,PerspectiveCamera} from 'three';
import {HeadlessCloudBody} from '../../../src/server/game/boss/headlessCloudBody';
import {HeldBowFileSchema} from '@wildshard/format/weaponProfiles';
import {WeatherWorldSchema,WindStateSchema} from '@wildshard/format/weatherProgram';
import {heldBowBase} from '../../../src/shared/game/weapons/heldBowBase';
import {bowLaunchSpeed,bowMuzzle,bowMount} from '../../../src/shared/engine/combat/bowLaw';
import {projectileFlightStep} from '../../../src/shared/engine/combat/projectileFlight';
import {Wind} from '../../../src/shared/engine/world/steppeWind';
import {mountedPlayerOf} from '../../../src/server/game/riding/native';
import {nalatiTitanOf} from '../../fixtures/nalati-titan-native';
import {readArenaScriptData} from '../../../src/shared/game/boss/openArenaFight';
import type {SimHost} from '../../../src/server/engine/sim';
import type {ShardFolder} from '../../../src/shared/game/shardfile/shardFolder';
import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import {parseHeldSlots} from '@wildshard/format/heldArms';
import {nalatiPatrolOf} from '../../fixtures/nalati-patrol-native';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

function snapshotValue(owner:{readonly snapshot:()=>unknown}):unknown{
 const wire=owner.snapshot();assert.equal(typeof wire,'string');if(typeof wire!=='string')throw new Error('Missing native combat continuation');
 const value:unknown=JSON.parse(wire);return value;
}

/** Exact input-controller continuation; the native fight/save remains authoritative. */
export interface TitanBowCursor {tick:number;lastShots:number;lastDodge:boolean;currentAim:{yaw:number;pitch:number;flight:number}}

export async function titanBowPilot(product:ShardFolder,host:SimHost,step:(commands:readonly HeadlessCommand[])=>Promise<void>,goal:1|2|3=1,
 continuation?:{readonly cursor?:TitanBowCursor;readonly pauseAfterRetry?:boolean}):Promise<TitanBowCursor|null>{
 const titan=nalatiTitanOf(host),mount=mountedPlayerOf(host);assert.ok(titan);assert.ok(mount);
 if(continuation!==undefined){assert.equal(goal,3);const tick=continuation.cursor?.tick;
  assert.ok(tick===undefined||Number.isSafeInteger(tick)&&tick>=1&&tick<=9600,'the shared pilot bound must not restart');}
 const rows=v.parse(HeldBowFileSchema,await product.json('weapons/bow-page.json')),bow=heldBowBase({bow:rows.bow,base:rows.base});
 const data=await readArenaScriptData(product,{fight:'combat/titan-fight.json',geometry:'combat/titan-geometry.json'});
 const assembly=await nalatiNativeAssembly();
 const weather=v.parse(WeatherWorldSchema,assembly.constants.nativeWeather),actualWind=host.adapters.get(weather.step);assert.ok(actualWind);
 const weapon=host.adapters.get('nalati.weapons');assert.ok(weapon);
 const savedWeapon=()=>v.parse(v.object({draw:v.object({drawT:v.number(),needLift:v.boolean(),tiredT:v.number()}),bolts:v.number(),shots:v.number()}),snapshotValue(weapon));
 const focus=new Vector3(),eye=new Vector3(),sample=new Vector3();
 // A private numerical rig predicts the authored motion for the camera input.
 // Its output is never registered as an actor, contact or combat target.
 const predictedPose={...titan.fight.pose},geometry=data.geometry;
 const predictor=new HeadlessCloudBody({...geometry.body,geometry:{...geometry.body.geometry,eyes:geometry.eyes},poses:geometry.poses,
   puffs:{...geometry.body.puffs,rows:geometry.phone.puffs}},predictedPose,
   new Map([['place',{...data.arena.body,ground:host.groundHeightAt(data.arena.ground.x,data.arena.ground.z)}]]));
 const camera=new PerspectiveCamera();
 let lastShots=continuation?.cursor?.lastShots??0,lastDodge=continuation?.cursor?.lastDodge??false;
 const initialAttempts=titan.boss.attempts;
 const aim=()=>{
  titan.fight.body.focusWorld(focus);eye.copy(leadPlayer(host).position);eye.y+=1.68;
  const actualFocus=focus.clone(),actualPose=JSON.stringify(titan.fight.pose);
  const saddle=bowMount(bow.base,leadPlayer(host).yaw,mount.mounted?{speed:mount.body.speed,yaw:mount.body.heading-Math.PI}:null);assert.ok(saddle);
  const state=v.parse(v.object({wind:WindStateSchema}),actualWind.snapshot()).wind;
  let forecast=focus.distanceTo(eye)/bowLaunchSpeed(bow.base,1),yaw=leadPlayer(host).yaw,pitch=0;
  for(let pass=0;pass<3;pass++){
   Object.assign(predictedPose,titan.fight.pose);predictor.update(host.clock.now+forecast,camera);predictor.focusWorld(focus);
   const delta=focus.clone().sub(eye),distance=Math.hypot(delta.x,delta.z),ux=delta.x/distance,uz=delta.z/distance;
   const trace=(angle:number,elevation:number)=>{
    const air=new Wind({value:1});air.restore(state);
    const direction=new Vector3(-Math.sin(angle)*Math.cos(elevation),Math.sin(elevation),-Math.cos(angle)*Math.cos(elevation));
    const p=eye.clone().addScaledVector(direction,bowMuzzle(bow.base)),velocity=direction.multiplyScalar(bowLaunchSpeed(bow.base,1));
    velocity.x+=saddle.carrier.x;velocity.y+=saddle.carrier.y;velocity.z+=saddle.carrier.z;
    let time=0;
    for(let n=0;n<2880;n++){
     const previous=p.clone(),before=(p.x-eye.x)*ux+(p.z-eye.z)*uz;
     air.update(1/240);projectileFlightStep(p,velocity,1/240,bow.rows.arrow,air.vecAt(p.x,p.z,sample));time+=1/240;
     const after=(p.x-eye.x)*ux+(p.z-eye.z)*uz;
     if(after>=distance){p.lerpVectors(previous,p,(distance-before)/(after-before));break;}
    }
    return {x:(p.x-focus.x)*uz-(p.z-focus.z)*ux,y:p.y-focus.y,time};
   };
   yaw=Math.atan2(-delta.x,-delta.z);pitch=Math.atan2(delta.y+.5*bow.rows.arrow.gravity*(distance/bowLaunchSpeed(bow.base,1))**2,distance);
   for(let n=0;n<7;n++){
    const r=trace(yaw,pitch);if(Math.hypot(r.x,r.y)<.02)break;
    const a=trace(yaw+.001,pitch),b=trace(yaw,pitch+.001),j00=(a.x-r.x)/.001,j01=(b.x-r.x)/.001,j10=(a.y-r.y)/.001,j11=(b.y-r.y)/.001;
    const det=j00*j11-j01*j10;if(Math.abs(det)<1e-6)break;
    yaw-=(r.x*j11-r.y*j01)/det;pitch-=(j00*r.y-j10*r.x)/det;pitch=Math.max(-1.4,Math.min(1.4,pitch));
   }
   forecast=trace(yaw,pitch).time;
  }
  const predictedFocus=focus.clone();titan.fight.body.focusWorld(focus);
  assert.deepEqual(focus.toArray(),actualFocus.toArray(),'aim prediction cannot move the real heart');
  assert.equal(JSON.stringify(titan.fight.pose),actualPose,'aim prediction cannot pose the actual fight');
  focus.copy(predictedFocus);return {yaw,pitch,flight:forecast};
 };
 let currentAim=continuation?.cursor?.currentAim??{yaw:leadPlayer(host).yaw,pitch:0,flight:1};
 for(let tick=continuation?.cursor?.tick??0;tick<9600&&(goal===3?titan.boss.state!=='victory':titan.fight.phase<goal);tick++){
  const clocks=titan.fight.clocks,mode=clocks.value('mode'),time=clocks.value('t'),weapons=savedWeapon();
  if(tick%30===0){titan.fight.body.focusWorld(focus);const p=leadPlayer(host).position,dx=focus.x-p.x,dz=focus.z-p.z;
   currentAim={yaw:Math.atan2(-dx,-dz),pitch:Math.atan2(focus.y-p.y-1.68,Math.hypot(dx,dz)),flight:currentAim.flight};}
  let release=weapons.draw.drawT>=1&&(titan.fight.phase===1||mode===3&&time>.6);
  if(release){currentAim=aim();release=titan.fight.phase===1||time+currentAim.flight<2.75;}
  const held=titan.boss.state==='fight'&&!release&&!weapons.draw.needLift&&weapons.draw.tiredT<=0&&(titan.fight.phase===1||mode!==0||clocks.value('cd')<1.4);
  if(release){console.error(JSON.stringify({stage:'predict-shot',focus:focus.toArray(),...currentAim,mode,time}));}
  const p=leadPlayer(host).position,dx=p.x-data.arena.center.x,dz=p.z-data.arena.center.z,r=Math.max(1,Math.hypot(dx,dz));
  const vx=dz/r-dx/r*(r-40)*.06,vz=-dx/r-dz/r*(r-40)*.06,heading=Math.atan2(vx,vz),turn=Math.atan2(Math.sin(mount.body.heading-heading),Math.cos(mount.body.heading-heading));
  const empty=weapons.bolts===0;
  const dodge=!empty&&mode===1&&time>1.05&&!lastDodge;lastDodge=mode===1&&time>1.05;
  const command:HeadlessCommand={kind:'player',moveX:0,moveZ:0,yaw:currentAim.yaw,commandVersion:1,
    steer:{keyX:0,keyY:0,stickX:empty?0:mount.mounted?Math.max(-1,Math.min(1,turn*2.5)):1,stickY:empty?(mount.mounted&&Math.abs(mount.body.speed)>.05?-.3:0):mount.mounted?1:0},
    ...(!mount.mounted&&dodge?{dodge:true}:{}),...(held?{heavy:{}}:{})};
  await step([command,{kind:'script',actorId:'nalati.weapon.aim',value:1},{kind:'script',actorId:'nalati.weapon.pitch',value:currentAim.pitch}]);
  if(weapons.shots!==lastShots||tick%300===0){lastShots=weapons.shots;console.error(JSON.stringify({stage:'heart-bow',tick:host.state.tick,hp:titan.fight.hp,phase:titan.fight.phase,
   health:leadPlayer(host).health.attributes.health,mounted:mount.mounted,speed:mount.body.speed,bolts:weapons.bolts,shots:weapons.shots,mode,time,at:leadPlayer(host).position.toArray()}));}
  if(titan.boss.state==='armed')await step([{kind:'script',actorId:'nalati.titan.use',value:1}]);
  if(continuation?.pauseAfterRetry===true&&titan.boss.attempts>initialAttempts&&titan.boss.state==='fight'
   &&titan.fight.body.visible&&(tick+1)%30!==0&&savedWeapon().draw.drawT<1)
   return {tick:tick+1,lastShots,lastDodge,currentAim:{...currentAim}};
 }
 if(goal===3)assert.equal(titan.boss.state,'victory','actual contacts must win');else assert.equal(titan.fight.phase,goal,'natural arrows must earn the next phase');
 console.error(JSON.stringify({stage:'heart-phase-earned',tick:host.state.tick,hp:titan.fight.hp}));
 return null;
}

export async function titanRidersPilot(product:ShardFolder,host:SimHost,step:(commands:readonly HeadlessCommand[])=>Promise<void>):Promise<void>{
 const titan=nalatiTitanOf(host),mount=mountedPlayerOf(host),patrol=nalatiPatrolOf(host);assert.ok(titan);assert.ok(mount);assert.ok(patrol);
 const slots=parseHeldSlots(await product.json('held/slots.json')),blade=slots.slots.find(row=>row.kind==='blade');assert.ok(blade);
 const equipment=host.adapters.get('nalati.weapons'),encounter=host.adapters.get('nalati.titan');assert.ok(equipment);assert.ok(encounter);
 const weapon=()=>v.parse(v.object({slot:v.string(),blade:v.object({contacts:v.number()})}),snapshotValue(equipment));
 const support=()=>v.parse(v.object({support:v.array(v.tuple([v.number(),v.string()]))}),snapshotValue(encounter)).support;
 const head=new Vector3(),horse=mount.horse;assert.ok(horse);
 for(let tick=0;tick<60&&mount.mounted;tick++)await step([{kind:'player',moveX:0,moveZ:0,yaw:leadPlayer(host).yaw,commandVersion:1,steer:{keyX:0,keyY:0,stickX:0,stickY:-.3}}]);
 if(mount.mounted)await step([{kind:'script',actorId:'nalati.companion.use',value:1}]);
 assert.equal(mount.mounted,false);
 for(let swap=0;swap<slots.registration.length&&weapon().slot!==blade.id;swap++)await step([{kind:'script',actorId:'nalati.weapon.swap',value:1}]);
 assert.equal(weapon().slot,blade.id);
 let lastContacts=weapon().blade.contacts;
 for(let tick=0;tick<6000&&titan.fight.phase===1;tick++){
  const saved=support(),bodies=saved.map(([,id])=>{const body=patrol.law.riders.find(row=>row.a.entityId===id)?.a;
    assert.ok(body);assert.equal(host.entities.get(id),body);return body;}).filter(body=>body.alive);
  bodies.sort((a,b)=>a.position.distanceToSquared(leadPlayer(host).position)-b.position.distanceToSquared(leadPlayer(host).position));
  const target=bodies[0];
  if(target===undefined){if(saved.length===0)break;await step([]);continue;}
  if(mount.mounted){await step([{kind:'script',actorId:'nalati.companion.use',value:1}]);continue;}
  const at=leadPlayer(host).position,dx=target.position.x-at.x,dz=target.position.z-at.z,d=Math.max(.01,Math.hypot(dx,dz));
  patrol.aimPoint(target,head);
  await step([{kind:'player',moveX:0,moveZ:0,yaw:Math.atan2(-dx,-dz),commandVersion:1,sprint:d>7,
   steer:{keyX:0,keyY:0,stickX:d<3?.25:0,stickY:d>2?1:0},...(tick%120===100?{dodge:true}: {})},
   {kind:'script',actorId:'nalati.weapon.pitch',value:Math.atan2(head.y-at.y-1.68,d)},
   ...(tick%24===0?[{kind:'script' as const,actorId:'nalati.weapon.attack',value:1}]:[])]);
  const hits=weapon().blade.contacts;
  if(tick%120===0||hits!==lastContacts){lastContacts=hits;console.error(JSON.stringify({stage:'support-melee',tick:host.state.tick,health:leadPlayer(host).health.attributes.health,
    boss:titan.boss.state,phase:titan.fight.phase,hp:titan.fight.hp,at:leadPlayer(host).position.toArray(),contacts:hits,
    riders:bodies.map(body=>({id:body.entityId,hp:body.hp,distance:body.position.distanceTo(leadPlayer(host).position)}))}));}
 }
 assert.equal(support().length,0,'three actual support deaths must break the dome');
 for(let tick=0;tick<60&&titan.fight.shielded;tick++)await step([]);
 assert.equal(titan.fight.shielded,false);
 await step([{kind:'script',actorId:'nalati.whistle',value:1}]);
 for(let tick=0;tick<1800&&!mount.mounted;tick++){
  const at=leadPlayer(host).position,dx=horse.position.x-at.x,dz=horse.position.z-at.z,d=Math.hypot(dx,dz);
  await step([{kind:'player',moveX:0,moveZ:0,yaw:Math.atan2(-dx,-dz),commandVersion:1,steer:{keyX:0,keyY:0,stickX:0,stickY:d>1.5?1:0}},
    ...(d<4?[{kind:'script' as const,actorId:'nalati.companion.use',value:1}]:[])]);
 }
 assert.equal(mount.mounted,true,'real approach and USE must remount the same borrowed horse');
 const bow=slots.slots.find(row=>row.kind==='bow');assert.ok(bow);
 for(let swap=0;swap<slots.registration.length&&weapon().slot!==bow.id;swap++)await step([{kind:'script',actorId:'nalati.weapon.swap',value:1}]);
 assert.equal(weapon().slot,bow.id);
}
