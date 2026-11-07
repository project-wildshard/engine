// oxlint-disable-next-line import/no-nodejs-modules -- A failed real input route must refuse its proof.
import assert from 'node:assert/strict';
import * as v from 'valibot';
import type {SimHost} from '../../../src/server/engine/sim';
import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import type {HeadlessTapePlan} from '../../../src/shared/host/headlessTape';
import {PhysicsRouteCursor} from '../../../src/shared/host/headlessJourney';
import {nativeTamingOf} from '../../../src/server/game/riding/nativeTaming';
import {mountedPlayerOf} from '../../../src/server/game/riding/native';
import {nalatiCampIntroTape} from './verbTape';
import {nalatiHorsePlainsInputs} from './horsePlainsWalk';
import {createNalatiTamingPilot} from './tamingPilot';
import type {CarriedQuestRows} from '@wildshard/format/questSteps';
import {SKY_ROAD} from '../../../src/shards/nalati-grasslands/generators/layout';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

/** Yield the existing trusted route's exact commands, allowing a checked
 * worker reply between ticks. The consumer must commit each yielded tick. */
function* planInputs(host:SimHost,plan:HeadlessTapePlan):Generator<readonly HeadlessCommand[]> {
  for(const segment of plan.segments){
    const cursor=segment.route===undefined?null:new PhysicsRouteCursor(segment.route,{once:true});
    const moving=[...segment.commands];if(cursor!==null)moving.push({kind:'player',moveX:0,moveZ:0,yaw:0});
    for(let tick=0;tick<segment.ticks;tick++){
      if(cursor!==null){
        const p=leadPlayer(host).position,command=cursor.command([p.x,p.y,p.z],tick);
        if(cursor.complete)break;
        if(cursor.stuck.length>0)throw new Error(`Chapter route stuck ${segment.id}: ${JSON.stringify(cursor.stuck)}`);
        moving[moving.length-1]=command;
      }
      const prior=host.state.tick;
      yield segment.frames?.[tick]??(cursor===null?segment.commands:moving);
      if(host.scope.disposed||host.scope.disposing||host.state.tick!==prior+1)throw new Error('Chapter input lost its live tick owner');
      if(!leadPlayer(host).position.toArray().every(Number.isFinite))throw new Error('Nonfinite chapter feet');
    }
    if(cursor!==null&&!cursor.complete){
      const p=leadPlayer(host).position;cursor.command([p.x,p.y,p.z],segment.ticks);
      if(!cursor.complete)throw new Error(`Chapter route incomplete ${segment.id}`);
    }
  }
}
/** Later earned chapters reuse the same checked physical route cursor. */
export function* chapterWalkInputs(host:SimHost,id:string,route:NonNullable<HeadlessTapePlan['segments'][number]['route']>,ticks:number):Generator<readonly HeadlessCommand[]> {
  yield* planInputs(host,{version:1,observe:[],segments:[{id,ticks,commands:[],route}]});
}

/** Earn the chapter's actual horse-plains arrival through the camp and bank. */
export function* chapterCampInputs(host:SimHost,spawn:{readonly x:number;readonly z:number}):Generator<readonly HeadlessCommand[]> {
  yield* planInputs(host,nalatiCampIntroTape(spawn));
  assert.ok(host.flags.has('talked:elder'));
  assert.equal(host.quests.find(quest=>quest.def.id==='tulpar')?.current?.id,'tame');
  yield* planInputs(host,{version:1,observe:[],segments:[{id:'leave-camp',ticks:6000,commands:[{kind:'script',actorId:'nalati.talk',value:-1}],route:[
    {x:86.6,z:219.5},{x:91,z:216},{x:94,z:210},{x:95,z:204},{x:88,z:204.5},{x:84.8,z:203.8},{x:83,z:206},
    {x:73,z:206.1},{x:66,z:209.5},{x:60,z:214},{x:40,z:218},{x:20,z:216},{x:0,z:216},
  ]}]});
  yield* nalatiHorsePlainsInputs(host);
  assert.ok(host.flags.has('talked:elder'));assert.equal(host.flags.has('tamed:horse'),false);
}

/** Side gaze avoids staring the original living horse into flight. A moving
 * target is intercepted using observed positions; the public gauge controls
 * each lean. All movement, trust, five rounds and adoption stay native. */
export function* chapterBondInputs(host:SimHost,usedTicks=0):Generator<readonly HeadlessCommand[]> {
  yield* bondInputs(host,false,usedTicks);
}
/** Stop only after real trust and the mount input earn the first bucking
 * round. Both balance readers initialize on that next original tick. */
export function* chapterApproachInputs(host:SimHost):Generator<readonly HeadlessCommand[]> {
  yield* bondInputs(host,true,0);
}
function* bondInputs(host:SimHost,approach:boolean,usedTicks:number):Generator<readonly HeadlessCommand[]> {
  const original=[...host.entities.values()].find(actor=>actor.kind==='horse'&&actor.variant==='stallion');assert.ok(original);
  assert.equal(original.alive,true);
  const taming=nativeTamingOf(host),mounted=mountedPlayerOf(host);assert.ok(taming);assert.ok(mounted);
  const pilot=createNalatiTamingPilot();
  const rounds=new Set<number>();
  let wasBreaking=false,balance=0,velocity=0,sampled=0,horseX=original.position.x,horseZ=original.position.z,horseTick=host.state.tick,vx=0,vz=0;
  assert.ok(Number.isSafeInteger(usedTicks)&&usedTicks>=0&&usedTicks<20_000);
  for(let tick=usedTicks;tick<20_000&&taming.phase!=='bonded';tick++){
    if(approach&&taming.phase==='breaking'){
      assert.equal(taming.view.round,1);assert.equal(host.flags.has('tamed:horse'),false);return;
    }
    const commands=pilot(host,original.entityId);
    if(taming.phase==='wild'){
      const dx=original.position.x-leadPlayer(host).position.x,dz=original.position.z-leadPlayer(host).position.z,d=Math.hypot(dx,dz),yaw=Math.atan2(-dx,-dz)+Math.PI/3;
      if(original.position.x!==horseX||original.position.z!==horseZ){
        const elapsed=(host.state.tick-horseTick)/60;
        vx=(original.position.x-horseX)/elapsed;vz=(original.position.z-horseZ)/elapsed;
        horseX=original.position.x;horseZ=original.position.z;horseTick=host.state.tick;
      }
      const lead=d>3.4?Math.min(2,5/(Math.hypot(vx,vz)||1)):0,ax=dx+vx*lead,az=dz+vz*lead,len=Math.hypot(ax,az);
      const x=d>2.2&&len>0?ax/len:0,z=d>2.2&&len>0?az/len:0,c=Math.cos(yaw),s=Math.sin(yaw);
      commands[0]={kind:'player',moveX:x,moveZ:z,yaw,commandVersion:1,crouch:d<=35,sprint:d>35,
        steer:{keyX:0,keyY:0,stickX:Math.max(-1,Math.min(1,x*c-z*s)),stickY:Math.max(-1,Math.min(1,-x*s-z*c))}};
    }
    if(taming.phase==='breaking'){
      assert.ok(taming.view.round!==null);rounds.add(taming.view.round);
      if(!wasBreaking){balance=taming.view.balance;velocity=0;sampled=host.state.tick;}
      if(taming.view.balance!==balance){velocity=(taming.view.balance-balance)/((host.state.tick-sampled)/60);balance=taming.view.balance;sampled=host.state.tick;}
      const lean=Math.max(-1,Math.min(1,balance*8+velocity*2));
      for(let index=0;index<commands.length;index++){
        const command=commands[index];
        if(command?.kind==='script'&&command.actorId==='nalati.taming.lean')commands[index]={...command,value:lean};
      }
    }
    wasBreaking=taming.phase==='breaking';yield commands;
  }
  assert.equal(approach,false,'the approach must earn the first real breaking round');
  assert.equal(taming.phase,'bonded');assert.ok(taming.companion);assert.equal(mounted.horse,taming.companion);
  assert.deepEqual([...rounds].sort((a,b)=>a-b),[1,2,3,4,5]);assert.equal(taming.upgraded,false);assert.equal(taming.companion.variant,'tulpar');
  assert.equal(original.alive,true);assert.equal(host.entities.get(original.entityId),original);assert.equal(original.position.y,-1e4);assert.equal(original.motor,null);
  for(let tick=0;tick<60&&!host.flags.has('tamed:horse');tick++)yield [];
  assert.ok(host.flags.has('tamed:horse'));
  assert.equal(host.quests.find(quest=>quest.def.id==='tulpar')?.current?.id,'kokpar');
  assert.equal(host.flags.has('won:kokpar'),false);
}

function reins(host:SimHost,forward:number,turn:number,sprint=false,jump=false):HeadlessCommand {
  return {kind:'player',moveX:0,moveZ:0,yaw:leadPlayer(host).yaw,commandVersion:1,
    steer:{keyX:0,keyY:0,stickX:turn,stickY:forward},sprint,...(jump?{jump:true}:{})};
}
function* drive(host:SimHost,x:number,z:number,sprint=false,radius=2.5):Generator<readonly HeadlessCommand[]> {
  const mount=mountedPlayerOf(host);assert.ok(mount);
  for(let tick=0;tick<1800;tick++){
    const p=leadPlayer(host).position,dx=x-p.x,dz=z-p.z,distance=Math.hypot(dx,dz);
    if(distance<radius)return;
    assert.equal(mount.mounted,true,'the earned horse must carry the actual rider');
    const target=Math.atan2(dx,dz),delta=Math.atan2(Math.sin(mount.body.heading-target),Math.cos(mount.body.heading-target));
    const brake=Math.abs(delta)>.7&&Math.abs(mount.body.speed)>1.5;
    const forward=brake?-.3:Math.abs(delta)>.7?0:!sprint&&tick>120&&mount.body.speed<1?.3:1;
    yield [reins(host,forward,brake?0:Math.max(-1,Math.min(1,delta*2.5)),sprint&&!brake,tick>120&&tick%60===0&&mount.body.speed<1)];
  }
  throw new Error(`Chapter rein route blocked at ${x}, ${z}`);
}
/** Ordinary reins on the actually earned companion; no arrival teleport. */
export function* chapterRideInputs(host:SimHost,x:number,z:number):Generator<readonly HeadlessCommand[]> {yield* drive(host,x,z);}
function round(host:SimHost):{carrying:boolean;events:number[]} {
  const owner=host.adapters.get('nalati.kokpar');assert.ok(owner);const value=owner.snapshot();
  return v.parse(v.object({carrying:v.boolean(),events:v.array(v.number())}),typeof value==='string'?JSON.parse(value):value);
}
/** The original mounted pickup/delivery approach, now on the horse actually
 * earned by the preceding chapter. No command names a goat, goal or score. */
export function* chapterGoatInputs(host:SimHost,rows:CarriedQuestRows):Generator<readonly HeadlessCommand[]> {
  const mount=mountedPlayerOf(host),taming=nativeTamingOf(host);assert.ok(mount);assert.ok(taming?.companion);
  assert.equal(mount.horse,taming.companion);assert.equal(mount.mounted,true);assert.ok(host.flags.has('tamed:horse'));
  for(const [x,z] of [[95,65],[65,55],[20,40],[-20,54]]){
    assert.ok(x!==undefined&&z!==undefined);yield* drive(host,x,z);
  }
  const goal=rows.goals[0];assert.ok(goal);
  const dx=goal.x-rows.home.x,dz=goal.z-rows.home.z,length=Math.hypot(dx,dz);assert.ok(length>0);
  const ux=dx/length,uz=dz/length;
  yield* drive(host,rows.home.x-uz*18,rows.home.z+ux*18);
  yield* drive(host,rows.home.x-ux*16-uz*12,rows.home.z-uz*16+ux*12);
  yield* drive(host,rows.home.x-ux*12,rows.home.z-uz*12);
  yield* drive(host,rows.home.x,rows.home.z,true,2.8);
  for(let tick=0;tick<12&&!round(host).carrying;tick++)yield [reins(host,0,0)];
  assert.equal(round(host).carrying,true,'actual galloping proximity must take the original goat');
  yield* drive(host,goal.x,goal.z,true,2.5);
  for(let tick=0;tick<12&&!host.flags.has('won:kokpar');tick++)yield [reins(host,1,0,true)];
  assert.ok(host.flags.has('won:kokpar'));assert.equal(round(host).carrying,false);
  assert.ok(round(host).events.includes(1));assert.ok(round(host).events.includes(7));
  for(let tick=0;tick<60&&host.quests.find(quest=>quest.def.id==='tulpar')?.current?.id!=='home';tick++)yield [reins(host,0,0)];
  assert.equal(host.quests.find(quest=>quest.def.id==='tulpar')?.current?.id,'home');
  assert.equal(host.flags.has('quest:tulpar'),false);
}
/** Earn the original graded-road bend before its remaining descent and
 * bridge. The next original leg starts with a fresh route cursor anyway. */
export function* chapterReturnInputs(host:SimHost):Generator<readonly HeadlessCommand[]> {
  const mount=mountedPlayerOf(host),taming=nativeTamingOf(host);assert.ok(mount);assert.ok(taming?.companion);
  assert.equal(mount.horse,taming.companion);assert.ok(host.flags.has('won:kokpar'));
  for(const [x,z]of [[-20,54],[20,40],[65,55],[95,65],...SKY_ROAD.slice(8).reverse()]){
    assert.ok(x!==undefined&&z!==undefined);yield* drive(host,x,z);
  }
  assert.equal(mount.mounted,true);assert.ok(Math.hypot(leadPlayer(host).position.x-12,leadPlayer(host).position.z-96)<2.5);
  assert.equal(host.quests.find(quest=>quest.def.id==='tulpar')?.current?.id,'home');
  assert.equal(host.flags.has('told:tulpar'),false);assert.equal(host.flags.has('quest:tulpar'),false);
}
/** Ride the remaining graded road and real bridge home, then dismount and
 * finish only the eligible reading. No second-chapter talk is pressed. */
export function* chapterHomeInputs(host:SimHost,fromReturn=false):Generator<readonly HeadlessCommand[]> {
  if(!fromReturn)yield* chapterReturnInputs(host);
  const mount=mountedPlayerOf(host),taming=nativeTamingOf(host);assert.ok(mount);assert.ok(taming?.companion);
  assert.equal(mount.horse,taming.companion);assert.equal(mount.mounted,true);assert.ok(host.flags.has('won:kokpar'));
  assert.ok(Math.hypot(leadPlayer(host).position.x-12,leadPlayer(host).position.z-96)<2.5);
  yield* chapterCampReturnInputs(host);
  for(let tick=0;tick<360&&!host.flags.has('told:tulpar');tick++)yield tick%16===0?[{kind:'script',actorId:'nalati.talk',value:0}]:[];
  assert.ok(host.flags.has('told:tulpar'));
  for(let tick=0;tick<60&&!host.flags.has('quest:tulpar');tick++)yield [];
  assert.ok(host.flags.has('quest:tulpar'));assert.equal(host.quests.find(quest=>quest.def.id==='tulpar')?.isComplete,true);
  for(const flag of ['talked:elder:2','quest:golden-king','quest:father-wind'])assert.equal(host.flags.has(flag),false,flag);
}

/** The original graded descent, bridge, dismount and camp footpath.
 * Callers retain their own eligible elder reading and completion checks. */
export function* chapterCampReturnInputs(host:SimHost):Generator<readonly HeadlessCommand[]> {
  const mount=mountedPlayerOf(host),taming=nativeTamingOf(host);assert.ok(mount);assert.ok(taming?.companion);
  assert.equal(mount.horse,taming.companion);assert.equal(mount.mounted,true);
  assert.ok(Math.hypot(leadPlayer(host).position.x-12,leadPlayer(host).position.z-96)<2.5);
  const road:readonly (readonly [number,number])[]=[...SKY_ROAD.slice(4,8).reverse(),[40,133],[57,134],[57,136],[53,139],[39,141],[27,142],[23,146],[1,146],
    [0,147],[0,158],[0,170],[0,183],[0,190],[0,200],[0,205],[0,216],[20,216],[40,218],[60,214]];
  for(const [x,z] of road)yield* drive(host,x,z);
  for(let tick=0;tick<120&&Math.abs(mount.body.speed)>.2;tick++)yield [reins(host,-1,0)];
  yield [{kind:'script',actorId:'nalati.ride',value:2}];assert.equal(mount.mounted,false);
  // Dismount places the player beside the actual horse. Returning to its
  // former centre walks into its collider; walk out and around it instead.
  const horse=taming.companion,p=leadPlayer(host).position,cx=horse.position.x,cz=horse.position.z;
  const start=Math.atan2(p.z-cz,p.x-cx),target=Math.atan2(209.5-cz,66-cx),turn=Math.atan2(Math.sin(target-start),Math.cos(target-start));
  const clear=[{x:p.x,z:p.z},{x:cx+Math.cos(start)*4,z:cz+Math.sin(start)*4}],steps=Math.max(1,Math.ceil(Math.abs(turn)/(Math.PI/6)));
  for(let step=1;step<=steps;step++){const angle=start+turn*step/steps;clear.push({x:cx+Math.cos(angle)*4,z:cz+Math.sin(angle)*4});}
  clear.push({x:66,z:209.5});
  yield* planInputs(host,{version:1,observe:[],segments:[{id:'step-clear-of-horse',ticks:1200,commands:[],route:clear}]});
  yield* planInputs(host,{version:1,observe:[],segments:[{id:'walk-home-elder',ticks:3000,commands:[],route:[
    {x:66,z:209.5},{x:73,z:206.1},{x:83,z:206},{x:84.8,z:203.8},{x:88,z:204.5},{x:95,z:204},
    {x:94,z:210},{x:91,z:216},{x:86.6,z:219.5},
  ]}]});
}
