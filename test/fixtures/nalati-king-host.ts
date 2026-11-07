import * as v from 'valibot';
import {Vector3} from 'three';
import {easeViewToward,type BossPresentation} from '../../src/shared/engine/ai/BossBrain';
import {StrikeRunner} from '../../src/shared/engine/ai/strikes';
import {strikeFromData} from '../../src/shared/engine/ai/strikeRows';
import {canReach} from '../../src/shared/engine/ai/reach';
import type {NativeEliteBindings} from '../../src/server/engine/ai/eliteRoster';
import type {AnimalSim} from '../../src/shared/engine/entities/AnimalSim';
import type {SimHost} from '../../src/server/engine/sim';
import {onSimHostRestored} from '../../src/shared/engine/sim/snapshot';
import type {HeadlessRuntimeInstallation} from '../../src/server/host/headlessRuntime';
import {ReturnProgram} from '../../src/shared/game/population/returnProgram';
import {nativePopulationOf} from '../../src/server/game/riding/nativePopulation';
import {mountedPlayerOf} from '../../src/server/game/riding/native';
import {attachNativeCreaturePose,type NativeCreaturePose} from '../../src/shared/game/plugin/animation';
import type {PhasedBossBrain} from '../../src/server/game/plugin/bossPhase';
import type {NalatiKingData} from './nalati-king-data';
import type {ChapterRecords as NalatiChapterRecords} from '../../src/server/game/quest/chapterRecords';
import {nalatiWeaponsOf} from './nalati-weapons-native';
import {nalatiBalbalsOf} from './nalati-balbal-native';
import {restoreEncounterBrains} from './restoreEncounterBrains';
import {NativeArenaSand} from '../../src/server/game/boss/nativeArenaSand';
import {sandWireName} from '../../src/shared/game/boss/arenaGround';
import {KingContinuation,type KingObservation} from './nalati-king-continuation';
import {nativeKingSeal} from './nalati-king-seal';
import {readNalatiWeaponObservation} from './nalati-weapon-observation';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const finite=v.pipe(v.number(),v.finite()),text=v.pipe(v.string(),v.maxLength(4096));
const UI=v.strictObject({bar:v.boolean(),hp:finite,shield:v.boolean(),phase:finite,skip:finite,name:text,title:text,
  retry:text,attempts:finite,reward:v.boolean()});
const Saved=v.strictObject({kind:v.literal('entered'),version:v.literal(1),core:v.unknown(),sand:v.unknown(),seal:v.unknown(),ui:UI,
  retired:v.pipe(v.array(text),v.maxLength(16)),poses:v.pipe(v.array(v.tuple([text,v.pipe(v.string(),v.maxLength(65536))])),v.maxLength(16)),
  views:v.pipe(v.array(v.tuple([text,v.pipe(v.array(finite),v.maxLength(16))])),v.maxLength(64)),
  lines:v.pipe(v.array(v.tuple([v.picklist(['feed','toast']),text])),v.maxLength(256))});
type KingBody=ReturnType<typeof attachNativeCreaturePose>['body'];
function hasNativeBody(body:AnimalSim):body is KingBody {
  return 'hidden' in body&&typeof body.hidden==='boolean'&&'sampleTerrain' in body&&typeof body.sampleTerrain==='function';
}
function nativeBody(body:AnimalSim):KingBody {
  if(!hasNativeBody(body))throw new Error('King target lost its real native contact attachment');
  return body;
}

/** Actual native composition. Closed legacy handoffs stay byte-identical
 * until the earned King stage first updates. No native body/outcome exists
 * merely because this owner was prepared or its closed state was restored. */
interface NativeKingOwner {
  readonly update:(dt:number)=>void;readonly observe:()=>KingObservation;
  readonly snapshot:()=>unknown;readonly restore:(input:unknown)=>void;readonly physicsRestored:()=>void;
  readonly checkInputs:()=>void;
}
const observers=new WeakMap<SimHost,Pick<NativeKingOwner,'observe'>>();
export function nativeKingOf(host:SimHost):Pick<NativeKingOwner,'observe'>|undefined{return observers.get(host);}
export function installNativeKing(host:SimHost,context:Pick<HeadlessRuntimeInstallation,'commands'|'emit'|'restoring'>,
  data:NalatiKingData,bindings:NativeEliteBindings,records:NalatiChapterRecords):NativeKingOwner {
  if(observers.has(host))throw new Error('King owner already entered');
  const population=nativePopulationOf(host),weapons=nalatiWeaponsOf(host),mount=mountedPlayerOf(host),balbals=nalatiBalbalsOf(host);
  if(population===undefined||weapons===undefined||mount===undefined||balbals===undefined||mount.mounted)
    throw new Error('King needs its original entered population, weapons, on-foot motor and balbal owners');
  population.validateSpawn(data.declared.kind,data.declared.look);
  const sand=new NativeArenaSand(host,data.room,'nalati.king.sand',sandWireName('nalati.king')),seal=nativeKingSeal(host,data.room),poses=new Map<string,NativeCreaturePose>();
  const animate=data.poses.animations((x,z)=>host.groundHeightAt(x,z)).get(data.declared.kind);
  if(animate===undefined)throw new Error('King has no original packed frame');
  const owned=new Map<AnimalSim,NonNullable<ReturnType<NativeEliteBindings['brains']['get']>>>();
  const retired=new Set<string>(),visual=new Map<string,number[]>(),lines:['feed'|'toast',string][]=[];
  const uiState={bar:false,hp:1,shield:false,phase:0,skip:0,name:'',title:'',retry:'',attempts:1,reward:false};
  let active=false,present=false;
  const live=():void=>{if(host.scope.disposed||host.scope.disposing||nativePopulationOf(host)!==population||nalatiWeaponsOf(host)!==weapons
    ||nalatiBalbalsOf(host)!==balbals)throw new Error('King lost an entered owner');};
  const line=(kind:'feed'|'toast',value:string):void=>{live();if(lines.length>=256)throw new Error('King presentation capacity exceeded');
    lines.push([kind,value]);context.emit({kind:'hint',text:value});};
  const attach=(body:AnimalSim,sample=false):KingBody=>{
    if(body.kind!==data.declared.kind||body.variant!==data.declared.look||poses.has(body.entityId)||host.entities.get(body.entityId)!==body)
      throw new Error('King body lost its admitted identity');
    const recipe=data.poses.rows.find(row=>row.kind===body.kind&&row.variant===body.variant);
    if(recipe===undefined)throw new Error('King has no original contact joints');
    poses.set(body.entityId,attachNativeCreaturePose(body,recipe.pose,animate).pose);
    body.levelGround=true;
    const actor=nativeBody(body);bindings.pinned.add(actor);if(!present)actor.hidden=true;if(sample)actor.sampleTerrain();return actor;
  };
  const bind=(body:KingBody,brain:PhasedBossBrain<KingBody>):void=>{
    if(!poses.has(body.entityId))attach(body);
    const initial=data.control.initialize;
    const owner:NonNullable<ReturnType<NativeEliteBindings['brains']['get']>>={think:(actor,frame)=>{
      live();if(actor!==body)throw new Error('King decision identity differs');
      if(body.mem[initial.flag]!==1){body.mem[initial.flag]=1;for(const row of initial.defaults)
        body.mem[row.field]??=row.source==='height'?host.groundHeightAt(body.position.x,body.position.z):row.value;}
      brain.think(body,{dt:frame.dt,player:leadPlayer(host).position});
    },act:actor=>{live();if(actor!==body)throw new Error('King act identity differs');brain.act(body,{player:leadPlayer(host).position});}};
    owned.set(body,owner);bindings.brains.set(body,owner);body.combatActor().damageMul=request=>brain.damageMul(body,request.point);
  };
  for(const body of population.bodies)if(body.kind===data.declared.kind)attach(body);
  const strike=new StrikeRunner(),cuts=data.encounter.page.cuts.map(strikeFromData),hazards=new Map(Object.entries(data.encounter.page.hazards).map(([id,row])=>[id,strikeFromData(row)]));
  const encounter:{core?:KingContinuation<KingBody>}={};
  const player={position:leadPlayer(host).position,velocity:mount.rider.velocity,get yaw(){return leadPlayer(host).yaw;},set yaw(value:number){leadPlayer(host).yaw=value;},
    get pitch(){return weapons.look.pitch;},set pitch(value:number){weapons.look.pitch=value;}};
  const publishPlayer=():void=>{leadPlayer(host).motor.resetAt(leadPlayer(host).position);leadPlayer(host).velocity.y=player.velocity.y;};
  const ui:BossPresentation={update:()=>undefined,get barShown(){return uiState.bar;},hideBar:()=>{uiState.bar=false;},hideNameCard:()=>{uiState.name='';uiState.title='';},
    hideReward:()=>{uiState.reward=false;},showRetry:(retry,attempts)=>{uiState.retry=retry;uiState.attempts=attempts;},
    showNameCard:(name,title)=>{uiState.name=name;uiState.title=title;},setSkip:value=>{uiState.skip=value;},showBar:name=>{uiState.name=name;uiState.bar=true;},
    setHp:value=>{uiState.hp=value;},setShield:on=>{uiState.shield=on;},setPhase:(phase,title)=>{uiState.phase=phase;uiState.title=title;}};
  const record=records.bosses.read()[data.encounter.definition.id]??{defeated:false,rewardTaken:false,kills:0};
  if(record.rewardTaken)throw new Error('King reward equipment loan remains closed');
  const hurt=(amount:number,throughWalls=false):void=>{
    const read=encounter.core?.observe(),body=read?.body===null||read?.body===undefined?undefined:host.entities.get(read.body.id);
    if(body===undefined||!throughWalls&&!canReach(body,leadPlayer(host).position,host.physics))return;
    host.combat.hit({source:'env',sourceTags:[data.encounter.page.damageTag,'feel.blow','cover.checked'],target:leadPlayer(host).health,amount,
      point:body.position,dir:new Vector3(),cause:{kind:body.kind,label:body.label}});
  };
  const core=new KingContinuation<KingBody>(data,{scope:host.scope,ground:sand.ground,player,population,moveScale:{read:()=>leadPlayer(host).moveScale,write:value=>{leadPlayer(host).moveScale=value;}},
    fight:{arena:{floorAt:(x,z)=>sand.ground.floorAt(x,z),pile:(...args)=>{sand.ground.addSand(...args);},clear:()=>{sand.ground.clearSand();},
      drain:(dt,rate)=>{sand.ground.drainSand(dt,rate);},inArena:p=>sand.ground.inChamber(p)&&p.z<data.encounter.page.maxZ,seal:on=>{seal.set(on);}},
      body:{spawn:()=>{const body=population.spawnElite(data.declared.kind,data.declared.at[0],data.declared.at[1],data.declared.yaw,data.declared.look);
        body.herd=-1;return attach(body,true);},bind,retire:body=>{
        body.hidden=true;body.position.y=-9999;retired.add(body.entityId);},ready:(body,y)=>{body.yOffset=y-body.position.y;}},
      spawnAdd:(_index,x,z,yaw)=>{const row=data.encounter.page.add,body=population.spawnElite(row.kind,x,z,yaw,row.variant);
        body.herd=-1;body.levelGround=true;
        balbals.adoptAdd(body);nativeBody(body).sampleTerrain();Object.assign(body.mem,row.memory);body.yOffset=data.room.origin.y-body.position.y;return nativeBody(body);},
      player:{position:leadPlayer(host).position,dash:(x,z,seconds)=>{leadPlayer(host).dashAt(x,z,seconds);}},hurt,
      cut:(index,body,onHit)=>{const row=cuts[index]??cuts[0];return row!==undefined&&strike.contact(row,{actor:body,target:leadPlayer(host).position,hit:onHit,
        canReach:()=>canReach(body,leadPlayer(host).position,host.physics)});},hazard:(id,from,onHit,options)=>{
        const row=hazards.get(id);if(row===undefined)throw new Error('King hazard lost its actual strike');
        const no=():void=>undefined,actor={position:from,scale:1,yaw:0,alive:true,dims:{bodyY:1.2,bodyRadius:.1},
          headWorld:(out:Vector3)=>out.copy(from).add(new Vector3(0,1.2,0)),startAttack:no,cancelAttack:no,setMotion:no};
        strike.contact(row,{actor,target:leadPlayer(host).position,hit:onHit,...options,canReach:()=>canReach(actor,leadPlayer(host).position,host.physics)});
      },rng:()=>host.rng.stream('ai').next(),feed:value=>{line('feed',value);},
      views:Object.fromEntries(data.profile.fight.views.map(id=>[id,(...values:number[])=>{visual.set(id,[...values]);}])),
      rewardPoint:()=>new Vector3().fromArray(data.encounter.page.reward),respawnPoint:()=>({pos:new Vector3().fromArray(data.encounter.page.respawn),yaw:data.encounter.page.yaw})},
    boss:{events:host.events,player:leadPlayer(host),lockInput:on=>{weapons.setEnabled(!on);},respawn:(position,yaw)=>{
      leadPlayer(host).position.copy(position);player.velocity.set(0,0,0);leadPlayer(host).yaw=yaw;weapons.look.pitch=0;publishPlayer();weapons.refill();},
      skipHeld:()=>context.commands().some(command=>command.kind==='player'?command.jump===true:command.kind==='script'&&
        (command.actorId==='nalati.king.skip'||command.actorId==='nalati.king.use')&&command.value===1),
      faceToward:(target,dt)=>{const eye=leadPlayer(host).position.clone();eye.y+=1.68;easeViewToward(weapons.look,eye,target,dt);},
      spawnReward:()=>{uiState.reward=true;},persist:value=>{if(value.rewardTaken)throw new Error('King reward equipment loan remains closed');
        records.bosses.write({...records.bosses.read(),[data.encounter.definition.id]:value});},toast:value=>{line('toast',value);},feed:value=>{line('feed',value);}},
    ui,saved:record,identify:body=>body.entityId,find:id=>{const body=host.entities.get(id);return body===undefined?null:nativeBody(body);},publishPlayer,
    present:on=>{present=on;const state=encounter.core?.observe(),ids=[...(state?.body===null||state?.body===undefined?[]:[state.body.id]),...state?.adds.map(body=>body.id)??[]];
      for(const id of ids){const body=host.entities.get(id);if(body===undefined)throw new Error('King presence lost its actual body');
        nativeBody(body).hidden=!on||retired.has(id);}},sealed:seal.read,advanceRoom:dt=>{sand.advance(dt);}},ReturnProgram.native(host,data.encounter.program));
  encounter.core=core;const ownedCore=core;
  if(context.restoring)onSimHostRestored(host,()=>{restoreEncounterBrains(owned,bindings.brains,
    body=>host.entities.get(body.entityId)===body&&body.kind===data.declared.kind&&poses.has(body.entityId)&&!host.scope.disposed);
    for(const body of owned.keys())bindings.pinned.add(body);});
  leadPlayer(host).health.checkpoint(host.scope,()=>active&&ownedCore.onPlayerDeath());
  host.onStep('nalati.king.poses',()=>{if(!active)return;for(const [id,pose]of poses){const body=host.entities.get(id),dt=host.bodyDt(id);
    if(body===undefined)throw new Error('King pose body disappeared');if(dt>0){pose.advance(dt,host.clock.now,true);pose.publish();}}},undefined,'afterBodies');
  const owner:NativeKingOwner={update:dt=>{live();for(const command of context.commands())if(command.kind==='script'&&command.actorId==='nalati.king.use')
      {if(command.value!==1)throw new Error('Invalid King use input');if(uiState.reward&&ownedCore.observe().state==='victory')
        throw new Error('King reward equipment loan remains closed');}
      if(!active){for(const flag of ['clue:1','clue:2','clue:3'])if(!host.flags.has(flag))throw new Error('King stage requires actual three carvings');ownedCore.open();active=true;}
      ownedCore.update(dt,host.clock.now);
    },observe:()=>{live();return ownedCore.observe();},snapshot:()=>{
      live();if(!active)return {kind:'closed'};
      return {kind:'entered',version:1,retired:[...retired],core:ownedCore.snapshot(),sand:sand.snapshot(),seal:seal.snapshot(),ui:{...uiState},
        poses:[...poses].map(([id,pose])=>[id,pose.snapshot()]),views:[...visual].map(([id,args])=>[id,[...args]]),lines:lines.map(row=>[...row])};
    },restore:input=>{
      live();if(v.safeParse(v.strictObject({kind:v.literal('closed')}),input).success){if(active)throw new Error('Cannot erase entered King');return;}
      const saved=v.parse(Saved,input);
      if(new Set(saved.retired).size!==saved.retired.length||saved.retired.some(id=>!host.entities.has(id)))throw new Error('King retired identities differ');
      if(saved.poses.length!==poses.size||new Set(saved.poses.map(([id])=>id)).size!==saved.poses.length
        ||new Set(saved.views.map(([id])=>id)).size!==saved.views.length||saved.views.some(([id])=>!data.profile.fight.views.includes(id)))throw new Error('King continuation lost its original pose/view inventory');
      for(const [id,wire]of saved.poses){const pose=poses.get(id);if(pose===undefined)throw new Error('Missing restored King joints');pose.restore(wire);}
      seal.restore(saved.seal);sand.restore(saved.sand);ownedCore.restore(saved.core);Object.assign(uiState,saved.ui);visual.clear();
      for(const [id,args]of saved.views)visual.set(id,[...args]);lines.splice(0,lines.length,...saved.lines.map((row):['feed'|'toast',string]=>[row[0],row[1]]));retired.clear();for(const id of saved.retired)retired.add(id);present=ownedCore.observe().inside;
      for(const id of [...poses.keys(),...ownedCore.observe().adds.map(body=>body.id)]){
        const body=host.entities.get(id);if(body===undefined)throw new Error('Restored King presence lost its body');nativeBody(body).hidden=!present||retired.has(id);
      }active=true;
    },checkInputs:()=>{live();const adapter=host.adapters.get('nalati.weapons');
      if(adapter===undefined)throw new Error('King input loan lost its original equipment');
      ownedCore.checkInputs(readNalatiWeaponObservation(adapter).enabled);
    },physicsRestored:()=>{live();seal.physicsRestored();sand.physicsRestored();}};
  observers.set(host,{observe:owner.observe});host.scope.onDispose(()=>{
    observers.delete(host);for(const [body,brain]of owned)if(bindings.brains.get(body)===brain)bindings.brains.delete(body);
    poses.clear();owned.clear();retired.clear();visual.clear();lines.length=0;
  });return owner;
}
