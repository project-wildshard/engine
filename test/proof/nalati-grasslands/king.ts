// oxlint-disable-next-line import/no-nodejs-modules -- Every transition requires an earned original owner.
import assert from 'node:assert/strict';
import type {SimHost,SimStateAdapter} from '../../../src/server/engine/sim';
import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import type {NalatiKingData} from '../../fixtures/nalati-king-data';
import {readNalatiWeaponObservation} from '../../fixtures/nalati-weapon-observation';
import {chapterWalkInputs,chapterRideInputs,chapterCampReturnInputs} from './chapterOne';
import {mountedPlayerOf} from '../../../src/server/game/riding/native';
import {nativeTamingOf} from '../../../src/server/game/riding/nativeTaming';
import {SKY_ROAD} from '../../../src/shards/nalati-grasslands/generators/layout';
import type {KingObservation,KingBodyObservation} from '../../fixtures/nalati-king-continuation';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

/** A walking destination inside the actual door program's observed strip. */
export function kingEntryPoint(e:Pick<NalatiKingData['entrance'],'x'|'z'|'facing'>):{readonly x:number;readonly z:number} {
  return {x:e.x+Math.sin(e.facing)*1.7,z:e.z+Math.cos(e.facing)*1.7};
}

/** The maintained physical cursor requires a real start and destination. */
export function kingWalkingRoute(from:{readonly x:number;readonly z:number},to:{readonly x:number;readonly z:number}):[{x:number;z:number},{x:number;z:number}] {
  return [{x:from.x,z:from.z},{x:to.x,z:to.z}];
}

/** J112's 0.38 m capsule no longer shaves the dromos jamb on a slant: line up on the door's axis, then walk in. */
function kingDoorRoute(from:{readonly x:number;readonly z:number},e:Pick<NalatiKingData['entrance'],'x'|'z'|'facing'>):{x:number;z:number}[] {
  const to=kingEntryPoint(e);
  return [{x:from.x,z:from.z},{x:e.x-Math.sin(e.facing)*6,z:e.z-Math.cos(e.facing)*6},{x:to.x,z:to.z}];
}

/** Stay on the real corridor's walkable extension. Even the route cursor's
 * arrival radius must leave the feet beyond the original exit threshold. */
export function kingExitPoint(room:Pick<NalatiKingData['room'],'origin'|'corridorEnd'>,end:number):{x:number;z:number} {
  assert.ok([room.origin.x,room.origin.z,room.corridorEnd,end].every(Number.isFinite));
  const target=room.corridorEnd+.5;assert.ok(target-.8>end-.7,'the real corridor must reach its exit decision');
  return {x:room.origin.x,z:room.origin.z+target};
}

/** Approach the lower graded road from the actual balbal field. The final
 * two points are copies of the authored road, not an arrival placement. */
export function kingHomeRoad():readonly (readonly[number,number])[] {
  const lower=SKY_ROAD[9],rim=SKY_ROAD[8];assert.ok(lower);assert.ok(rim);
  return [[-83,81],[-60,70],[-20,54],[20,40],[12,78],[lower[0],lower[1]],[rim[0],rim[1]]];
}

export interface KingElderObservation {readonly dead:boolean;readonly told:boolean;readonly complete:boolean;readonly nextTalk:boolean}
/** Keep the earned victory running while a retired sand contact is still
 * cached. Only neutral input may earn the next live-contact checkpoint. */
export function* kingCheckpointSettleInputs(ready:()=>boolean):Generator<readonly HeadlessCommand[],void> {
  for(let tick=0;tick<60&&!ready();tick++)yield [];
  assert.ok(ready(),'the victory must retain a live native ground contact');
}
/** Read-only story observations; only real dialogue inputs may earn the
 * elder's outcome, followed by neutral time for the original quest poll. */
export function* kingElderReadingInputs(read:()=>KingElderObservation):Generator<readonly HeadlessCommand[],void> {
  const first=read();assert.ok(first.dead);assert.equal(first.told,false);assert.equal(first.complete,false);assert.equal(first.nextTalk,false);
  for(let tick=0;tick<360&&!read().told;tick++)yield tick%16===0?[{kind:'script',actorId:'nalati.talk',value:0}]:[];
  assert.ok(read().told,'only the eligible elder reading may publish the return');
  for(let tick=0;tick<60&&!read().complete;tick++)yield [];
  const last=read();assert.ok(last.dead);assert.ok(last.told);assert.ok(last.complete,'the original chapter poll must complete');
  assert.equal(last.nextTalk,false,'do not accept the next chapter');
}

/** Commands only. The caller lends detached observations, not the encounter,
 * its bodies, its reset/phase controls, a saved record or a damage port. */
export function* kingEntryInputs(host:SimHost,read:()=>KingObservation,rows:NalatiKingData):Generator<readonly HeadlessCommand[]> {
  for(const flag of ['clue:1','clue:2','clue:3'])assert.ok(host.flags.has(flag),flag);
  assert.equal(host.flags.has('dead:golden-king'),false);
  const e=rows.entrance;
  for(const commands of chapterWalkInputs(host,'earned-king-door',kingDoorRoute(leadPlayer(host).position,e),2400)){
    if(read().inside)break;yield commands;
  }
  for(let tick=0;tick<120&&!read().inside;tick++)yield [{kind:'player',moveX:0,moveZ:0,yaw:e.facing,commandVersion:1,steer:{keyX:0,keyY:0,stickX:0,stickY:0}}];
  assert.equal(read().inside,true,'the original door program must actually enter');
  const p=rows.profile.fight.origin;
  for(const commands of chapterWalkInputs(host,'entered-king-corridor',kingWalkingRoute(leadPlayer(host).position,{x:p.x,z:p.z+rows.room.halfWidth-2}),1800)){
    if(read().state!=='armed')break;yield commands;
  }
  for(let tick=0;tick<600&&read().state!=='fight';tick++)yield [];
  const entered=read();assert.equal(entered.inside,true);assert.equal(entered.state,'fight');assert.equal(entered.phase,0);
  assert.ok(entered.body?.alive);assert.equal(host.flags.has('dead:golden-king'),false);
}

/** A new child can stop only at the King's actually earned next phase or
 * victory. The enclosing tape retains its original combined ledger/caps. */
export interface KingFightRead {
  readonly flags:{readonly has:(name:string)=>boolean};
  readonly players:ReadonlyMap<string,{readonly position:{readonly x:number;readonly y:number;readonly z:number;readonly toArray:()=>number[]};
    readonly health:{readonly attributes:{readonly health:number}}}>;
  readonly state:{readonly tick:number};
  readonly adapters:{readonly get:(id:string)=>Pick<SimStateAdapter,'snapshot'>|undefined};
}
export interface KingFightSlots {readonly slots:readonly {readonly kind:string;readonly id:string}[];readonly registration:readonly string[]}
export function* kingPhaseInputs(host:KingFightRead,read:()=>KingObservation,rows:Pick<NalatiKingData,'profile'>,
  slots:KingFightSlots,through:1|2|'victory'):Generator<readonly HeadlessCommand[]> {
  for(const flag of ['clue:1','clue:2','clue:3'])assert.ok(host.flags.has(flag),flag);
  assert.equal(read().inside,true);assert.ok(read().body);
  const blade=slots.slots.find(slot=>slot.kind==='blade');assert.ok(blade);
  const weapons=()=>{const adapter=host.adapters.get('nalati.weapons');assert.ok(adapter);return readNalatiWeaponObservation(adapter);};
  for(let swap=0;swap<slots.registration.length&&weapons().slot!==blade.id;swap++)yield [{kind:'script',actorId:'nalati.weapon.swap',value:1}];
  assert.equal(weapons().slot,blade.id);
  let dodged=-120;
  const point=(body:KingBodyObservation):{x:number;z:number}=>({x:body.position[0],z:body.position[2]});
  const distance=(body:KingBodyObservation):number=>{const at=point(body),p=leadPlayer(host).position;return Math.hypot(at.x-p.x,at.z-p.z);};
  for(let tick=0;tick<12_000;tick++){
    const seen=read();assert.equal(seen.inside,true,'combat inputs cannot leave their actual encounter');
    if(through==='victory'?seen.state==='victory':seen.phase>=through)break;
    const king=seen.body;assert.ok(king);
    if(tick%300===0)console.info(JSON.stringify({story:'king-input',tick:host.state.tick,through,state:seen.state,phase:seen.phase,
      mode:seen.mode,shielded:seen.shielded,armour:seen.armourBroken,hp:king.hp,player:leadPlayer(host).health.attributes.health,
      at:leadPlayer(host).position.toArray(),target:king.position,head:king.head,adds:seen.adds.filter(body=>body.alive).length}));
    const adds=seen.adds.filter(body=>body.alive).sort((a,b)=>distance(a)-distance(b));
    // Invulnerable contacts still stagger in the original weapon law. Let
    // the actual goto finish and spawn its adds instead of shoving the King
    // away from his coffin while no damage can be earned.
    const waiting=seen.shielded&&adds.length===0;
    const target=seen.shielded&&adds.length>0?adds[0]:king;assert.ok(target);
    const at=point(target),p=leadPlayer(host).position,dx=at.x-p.x,dz=at.z-p.z,d=Math.hypot(dx,dz),
      gazeX=target.head[0]-p.x,gazeZ=target.head[2]-p.z,pitch=Math.atan2(target.head[1]-p.y-1.68,Math.hypot(gazeX,gazeZ));
    const windup=target.attackPhase>=.35&&target.attackPhase<.68,dodge=!waiting&&windup&&d<rows.profile.fight.attacks.combo.reach+1
      &&host.state.tick-dodged>=60;
    if(dodge)dodged=host.state.tick;
    const jump=!waiting&&target===king&&king.act===rows.profile.fight.attacks.burst.act&&king.attackPhase>=.65&&king.attackPhase<.78;
    const heavy=!waiting&&tick%75<45&&d<3.5&&seen.state==='fight';
    yield [{kind:'player',moveX:0,moveZ:0,yaw:Math.atan2(-gazeX,-gazeZ),commandVersion:1,
      steer:{keyX:0,keyY:0,stickX:waiting?0:dodge?(tick%2===0?.8:-.8):.2,
        stickY:waiting?(d<rows.profile.fight.attacks.combo.reach+1?-.65:0):d>2.1?.65:d<1.3?-.45:0},
      ...(heavy?{heavy:{}}:{}),...(dodge?{dodge:true}:{}),...(jump?{jump:true}:{})},
      ...(tick%12===0?[{kind:'script' as const,actorId:'nalati.weapon.pitch',value:pitch}]:[])];
  }
  const final=read();
  if(through==='victory'){
    assert.equal(final.state,'victory','only the actual encounter may publish victory');
    // The original chapter poll owns this fact; give its real clock time to
    // observe the newly persisted victory rather than feeding the flag.
    for(let tick=0;tick<120&&!host.flags.has('dead:golden-king');tick++)yield [];
    assert.ok(host.flags.has('dead:golden-king'),'the real saved record must publish the King outcome');
  }else assert.ok(final.phase>=through,'the original health threshold must earn the next phase');
}

/** Unactivated return controller. Victory must first be earned by its own
 * checked child; this yields only walking, reins, mount and dialogue inputs. */
export function* kingHomeInputs(host:SimHost,read:()=>KingObservation,rows:NalatiKingData):Generator<readonly HeadlessCommand[]> {
  assert.ok(host.flags.has('dead:golden-king'));assert.equal(host.flags.has('told:king'),false);
  assert.equal(host.flags.has('quest:golden-king'),false);assert.equal(read().state,'victory');assert.equal(read().inside,true);
  const trace=(phase:string):void=>{console.info(JSON.stringify({story:'king-home-input',phase,tick:host.state.tick,at:leadPlayer(host).position.toArray()}));};
  trace('victory-exit');
  for(const commands of chapterWalkInputs(host,'earned-king-exit',kingWalkingRoute(leadPlayer(host).position,kingExitPoint(rows.room,rows.encounter.portal.end)),2400)){
    if(!read().inside)break;yield commands;
  }
  for(let tick=0;tick<120&&read().inside;tick++)yield [];
  assert.equal(read().inside,false,'the real exit program must return the player');
  trace('field-return');
  const taming=nativeTamingOf(host),mount=mountedPlayerOf(host);assert.ok(taming?.companion);assert.ok(mount);
  const horse=taming.companion;
  // The companion has its real collider. Stop the route before its centre;
  // the original mount input below approaches the actual interaction range.
  for(const commands of chapterWalkInputs(host,'return-to-field-horse',kingWalkingRoute(leadPlayer(host).position,horse.position),2400)){
    if(Math.hypot(leadPlayer(host).position.x-horse.position.x,leadPlayer(host).position.z-horse.position.z)<4)break;
    yield commands;
  }
  for(let tick=0;tick<600&&!mount.mounted;tick++){
    const p=leadPlayer(host).position,dx=horse.position.x-p.x,dz=horse.position.z-p.z,d=Math.hypot(dx,dz);
    yield [{kind:'player',moveX:d>2.5?dx/d:0,moveZ:d>2.5?dz/d:0,yaw:Math.atan2(-dx,-dz)},
      ...(d<3.2&&tick%20===0?[{kind:'script' as const,actorId:'nalati.ride',value:1}]:[])];
  }
  assert.equal(mount.mounted,true);assert.equal(mount.horse,horse);
  trace('companion-mounted');
  for(const [x,z]of kingHomeRoad())yield* chapterRideInputs(host,x,z);
  trace('graded-road');
  yield* chapterCampReturnInputs(host);
  trace('elder-arrival');
  yield* kingElderReadingInputs(()=>({dead:host.flags.has('dead:golden-king'),told:host.flags.has('told:king'),
    complete:host.flags.has('quest:golden-king')&&host.quests.find(quest=>quest.def.id==='golden-king')?.isComplete===true,
    nextTalk:host.flags.has('talked:elder:3')}));
}
