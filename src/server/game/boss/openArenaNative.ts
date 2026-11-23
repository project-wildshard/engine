/** An open arena on a host (P1-E3.4): the real fight over native weather, mounted inputs, patrol actors, heart contacts and
 *  declared saves. No command arms or damages it. A tape installs it through its own wrappers; only a net room installs it
 *  from the assembly, so a one-player save keeps its adapters. */
import * as v from 'valibot';
import { Vector3 } from 'three';
import { BossBrain, easeViewToward, type BossPresentation } from '@wildshard/engine/ai/BossBrain';
import { pickPrompt } from '@wildshard/engine/world/interact/prompts';
import { itemPickupFloor, ITEM_PICKUP_HOVER } from '@wildshard/engine/world/interact/pickup';
import type { SimHost } from '@wildshard/engine/sim';
import { onSimHostRestored } from '@wildshard/engine/sim/snapshot';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import type { HuntBody } from '@wildshard/engine/ai/hunt';
import { parseClientPlan } from '@wildshard/format/clientPlan';
import type { Wind } from '@wildshard/engine/world/steppeWind';
import { OpenArenaFight, readArenaScriptData, type ArenaDraw, type ArenaSupportRider, type OpenArenaViews } from '../../../shared/game/boss/openArenaFight';
import type { ViewCamera } from '@wildshard/engine/script/viewProgram';
import type { ArenaScriptData } from '@wildshard/format/arenaScriptRows';
import type { ViewProgramRows } from '@wildshard/format/viewProgram';
import type { Scope } from '@wildshard/engine/app/scope';
import { arenaTie, arenaTieWord, arenaBoundary } from '../../../shared/game/boss/arenaAnswers';
import { OWNED_ROW } from '../../../shared/game/loot/ownedRows';
import { publishOwned, sayFightView } from '@wildshard/engine/sim/shardRows';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { arenaWords } from './arenaWords';
import { OpenArenaRoom } from './openArenaRoom';
import { OpenArenaSaved } from './openArenaState';
import { patrolOf } from './patrolNative';
import { mountedPlayerOf } from '../riding/native';
import { respawnNativeMounted } from '../riding/nativeTaming';
import { nativeGroupCollection } from '../shardfile/groupRuntime';
import { applyWeatherCover, type WeatherReactions } from '../weather/reactions';
import { prepareChapterRecords, type ChapterRecords } from '../quest/chapterRecords';
import { heldArmsOf, type HeldArrowTargets, type HeldCommand } from '../weapons/nativeHeld';
import { bindHeldArrowTarget, heldArrowTargets } from '../weapons/nativeHeldTargets';
import { serverPlan } from '../shardfile/serverPlan';

/** The original tape adapter uses the same registered encounter target. */
export const openArenaArrows: HeldArrowTargets = heldArrowTargets;

/** The `use` value that takes a fallen arena's reward. */
const TAKE = 2;
/** The assembly row. */
export interface OpenArenaRow { readonly id: string; readonly fight: string; readonly geometry: string; readonly view: string; readonly groups: string;
  readonly input: { readonly use: string; readonly skip: string }; readonly target: string; readonly grants: readonly { readonly item: string; readonly count: number }[] }
export interface NativeOpenArena { readonly fight: OpenArenaFight<ArenaDraw>; readonly boss: BossBrain; readonly target: string; readonly locked: () => boolean; readonly reward: () => boolean; readonly storm: () => boolean;
  readonly records: ChapterRecords; readonly weather: () => { state: string; left: number }; readonly rewardPrompt: () => { position: Vector3; radius: number; label: string } | null }
/** The drawing side's stand-ins, which a headless host lends: a server draws nothing, but the fight reads its body and its eased pose. */
export interface OpenArenaPresentation {
  readonly views: (host: SimHost, data: ArenaScriptData) => OpenArenaViews<ArenaDraw>;
  readonly pose: (fight: Pick<OpenArenaFight<ArenaDraw>, 'viewSource' | 'poseCells' | 'adoptView' | 'viewLoan'>, module: Uint8Array, rows: ViewProgramRows,
    ports: { readonly scope: Scope; readonly player: { readonly position: Vector3; readonly velocity: Vector3; readonly yaw: number }; readonly camera: ViewCamera }) => void;
  readonly camera: () => ViewCamera;
}
/** What one install borrows. `grantItem` files a taken reward; a tape's wrapper leaves it out. */
export interface OpenArenaPorts { readonly presentation: OpenArenaPresentation; readonly commands: () => readonly HeldCommand[]; readonly ledger: { readonly fact: (name: string, actorId: string) => void }; readonly restoring: boolean;
  readonly closedInputOwner?: ((host: SimHost) => void) | undefined; readonly grantItem?: ((player: string, item: string, count: number) => void) | undefined }
const owners = new WeakMap<SimHost, NativeOpenArena>();
export function openArenaOf(host: SimHost): NativeOpenArena | undefined { return owners.get(host); }
/** One arena's lifecycle and the loans it gives its host. */
export interface OpenArenaRuntime {
  readonly eliteDamage: (actor: HuntBody, request: { readonly point: { readonly x: number; readonly z: number } }) => number;
  readonly advance: (dt: number) => void;
  readonly observeWeather: (actual: { readonly wind: Wind; readonly storm: WeatherReactions }) => void;
  /** Reserve the cover phase before the weather and body owners start ticking. */
  readonly cover: () => void;
  readonly install: (ports: OpenArenaPorts) => void;
}

/** Read the arena's rows now, then bind each install to its own host. */
export async function prepareOpenArenaHost(product: Pick<ShardFolder, 'json' | 'section' | 'file' | 'shardfile'>, row: OpenArenaRow): Promise<(host: SimHost) => OpenArenaRuntime> {
  const data = await readArenaScriptData(product, { fight: row.fight, geometry: row.geometry });
  const plan = parseClientPlan(serverPlan(product)), view = plan.features.find(entry => entry.kind === 'view.program' && entry.id === row.view);
  if (view?.kind !== 'view.program') throw new Error('Open arena requires its admitted pose view');
  const [prefix] = row.id.split('.');
  const module = await product.file(view.module), installRecords = await prepareChapterRecords(product, { step: `${prefix ?? row.id}.chapter-records`, elites: `${prefix ?? row.id}.elites` });
  return host => {
    let weather: Parameters<OpenArenaRuntime['observeWeather']>[0] | undefined;
    let advance: ((dt: number) => void) | undefined;
    const damageShares = new Map<HuntBody, (scale: number, x: number, z: number) => number>();
    const install = (ports: OpenArenaPorts): void => {
      const actual=weather,mount=mountedPlayerOf(host),patrolOwner=patrolOf(host),[first]=host.players.values();
      const env=nativeGroupCollection(host,row.groups).environment;
      if(actual===undefined||mount===undefined||patrolOwner===undefined||env===undefined||first===undefined||owners.has(host))throw new Error('Open arena requires its actual world owners');
      const records=installRecords(host,ports.ledger),camera=ports.presentation.camera();
      let locked=false,reward=false,bar=false,rewardPoint:Vector3|null=null;
      const toasts:string[]=[],feeds:string[]=[],support=new Map<number,HuntBody>();
      const toast=(line:string):void=>{toasts.push(line);if(toasts.length>256)toasts.shift();};
      const feed=(line:string):void=>{feeds.push(line);if(feeds.length>256)feeds.shift();};
      const prompt={position:new Vector3(data.arena.anchor.x,host.groundHeightAt(data.arena.anchor.x,data.arena.anchor.z)+data.view.promptLift,data.arena.anchor.z),radius:0,label:data.lines.tie};
      const weapons=():NonNullable<ReturnType<typeof heldArmsOf>>=>{const owner=heldArmsOf(host);
        if(owner===undefined)throw new Error('Open arena requires its actual held equipment owner');return owner;};
      const room=new OpenArenaRoom(host,data,(player,position,yaw)=>{respawnNativeMounted(host,position,yaw,data.view.respawn,player.id);weapons().of(player).refill();});
      const hit=room.contact;
      const rider=(body:HuntBody):ArenaSupportRider=>({body,share:law=>{if(law===null)damageShares.delete(body);else damageShares.set(body,law);},
        dissolve:()=>{patrolOwner.law.dissolve(body);}});
      const encounter:{boss?:BossBrain}={};
      const fight=new OpenArenaFight({scope:host.scope,weather:actual.storm,tieSpot:null,ai:()=>host.rng.stream('ai'),fog:()=>null,
        camera,wild:env,phone:true,ground:(x,z)=>host.groundHeightAt(x,z),wind:actual.wind},{player:room.party.player,
        get boss(){return encounter.boss??null;},get engaged(){return encounter.boss?.engaged??false;},mounted:room.mounted,
        contact:hit,throwRider:room.throwRider,horseSteed:room.horseSteed,heartScale:room.heartScale,feed,toast,
        riderOwner:()=>({spawnRider:at=>{
          const body=patrolOwner.law.spawnRider(at);if(body===null)throw new Error('Admitted arena support rider could not spawn');
          const site=data.supportSites.findIndex(place=>place.x===at.x&&place.z===at.z);
          if(site===-1)throw new Error('Arena support spawned outside its admitted site');support.set(site,body);return rider(body);
        }})},data,ports.presentation.views(host,data));
      ports.presentation.pose(fight,module,view.rows,{scope:host.scope,player:{get position(){return room.near.position;},velocity:mount.rider.velocity,get yaw(){return room.near.yaw;}},camera});
      const ui:BossPresentation={update:()=>undefined,get barShown(){return bar;},hideBar:()=>{bar=false;},hideNameCard:()=>undefined,
        hideReward:()=>undefined,showRetry:()=>undefined,showNameCard:()=>undefined,setSkip:()=>undefined,showBar:()=>{bar=true;},
        setHp:()=>undefined,setShield:()=>undefined,setPhase:()=>undefined};
      const current=records.bosses.read()[data.definition.id]??{defeated:false,rewardTaken:false,kills:0};
      const boss=new BossBrain({...data.definition,reward:{}},fight,{events:host.events,player:room.party.player,lockInput:on=>{
        locked=on;for(const player of host.players.values()){player.moveScale=on?0:1;weapons().of(player).setEnabled(!on);}},
        respawn:room.party.respawn,
        skipHeld:()=>actRoutes(host).skipHeld||ports.commands().some(command=>command.kind==='script'&&command.actorId===row.input.skip&&command.value===1),
        faceToward:(target,dt)=>{const near=room.near,p=near.position;camera.position.set(p.x,p.y+1.68,p.z);
          easeViewToward(weapons().of(near).look,camera.position,target,dt);},spawnReward:()=>{
          room.heartFell();
          const at=itemPickupFloor(host.physics,fight.rewardPoint());rewardPoint=new Vector3(at.x,at.y+ITEM_PICKUP_HOVER+.5,at.z);reward=true;
        },persist:saved=>{if(!saved.defeated){reward=false;rewardPoint=null;}/* SC10: the heart stands again, its untaken orb goes */records.bosses.write({...records.bosses.read(),[data.definition.id]:saved});},toast,feed},ui,current);
      encounter.boss=boss;room.bind(boss,fight,()=>rewardPoint);first.health.checkpoint(host.scope,()=>room.party.died(boss));
      const boundaryPorts={boss,fight,prompt,get player(){return room.near.position;},get motor(){return room.near.motor;},toast,
        wall:()=>{hit('wall',room.near.position,data.view.wallDamage,data.lines.wall);},clear:()=>{actual.storm.weather.force(data.weather.clearing);},
        persistence:records.outcomes};
      // J105: in a room the heart's reward is each earner's own, and it stands until the last of them has taken theirs.
      const take=(player:string,eye:{readonly x:number;readonly y:number;readonly z:number}):void=>{
        if(!reward||rewardPoint===null||pickPrompt([{position:rewardPoint,radius:2.6}],eye,host.physics)===undefined)return;
        const {bounty}=room;
        if(bounty.room&&!bounty.take(player))return;
        for(const {item,count} of row.grants)ports.grantItem?.(player,item,count);
        if(bounty.room&&bounty.owed.length>0)return;
        reward=false;rewardPoint=null;
        boss.takeReward();
      };
      const sayLooks=arenaWords(host,fight);
      const run=(dt:number):void=>{
        for(const command of ports.commands())if(command.kind==='script'&&command.actorId===row.input.use){
          const actor=host.players.get(command.playerId??first.id);
          if(actor===undefined)continue;
          const p=actor.position,eye={x:p.x,y:p.y+1.68,z:p.z};
          if(ports.grantItem!==undefined&&command.value===TAKE){take(actor.id,eye);continue;}
          if(command.value!==1)throw new Error('Invalid open arena interaction input');
          if(pickPrompt([prompt],eye,host.physics)===prompt)
            arenaTie(fight.life,{engaged:boss.engaged,victory:boss.state==='victory',hit:reward,mounted:room.mounted(),storm:actual.storm.stormActive},data.tieLines,{boss,fight,toast:line=>{toast(line);sayFightView(host,arenaTieWord(data.definition.id),[data.tieLines.indexOf(line)]);}});
        }
        room.party.observe(boss,dt);
        if(boss.state!=='dormant'||fight.body.visible)boss.update(dt,host.clock.now);else fight.update(dt,host.clock.now,false);
        const answer=fight.takeBoundary();if(answer!==null)arenaBoundary(answer,data.lines,data.record,boundaryPorts);
        sayLooks(dt);
      };
      if(ports.grantItem!==undefined)for(const id of[row.id,data.definition.id])actRoutes(host).interactions.set(`${id}.reward`,{actorId:row.input.use,value:TAKE});
      actRoutes(host).interactions.set(`${row.id}.tie`,{actorId:row.input.use,value:1});
      actRoutes(host).tied=()=>fight.tied;
      actRoutes(host).interactions.set(`${data.definition.id}.tie`,{actorId:row.input.use,value:1});
      // the tie prompt is the fight's to judge, so a page hears it: its reach in centimetres, and which line it reads in the units place
      publishOwned(host,`${row.id}.tie`,(_player,out)=>{out.set(OWNED_ROW.tie,Math.round(prompt.radius*100)*10+(prompt.label===data.lines.tieOnFoot?1:prompt.label===data.lines.tieQuiet?2:0));});
      bindHeldArrowTarget(host, { key: row.target, target: fight.combatTarget,
        ray: (from, dir, distance, nearest) => fight.target(from, dir, distance, nearest) });
      advance=run;owners.set(host,{fight,boss,records,target:row.target,locked:()=>locked,reward:()=>reward,storm:()=>actual.storm.stormActive,
        weather:()=>({state:actual.storm.weather.state,left:actual.storm.weather.phaseLeft}),
        rewardPrompt:()=>rewardPoint===null?null:{position:rewardPoint.clone(),radius:2.6,label:data.reward.prompt}});
      host.scope.onDispose(()=>{owners.delete(host);advance=undefined;weather=undefined;damageShares.clear();});
      // The next intro step reads the previous frame's heart before drawing
      // its new pose. Rebuild derived body matrices from the restored clock
      // and pose now, without advancing the guest or replaying any effects.
      if(ports.restoring)onSimHostRestored(host,()=>{if(fight.body.visible)fight.body.update(host.clock.now,camera);});
      if(ports.restoring&&ports.closedInputOwner!==undefined){
        const check=ports.closedInputOwner;
        onSimHostRestored(host,()=>{
          const saved=boss.snapshot().saved;
          if(owners.get(host)?.boss!==boss||owners.get(host)?.fight!==fight||locked||boss.state!=='dormant'||fight.tied||reward||saved.defeated||saved.rewardTaken||saved.kills!==0)
            throw new Error('Only a closed arena may lend its input restore check');
          check(host);
        });
      }
      host.onStep(row.id,()=>undefined,{snapshot:()=>{
        const state=fight.snapshot();
        return JSON.stringify({version:1,fight:state,boss:boss.snapshot(),locked,reward,...(rewardPoint===null?{}:{rewardPoint:rewardPoint.toArray()}),bar,prompt:{radius:prompt.radius,label:prompt.label},
          support:state.riders.map(({site})=>{const body=support.get(site);if(body===undefined)throw new Error('Arena support lost its actual site');return [site,body.entityId];}),
          toasts:[...toasts],feeds:[...feeds],contacts:room.contacts,...(room.party.engaged===0?{}:{engaged:room.party.engaged}),...(room.bounty.earned.length===0?{}:{earned:room.bounty.earned})});},
        restore:value=>{
          const saved=v.parse(OpenArenaSaved,typeof value==='string'?JSON.parse(value):value);
          if(saved.reward!==(saved.rewardPoint!==null))throw new Error('Arena reward continuation lost its actual pickup point');
          const restored=new Map(saved.support.map(([site,id])=>{const body=patrolOwner.law.riders.find(entry=>entry.a.entityId===id)?.a;
            if(body===undefined)throw new Error('Arena continuation lost its actual support actor');return [site,body] as const;}));
          fight.restore(saved.fight,site=>{const body=restored.get(site);return body===undefined?null:rider(body);});boss.restore(saved.boss);
          support.clear();for(const [site,body]of restored)support.set(site,body);locked=saved.locked;reward=saved.reward;rewardPoint=saved.rewardPoint===null?null:new Vector3().fromArray(saved.rewardPoint);bar=saved.bar;
          if(ports.closedInputOwner===undefined){
            if(first.moveScale!==(locked?0:1))throw new Error('Arena input lock differs from the restored native motor owner');
            weapons().lead.setEnabled(!locked);
          }
          prompt.radius=saved.prompt.radius;prompt.label=saved.prompt.label;toasts.splice(0,toasts.length,...saved.toasts);feeds.splice(0,feeds.length,...saved.feeds);room.contacts=saved.contacts;room.party.restoreEngaged(saved.engaged??0);room.bounty.restore(saved.earned??[]);
        }});
    };
    return {
      eliteDamage: (actor, request) => damageShares.get(actor)?.(actor.scale, request.point.x, request.point.z) ?? 1,
      advance: dt => {
        if (advance === undefined) throw new Error('Arena owner was not installed before patrol advance');
        advance(dt);
      },
      observeWeather: actual => { weather = actual; },
      cover: () => {
        host.onStep(`${row.id}.weather-cover`, () => {
          const owner = owners.get(host);
          if (owner === undefined || weather === undefined) throw new Error('Arena weather cover lost its entered owners');
          applyWeatherCover(weather.storm.weather, weather.storm.inputs, host.events.ask('weather.indoors', 0) > 0, owner.boss.engaged);
        });
      },
      install,
    };
  };
}

/** The tape API used by previously packed shard fixtures. Each tape still
 * binds the same host-owned lifecycle before its first registration. */
export interface OpenArenaPlan {
  readonly eliteDamage: (host: SimHost, ...args: Parameters<OpenArenaRuntime['eliteDamage']>) => number;
  readonly advance: (host: SimHost, dt: number) => void;
  readonly observeWeather: (host: SimHost, actual: Parameters<OpenArenaRuntime['observeWeather']>[0]) => void;
  readonly cover: (host: SimHost) => void;
  readonly install: (host: SimHost, ports: OpenArenaPorts) => void;
}

export async function prepareOpenArena(product: Parameters<typeof prepareOpenArenaHost>[0], row: OpenArenaRow): Promise<OpenArenaPlan> {
  const bind = await prepareOpenArenaHost(product, row);
  const tapes = new WeakMap<SimHost, OpenArenaRuntime>();
  const tape = (host: SimHost): OpenArenaRuntime => {
    const current = tapes.get(host);
    if (current !== undefined) return current;
    const arena = bind(host);
    tapes.set(host, arena);
    host.scope.onDispose(() => { tapes.delete(host); });
    return arena;
  };
  return {
    eliteDamage: (host, actor, request) => tape(host).eliteDamage(actor, request),
    advance: (host, dt) => { tape(host).advance(dt); },
    observeWeather: (host, actual) => { tape(host).observeWeather(actual); },
    cover: host => { tape(host).cover(); },
    install: (host, ports) => { tape(host).install(ports); },
  };
}
