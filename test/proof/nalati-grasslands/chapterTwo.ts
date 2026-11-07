// oxlint-disable-next-line import/no-nodejs-modules -- Every chapter edge requires its genuinely earned original owner.
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import type {SimHost} from '../../../src/server/engine/sim';
import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import {mountedPlayerOf} from '../../../src/server/game/riding/native';
import {nativeTamingOf} from '../../../src/server/game/riding/nativeTaming';
import type {parseHeldSlots} from '@wildshard/format/heldArms';
import type {heldBowBase} from '../../../src/shared/game/weapons/heldBowBase';
import {bowLaunchSpeed} from '../../../src/shared/engine/combat/bowLaw';
import {DRAW_TIME,RENOCK_TIME} from '../../../src/shared/engine/combat/bowDraw';
import {FIXED_STEP} from '../../../src/shared/engine/core/fixedStep';
import {ARROW_RADIUS} from '../../../src/shared/engine/combat/projectileLaw';
import {worldHit} from '../../../src/shared/engine/physics/query';
import {SKY_ROAD} from '../../../src/shards/nalati-grasslands/generators/layout';
import {nalatiBalbalsOf} from '../../fixtures/nalati-balbal-native';
import {readNalatiWeaponObservation,type NalatiWeaponObservation} from '../../fixtures/nalati-weapon-observation';
import {nalatiChapterPresentationOf} from '../../fixtures/nalati-chapter-presentation';
import {chapterWalkInputs,chapterRideInputs} from './chapterOne';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

/** Leave the completed first reading and accept only the actual next elder
 * dialogue, then ride the earned horse to the real carving field. */
export function* chapterCarvingRoadInputs(host:SimHost):Generator<readonly HeadlessCommand[]> {
  assert.ok(host.flags.has('quest:tulpar'));assert.equal(host.flags.has('talked:elder:2'),false);
  yield [{kind:'script',actorId:'nalati.talk',value:-1}];
  for(let tick=0;tick<600&&!host.flags.has('talked:elder:2');tick++)yield tick%16===0?[{kind:'script',actorId:'nalati.talk',value:0}]:[];
  assert.ok(host.flags.has('talked:elder:2'));
  yield [{kind:'script',actorId:'nalati.talk',value:-1}];
  for(let tick=0;tick<60&&host.quests.find(row=>row.def.id==='golden-king')?.current?.id!=='clues';tick++)yield [];
  assert.equal(host.quests.find(row=>row.def.id==='golden-king')?.current?.id,'clues');
  yield* chapterWalkInputs(host,'return-to-earned-horse',[
    {x:86.6,z:219.5},{x:91,z:216},{x:94,z:210},{x:95,z:204},{x:88,z:204.5},{x:84.8,z:203.8},{x:83,z:206},
    {x:73,z:206.1},{x:66,z:209.5},{x:63,z:212},
  ],3600);
  const mount=mountedPlayerOf(host),taming=nativeTamingOf(host);assert.ok(mount);assert.ok(taming?.companion);
  const horse=taming.companion;
  for(let tick=0;tick<600&&!mount.mounted;tick++){
    const p=leadPlayer(host).position,dx=horse.position.x-p.x,dz=horse.position.z-p.z,d=Math.hypot(dx,dz),yaw=Math.atan2(-dx,-dz);
    yield [{kind:'player',moveX:d>2.5?dx/d:0,moveZ:d>2.5?dz/d:0,yaw},
      ...(d<3.2&&tick%20===0?[{kind:'script' as const,actorId:'nalati.ride',value:1}]:[])];
  }
  assert.equal(mount.mounted,true);assert.equal(mount.horse,horse);
  const road:readonly (readonly[number,number])[]=[[60,214],[40,218],[20,216],[0,216],[0,205],[0,190],[0,170],[0,158],
    [0,147],[1,146],[23,146],[27,142],[39,141],[53,139],[57,136],[57,134],[40,133],
    ...SKY_ROAD.slice(4)];
  for(const [x,z]of road)yield* chapterRideInputs(host,x,z);
  assert.equal(mount.mounted,true);assert.equal(mount.horse,horse);
  assert.ok(Math.hypot(leadPlayer(host).position.x-120,leadPlayer(host).position.z-70)<2.5);
  assert.equal(host.flags.has('clue:1'),false);assert.equal(host.flags.has('entered:kurgan'),false);
}
/** Continue from the actually ridden rim; each original field leg has its
 * own fresh cursor, with the same horse and native carrying momentum. */
export function* chapterCarvingArrivalInputs(host:SimHost,fromRoad=false):Generator<readonly HeadlessCommand[]> {
  if(!fromRoad)yield* chapterCarvingRoadInputs(host);
  const mount=mountedPlayerOf(host),taming=nativeTamingOf(host);assert.ok(mount);assert.ok(taming?.companion);
  assert.equal(mount.mounted,true);assert.equal(mount.horse,taming.companion);
  assert.ok(Math.hypot(leadPlayer(host).position.x-120,leadPlayer(host).position.z-70)<2.5);
  assert.equal(host.quests.find(row=>row.def.id==='golden-king')?.current?.id,'clues');
  for(const [x,z]of [[95,65],[65,55],[20,40],[-20,54],[-60,70],[-83,81],[-103,83]]){
    assert.ok(x!==undefined&&z!==undefined);yield* chapterRideInputs(host,x,z);
  }
  for(let tick=0;tick<120&&Math.abs(mount.body.speed)>.2;tick++)yield [{kind:'player',moveX:0,moveZ:0,yaw:leadPlayer(host).yaw,commandVersion:1,
    steer:{keyX:0,keyY:0,stickX:0,stickY:-1}}];
  yield [{kind:'script',actorId:'nalati.ride',value:2}];assert.equal(mount.mounted,false);
  assert.ok(Math.hypot(leadPlayer(host).position.x+106,leadPlayer(host).position.z-83)<12);
  assert.equal(host.flags.has('clue:1'),false);assert.equal(host.flags.has('dead:golden-king'),false);
}

/** Follow the observed head with real AIM inputs and dodge a visible windup.
 * Three carvings come only from real deaths; full draws, finite arrows,
 * native movement, world cover and every hit law stay authoritative. */
export function* chapterCarvingInputs(host:SimHost,slots:ReturnType<typeof parseHeldSlots>,bow:ReturnType<typeof heldBowBase>):Generator<readonly HeadlessCommand[]> {
  const balbals=nalatiBalbalsOf(host);assert.ok(balbals);
  const presentation=nalatiChapterPresentationOf(host);assert.ok(presentation);
  assert.equal(host.quests.find(row=>row.def.id==='golden-king')?.current?.id,'clues');
  const selected=slots.slots.find(row=>row.kind==='bow');assert.ok(selected);
  const state=():NalatiWeaponObservation=>{const owner=host.adapters.get('nalati.weapons');assert.ok(owner);return readNalatiWeaponObservation(owner);};
  for(let swap=0;swap<slots.registration.length&&state().slot!==selected.id;swap++)yield [{kind:'script',actorId:'nalati.weapon.swap',value:1}];
  assert.equal(state().slot,selected.id);
  const killed=new Set<string>(),head=new Vector3(),motion=new Map<string,{x:number;z:number;t:number}>();let dodged=-120;
  const witnessed=new Map(balbals.law.awake.map(({a})=>[a.entityId,a]));
  const observe=():void=>{for(const {a}of balbals.law.awake)witnessed.set(a.entityId,a);for(const [id,body]of witnessed)if(!body.alive)killed.add(id);};
  const tapReading=():HeadlessCommand[]=>[{kind:'player',moveX:0,moveZ:0,yaw:leadPlayer(host).yaw,commandVersion:1,
    steer:{keyX:0,keyY:0,stickX:0,stickY:0}},{kind:'script',actorId:'nalati.chapter.reading',value:2}];
  const hold=Math.ceil((bow.base.draw?.drawTime??DRAW_TIME)/FIXED_STEP)+15;
  const renock=Math.ceil((bow.base.draw?.renockTime??RENOCK_TIME)/FIXED_STEP)+6;
  const eye=new Vector3(),sight=new Vector3();
  const visible=(target:NonNullable<ReturnType<typeof nalatiBalbalsOf>>['law']['awake'][number]['a']):boolean=>{
    eye.copy(leadPlayer(host).position);eye.y+=1.68;target.headWorld(sight);
    return worldHit(host.physics,eye,sight,ARROW_RADIUS)===null;
  };
  for(let shot=0;shot<bow.base.quiver&&!host.flags.has('clue:3');shot++){
    observe();assert.ok(state().bolts>0,'the real quiver must retain an arrow');
    const target=balbals.law.awake.filter(row=>row.a.alive).sort((a,b)=>Number(visible(b.a))-Number(visible(a.a))
      ||a.a.position.distanceToSquared(leadPlayer(host).position)-b.a.position.distanceToSquared(leadPlayer(host).position))[0]?.a;
    assert.ok(target,'the next actual night warrior must be alive');
    for(let tick=0;tick<1200;tick++){
      const p=leadPlayer(host).position,dx=target.position.x-p.x,dz=target.position.z-p.z,d=Math.hypot(dx,dz),clear=visible(target);
      if(d<3.8&&clear)break;
      yield [{kind:'player',moveX:0,moveZ:0,yaw:Math.atan2(-dx,-dz),commandVersion:1,
        steer:{keyX:0,keyY:0,stickX:clear?0:.7,stickY:d>4?.7:0},...(tick%90===60?{jump:true}:{})}];
    }
    assert.ok(visible(target),'walk around actual cover before spending the next arrow');
    assert.ok(Math.hypot(target.position.x-leadPlayer(host).position.x,target.position.z-leadPlayer(host).position.z)<4.2,
      'real walking inputs must reach the unhalved range');
    const aim=(held:boolean):HeadlessCommand[]=>{
      observe();if(!target.alive)return [{kind:'player',moveX:0,moveZ:0,yaw:leadPlayer(host).yaw,commandVersion:1,steer:{keyX:0,keyY:0,stickX:0,stickY:0}}];
      const p=leadPlayer(host).position,now=host.clock.now,previous=motion.get(target.entityId),elapsed=previous===undefined?0:now-previous.t;
      target.headWorld(head);const time=Math.hypot(head.x-p.x,head.z-p.z)/bowLaunchSpeed(bow.base,1);
      if(previous!==undefined&&elapsed>0){head.x+=(target.position.x-previous.x)/elapsed*time;head.z+=(target.position.z-previous.z)/elapsed*time;}
      motion.set(target.entityId,{x:target.position.x,z:target.position.z,t:now});head.y+=.5*bow.rows.arrow.gravity*time*time;
      const dx=head.x-p.x,dz=head.z-p.z,d=Math.max(.001,Math.hypot(dx,dz));
      const evade=d<5.5&&target.attackPhase>=.28&&target.attackPhase<.58&&host.state.tick-dodged>=60;
      if(evade)dodged=host.state.tick;
      return [{kind:'player',moveX:0,moveZ:0,yaw:Math.atan2(-dx,-dz),commandVersion:1,
        steer:{keyX:0,keyY:0,stickX:evade?(shot%2===0?.8:-.8):visible(target)?0:.7,stickY:d<2.6?-.55:d>4.2?.5:0},
        ...(evade?{dodge:true}:{}),...(held?{heavy:{}}:{})},
        {kind:'script',actorId:'nalati.weapon.aim',value:1},
        {kind:'script',actorId:'nalati.weapon.pitch',value:Math.atan2(head.y-p.y-1.68,d)}];
    };
    for(let tick=0;tick<hold&&target.alive;tick++)yield aim(true);
    for(let tick=0;tick<45&&target.alive&&!visible(target);tick++)yield aim(true);
    assert.ok(!target.alive||visible(target),'the loose input requires an actually clear head gaze');
    yield aim(false);
    for(let tick=0;tick<renock;tick++){observe();yield presentation.reading()?tapReading():aim(false);}
    observe();if(!target.alive)killed.add(target.entityId);
    console.info(JSON.stringify({phase:'carving-bow',tick:host.state.tick,hp:target.hp,id:target.entityId,
      player:leadPlayer(host).health.attributes.health,playerAt:leadPlayer(host).position.toArray(),targetAt:target.position.toArray(),bolts:state().bolts,
      clues:[1,2,3].map(index=>host.flags.has(`clue:${index}`))}));
  }
  for(let tick=0;tick<20&&presentation.reading();tick++)yield tapReading();
  assert.equal(presentation.reading(),false,'real taps must finish the original carving reading');
  observe();
  assert.ok(killed.size>=3,'the tape must retain three distinct actual deaths');
  for(const flag of ['clue:1','clue:2','clue:3'])assert.ok(host.flags.has(flag),flag);
  assert.equal(host.flags.has('entered:kurgan'),false);assert.equal(host.flags.has('dead:golden-king'),false);
  for(let tick=0;tick<60&&host.quests.find(row=>row.def.id==='golden-king')?.current?.id!=='door';tick++)yield [];
  assert.equal(host.quests.find(row=>row.def.id==='golden-king')?.current?.id,'door');
}
