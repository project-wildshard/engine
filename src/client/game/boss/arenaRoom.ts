/** The arena encounter's server half (P1-E4.2): its rows, the fight it runs and every rule it answers. What the page draws
 *  with, listens to and rides on arrives as `ArenaRoomPage` (arenaRoomView.ts), so this file imports no view. */
import { Vector3, type Object3D, type PointLight, type Scene } from 'three';
import * as v from 'valibot';
import type { BossViewBinding } from '../../../server/game/plugin/bossPhase';
import { canReach } from '@wildshard/engine/ai/reach';
import { StrikeRunner, type StrikeSpec } from '@wildshard/engine/ai/strikes';
import { strikeFromData } from '@wildshard/engine/ai/strikeRows';
import type { ShardContext } from '../plugin/context';
import { installBossEncounter, type Boss } from '../Boss';
import type { BossBar } from '@wildshard/engine/ui/BossBar';
import type { Game } from '@wildshard/engine/core/Game';
import type { Rng } from '@wildshard/engine/core/rng';
import type { Player } from '@wildshard/engine/player/Player';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { ReturnProgramSchema } from '@wildshard/format/namedJsonContracts';
import { BossEncounterDefinitionSchema, type BossEncounterDefinitionRows } from '@wildshard/format/bossEncounter';
import type { ReturnProjectionV2RowsInput, ReturnProjectionV2Rows } from '@wildshard/format/returnProjectionV2';
import type { HeldSlotKit, HeldClaims } from '../loadout/claims';
import { enteredAdventurePersistence } from '../../../shared/game/quest/chapterBindings';
import type { ModelDef, ModelContext } from '@wildshard/engine/models/model';
import type { ArenaScriptData } from '@wildshard/format/arenaScriptRows';
import type { TargetHit } from '@wildshard/engine/combat/types';
import type { AimTarget } from '@wildshard/engine/player/AimTargets';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import type { StormReading } from '../../../shared/game/weather/feed';
import { arenaBoundary, arenaTieWord } from '../../../shared/game/boss/arenaAnswers';
import { OpenArenaFight, readArenaScriptData, type ArenaRiderOwner, type OpenArenaViews } from '../../../shared/game/boss/openArenaFight';
import { pageAir } from '../population/pageAir';
import { wirePage } from '../shardfile/wirePage';
import { rowFightScript } from './barFeed';
import { OWNED_ROW } from '../../../shared/game/loot/ownedRows';
import { bindRuntimeBoss } from '../../../shared/game/plugin/runtimeRows';
import type { BossScript } from '@wildshard/engine/ai/BossBrain';
import { ArenaFightPageSchema, ArenaRoomPortalSchema, type BoundedArenaFight } from '../../../shared/game/boss/arenaRoomRows';
import type { ArenaRoomPortal, ArenaRoomPortalWorld, BossArenaRoom } from './arenaRoomView';
import { setEliteDamage } from '@wildshard/engine/entities/eliteBrain';
import type { PatrolEncounterView } from './encounterView';
import type { Scope } from '@wildshard/engine/app/scope';
import type { ArcWeaponPower } from '../weapons/arcPower';
import type { CosmeticFinishLocker } from '../loadout/cosmeticFinishes';
import type { installEnteredRuntimeService } from '../shard/retainedHooks';
import type { pageRidingMount, respawnPageMounted, installArenaBoundary } from '../riding/client';
import type { lendOpenArenaView } from './arenaFire';
import type { Mount } from '../riding/mount';
/** ArenaRoomEncounter.contact's reach anchor (scratch) */
const _openW = new Vector3();

const finite = v.pipe(v.number(), v.finite());
const rowId = v.pipe(v.string(), v.minLength(1), v.maxLength(512));
/** The interior encounter borrows native equipment and specimen resources;
 * every authored phase, reward, power and placement is admitted data. */
export const ArenaRoomEncounterSchema: v.GenericSchema<BoundedArenaEncounterInput, BoundedArenaEncounter> = v.object({
  definition: BossEncounterDefinitionSchema,
    reward: v.strictObject({ tier: rowId, name: rowId, flavour: v.string(), prompt: rowId }),
    page: ArenaFightPageSchema, portal: ArenaRoomPortalSchema,
  client: v.strictObject({ light: v.strictObject({ colour: finite, drop: finite }),
      prewarm: v.strictObject({ kind: rowId, variant: rowId }), system: rowId, debugZ: finite }),
  program: ReturnProgramSchema,
});
export interface OpenArenaWorld { readonly game: Game; readonly player: Player; readonly weather: StormReading; readonly tieSpot: Vector3 | null }

/** What the page lends an encounter: its lights, looks, portal and rendered reward, the riding page and the DOM's skip keys.
 *  A later host lends its own; none of these decide anything. */
export interface ArenaRoomPage {
  readonly phone: boolean;
  readonly ai: () => Rng;
  readonly roomLight: (colour: number, at: Vector3) => PointLight;
  readonly openLight: (scene: Scene, colour: number, at: Vector3) => PointLight;
  readonly openViews: (scene: Scene, rows: ArenaScriptData) => OpenArenaViews;
  readonly portal: (world: ArenaRoomPortalWorld, room: BossArenaRoom, rows: unknown, program: ReturnProgram, entrance: { readonly x: number; readonly y: number; readonly z: number; readonly facing: number } | null) => ArenaRoomPortal;
  readonly views: (room: BossArenaRoom, presentation: { readonly reach: number; readonly ringMax: number; readonly beamRadius: number }) => BossViewBinding;
  readonly rewardObject: (model: ModelDef<object>, sky: ModelContext['sky']) => Object3D;
  readonly entered: typeof installEnteredRuntimeService;
  readonly mount: typeof pageRidingMount;
  readonly respawnMounted: typeof respawnPageMounted;
  readonly boundary: typeof installArenaBoundary;
  readonly lendOpenView: typeof lendOpenArenaView;
  /** HOLD TO SKIP held or let go, by key or touch */
  readonly listenSkip: (scope: Scope, held: (source: 'key' | 'touch', on: boolean) => void) => void;
}

/** The page's half of a room fight: its looks, as the server's fight tells them. The bar and every body are rows. */
export function pageArenaRoomFight(ctx: ShardContext, dungeon: BossArenaRoom, input: unknown, views: (presentation: BoundedArenaFight['presentation']) => BossViewBinding): BossScript {
  const rows = v.parse(ArenaFightPageSchema, input), play = ctx.game.runtime?.play;
  if (play === undefined || play === null) throw new Error('Arena fight requires its actual page owners');
  const { animals } = play, owner = bindRuntimeBoss(ctx, ctx.product.shardfile, rows.body, undefined, { identity: rows.identity }), binding = views(rows.presentation);
  // The server's fight runs, and its looks reach this room as it told them. A room nobody has entered has nothing built to draw on.
  wirePage.whenLive(ctx.scope, client => client.onView(({ name, args }) => {
    if (!dungeon.built) return;
    if (name === 'boss.glow') dungeon.actor = animals.animals.find(actor => actor.rowDriven && actor.kind === owner.row.kind) ?? null; // the server's body is the row's
    binding[name]?.(...args);
  }));
  return rowFightScript({ rewardPoint: () => new Vector3().fromArray(rows.reward), respawnPoint: () => ({ pos: new Vector3().fromArray(rows.respawn), yaw: rows.yaw }) });
}

export class ArenaRoomEncounter {
  /** the reward's light slot, dark until the victory (Boss.ts): a LightPool light once the arena is in its scene */
  spareLight:PointLight;
  private readonly room:BossArenaRoom|null;
  get dungeon():BossArenaRoom{if(this.room===null)throw new Error('Open arena has no room');return this.room;}
  boss:Boss|null=null;ui:BossBar|null=null;
  /** The encounter's frame: its brain, or on the wire its row. */
  private drive:((dt:number,t:number)=>void)|null=null;
  fight:BossScript|null=null;
  power:ReturnType<HeldSlotKit['bowPower']>|ArcWeaponPower|null=null;
  riders:PatrolEncounterView|null=null;mount:Mount|null=null;
  private readonly rows:v.InferOutput<typeof ArenaRoomEncounterSchema>|null;
  private readonly openRows:ArenaScriptData|null;
  private readonly openWorld:OpenArenaWorld|null;
  private readonly projection:OpenArenaFight|null;
  private readonly prompt:Interactable|null;
  private readonly contacts=new Map<string,StrikeSpec>();private readonly strikes=new StrikeRunner();
  private portal:ArenaRoomPortal|null=null;private context:ShardContext|null=null;private kit:HeldSlotKit|null=null;
  private skipKeys=false;private skipTouch=false;private hurtWhy='';private hurtT=0;
  private readonly page:ArenaRoomPage;
  private readonly entrance:{readonly x:number;readonly y:number;readonly z:number;readonly facing:number}|null;
  get world():OpenArenaWorld{if(this.openWorld===null)throw new Error('Not an open arena');return this.openWorld;}
  get data():ArenaScriptData{if(this.openRows===null)throw new Error('Not an open arena');return this.openRows;}
  get openFight():OpenArenaFight{if(this.projection===null)throw new Error('Not an open arena');return this.projection;}
  get inside():boolean{return this.portal?.inside??false;}
  get tied():boolean{return this.projection?.tied??false;}
  get player():Player{return this.world.player;}
  get engaged():boolean{return this.boss?.engaged===true;}
  constructor(dungeon:BossArenaRoom,input:unknown,entrance:{readonly x:number;readonly y:number;readonly z:number;readonly facing:number}|null,page:ArenaRoomPage);
  constructor(open:{readonly kind:'open';readonly world:OpenArenaWorld;readonly rows:ArenaScriptData;readonly page:ArenaRoomPage});
  constructor(source:BossArenaRoom|{readonly kind:'open';readonly world:OpenArenaWorld;readonly rows:ArenaScriptData;readonly page:ArenaRoomPage},input?:unknown,entrance:{readonly x:number;readonly y:number;readonly z:number;readonly facing:number}|null=null,lent?:ArenaRoomPage){
    this.entrance=entrance;
    if(!('kind' in source)){
      if(lent===undefined)throw new Error('Closed arena needs its page');this.page=lent;
      this.room=source;this.rows=v.parse(ArenaRoomEncounterSchema,input);this.openRows=null;this.openWorld=null;this.projection=null;this.prompt=null;
      const at=source.rows.origin;this.spareLight=lent.roomLight(this.rows.client.light.colour,new Vector3(at.x,at.y-this.rows.client.light.drop,at.z));
    }else{
      this.page=source.page;this.room=null;this.rows=null;this.openWorld=source.world;this.openRows=source.rows;
      for(const [name,row]of Object.entries(source.rows.contacts))this.contacts.set(name,strikeFromData(row));
      // the fight's numbers live in openArenaFight.ts (the Node simulation fights the same); the page lends it its world and
      // looks, the world's parts read when the fight uses them (the weather owner publishes after the arena is built)
      const world=source.world,rows=source.rows,scene=world.game.scene,page=source.page;
      const projection=this.projection=new OpenArenaFight({scope:world.game.levelScope,get weather(){return world.weather;},get tieSpot(){return world.tieSpot;},ai:page.ai,
        fog:()=>world.game.scene.fog,get camera(){return world.game.camera;},wild:pageAir,phone:page.phone},this,rows,page.openViews(scene,rows));
      this.spareLight=page.openLight(source.world.game.scene,source.rows.view.light.colour,new Vector3(source.rows.arena.body.x,source.rows.view.light.y,source.rows.arena.body.z));
      const spot=projection.cairnSpot();this.prompt={position:new Vector3(spot.x,spot.y+source.rows.view.promptLift,spot.z),radius:0,label:source.rows.lines.tie,onInteract:()=>undefined};
    }
  }
  /** The fight's rows and programmes as the page's build admits them, a slice each. */
  static readonly readOpen:typeof readArenaScriptData=readArenaScriptData;
  static prepareProgram(program:Parameters<typeof ReturnProgram.prepareMemory>[0],owner:Parameters<typeof ReturnProgram.prepareMemory>[1]):boolean{return ReturnProgram.prepareMemory(program,owner);}
  static admitProgram(program:Parameters<typeof ReturnProgram.page>[0],owner:Parameters<typeof ReturnProgram.page>[1]):void{ReturnProgram.page(program,owner);}
  /** the fight's riders (OpenArenaFightHost): the patrol view's actors, their damage share as an elite damage law */
  riderOwner():ArenaRiderOwner|null{
    const riders=this.riders;if(riders===null)return null;
    return {spawnRider:at=>{const a=riders.spawnRider(at);return a===null?null:{body:a,
      share:law=>{setEliteDamage(a,law===null?()=>1:(body,point)=>law(body.scale,point.x,point.z));},dissolve:()=>{riders.dissolve(a);}};}};
  }
  mounted():boolean{return this.mount?.mounted===true;}
  throwRider():void{if(this.mount?.mounted===true)this.openFight.dismount(this.mount,this.context?.scope??this.openFight.scope);}
  horseSteed(amount:number):void{if(this.mount!==null)this.mount.steed=Math.max(0,this.mount.steed+amount);}
  toast(message:string):void{this.context?.game.runtime?.play?.hud.toast(message);}
  feed(message:string):void{this.context?.game.runtime?.play?.hud.killFeed(message);}
  hurt(amount:number,why:string):void{
    const ctx=this.context,target=ctx?.app.player;if(ctx===null||ctx.scope.disposed||target===undefined||target===null)return;
    const say=why!==this.hurtWhy||this.hurtT<=0;if(say){this.hurtWhy=why;this.hurtT=this.data.view.notice;}
    ctx.app.combat.hit({source:'env',sourceTags:[`boss.${this.data.record.kind}`,'feel.jolt','cover.checked'],target,amount,point:this.player.position.clone(),dir:new Vector3(),cause:{kind:this.data.record.kind,label:this.data.definition.name},toast:say?why:''});
  }
  contact(name:string,origin:Vector3,amount:number,why:string):boolean{
    const row=this.contacts.get(name),target=this.player.position;
    if(!this.data.whole.includes(name)){
      if(row===undefined)throw new Error('Missing arena contact');
      if(!this.strikes.contains(row,{actor:{position:origin,scale:1,yaw:0},target}))return false;
      if(!row.tags.includes('cover.exempt')){
        const anchor={position:origin,scale:1,alive:true,dims:{bodyY:1.2,bodyRadius:.1},headWorld:(out:Vector3)=>out.copy(origin).add(_openW.set(0,1.2,0))};
        if(!canReach(anchor,target,this.world.game.app.physics))return false;
      }
    }this.hurt(amount,why);return true;
  }
  bind(ctx:ShardContext,kit:HeldSlotKit,rewardModel:ModelDef<object>,equipment?:{readonly arsenal:HeldClaims;readonly locker:CosmeticFinishLocker}):void{
    const runtime=ctx.game.runtime,play=runtime?.play,nativeWorld=runtime?.world,world=this.openWorld??nativeWorld,open=this.openRows,room=this.rows;
    if(nativeWorld===undefined||nativeWorld===null||runtime===undefined||play===undefined||play===null||world===undefined||world===null||open!==null&&equipment===undefined)throw new Error('Arena encounter needs its actual entered owners');
    const health=ctx.app.player,page=this.page;page.entered(ctx,entered=>{health?.checkpoint(entered,()=>this.onPlayerDeath(),()=>ctx.app.player===health);});
    const {game,player}=world,scope=open===null?game.levelScope:ctx.scope;this.context=ctx;this.kit=kit;
    let blade:ArcWeaponPower|null=null,bow:ReturnType<HeldSlotKit['bowPower']>|null=null;
    if(open===null){
      if(room===null||this.room===null)throw new Error('Missing closed arena rows');
      this.portal=page.portal({game,player,animals:play.animals},this.dungeon,room.portal,ReturnProgram.page(room.program,game.levelScope),this.entrance);
      try{play.animals.factory.model(room.client.prewarm.kind,room.client.prewarm.variant);}catch(error:unknown){console.warn('Arena adds did not prewarm',error);}
      this.power=bow=kit.bowPower('bow-reward');this.fight=pageArenaRoomFight(ctx,this.dungeon,room.page,presentation=>page.views(this.dungeon,presentation));
    }else{
      if(equipment===undefined)throw new Error('Missing open arena equipment');this.mount=page.mount(ctx);
      this.power=blade=new(equipment.arsenal.blade('blade').Power)({scene:game.scene,player,camera:game.camera,animals:play.animals,weather:this.world.weather,scope:ctx.scope});
    }
    const row=open??room;if(row===null)throw new Error('Missing arena rows');
    const saved=enteredAdventurePersistence(ctx.scope),script=this.projection??this.fight;if(script===null)throw new Error('Missing arena script');
    const encounter=installBossEncounter({definition:row.definition,reward:row.reward},()=>script,{game,player,spareLight:this.spareLight,scope,chunkId:ctx.product.slug,interactables:runtime.interactables,persistence:saved.bosses,
      reward:{model:()=>page.rewardObject(rewardModel,open===null?nativeWorld.sky:game.sky),grant:()=>{
        if(open===null)kit.upgradeBow('bow-reward',play.weapons);else{if(blade===null||equipment===undefined)throw new Error('Missing arena reward equipment');kit.upgradeBlade('blade-reward',play.weapons,blade);equipment.locker.own(open.skin.id);play.hud.toast(open.skin.toast);}
      }},
      lockInput:on=>{if(open===null){this.portal?.setLocked(on);play.weapons.setEnabled(!on);}else{play.weapons.setEnabled(!on);player.moveScale=on?0:1;}},
      respawn:(at,yaw)=>{if(open===null){player.position.copy(at);player.velocity.set(0,0,0);player.yaw=yaw;player.pitch=0;}else page.respawnMounted(ctx,at,yaw,open.view.respawn);kit.refill();},
      skipHeld:()=>this.skipKeys||this.skipTouch||ctx.app.input.held('jump')||ctx.app.input.held('use'),toast:text=>{play.hud.toast(text);},feed:text=>{play.hud.killFeed(text);},pickupHum:on=>{play.audio.pickupHum(on);},
      music:event=>{if(event==='death'||event==='pickup')play.music.sting(event);else if(event==='victory')play.music.sting('chunk');else play.music.combat(1);}});
    this.boss=encounter.boss;this.ui=encounter.ui;this.drive=encounter.update;
    if(open===null){
      if(this.fight===null||this.portal===null||room===null)throw new Error('Missing room fight');this.portal.bind(encounter.ui,encounter.update);
      if(encounter.boss.rewardTaken)kit.upgradeBow('bow-reward',play.weapons);
    }else{
      if(this.prompt===null||this.projection===null)throw new Error('Missing open arena projection');runtime.interactables.push(this.prompt);
      {const word=arenaTieWord(this.data.definition.id),lines=this.data.tieLines,heard=this.projection;wirePage.whenLive(ctx.scope,client=>client.onView(({name,args})=>{const line=name===word?lines[args[0]??-1]:undefined;if(line!==undefined)play.hud.toast(line);if(name.startsWith('open-arena.')){heard.hear(name,args);wirePage.drew(name);}}));}
      if(encounter.boss.rewardTaken){if(blade===null)throw new Error('Missing open arena power');kit.upgradeBlade('blade-reward',play.weapons,blade);}
      page.boundary(ctx.scope,this.projection.boundary);page.lendOpenView(this.projection,ctx.scope);
    }
    page.listenSkip(scope,(source,on)=>{if(source==='key')this.skipKeys=on;else this.skipTouch=on;});
    if(open!==null)ctx.debug.expose(open.view.debug,this);
    if(open===null&&room!==null)game.app.addSystem({id:room.client.system,phase:'update',after:['hud.combat'],before:['first hints','main.frame'],run:dt=>{bow?.update(dt);}},scope);
  }
  devStartAt(phase:number):void{
    if(this.openRows===null){this.portal?.enter(true,this.rows?.client.debugZ);this.boss?.devStartAt(phase);return;}
    const at=this.openFight.respawnPoint(),ctx=this.context;if(ctx!==null)this.page.respawnMounted(ctx,at.pos,at.yaw,this.data.view.respawn);this.openFight.tied=true;this.boss?.devStartAt(phase);
  }
  onPlayerDeath():boolean{return this.boss?.onPlayerDeath()??false;}
  update(dt:number,t:number):void{
    if(this.openRows===null){this.portal?.update(dt,t);return;}
    this.power?.update(dt,t);this.hurtT-=dt;const boss=this.boss;if(boss===null||this.context===null||this.kit===null)return;
    const fight=this.openFight;this.drive?.(dt,t);
    fight.followFrame(dt,t); // the page steps no fight on the wire: it draws what the server's says
    if(this.prompt!==null){const line=wirePage.line(OWNED_ROW.tie),{lines,arena}=this.data;this.prompt.wireId=`${this.data.definition.id}.tie`;this.prompt.position.x=arena.anchor.x;this.prompt.position.z=arena.anchor.z;this.prompt.radius=Math.floor(line/10)/100;this.prompt.label=line%10===1?lines.tieOnFoot:line%10===2?lines.tieQuiet:lines.tie;}
    const answer=fight.takeBoundary();if(answer===null)return;const prompt=this.prompt;if(prompt===null)throw new Error('Missing open arena prompt');
    // the boundary answer's order is arenaBoundary's (renderer-free, CI12)
    const p=this.player.position,scope=this.context.scope;
    arenaBoundary(answer,this.data.lines,this.data.record,{boss,fight,prompt,player:p,toast:line=>{this.toast(line);},
      wall:()=>{this.contact('wall',p,this.data.view.wallDamage,this.data.lines.wall);},clear:()=>undefined,
      get persistence(){return enteredAdventurePersistence(scope);}});
  }
  target(origin:Vector3,dir:Vector3,max:number,hit:TargetHit|null):TargetHit|null{return this.openFight.target(origin,dir,max,hit);}
  lockTarget():AimTarget|null{return this.openFight.lockTarget();}
}


interface BoundedArenaEncounterInputFields {
    definition: BossEncounterDefinitionRows;
    reward: {
        tier: string;
        name: string;
        flavour: string;
        prompt: string;
    };
    page: {
        profile: unknown;
        body: string;
        identity: "runtime" | "declared";
        add: {
            kind: string;
            variant: string;
            memory: Record<string, number>;
        };
        damageTag: `${string}.${string}`;
        maxZ: number;
        reward: [
            number,
            number,
            number
        ];
        respawn: [
            number,
            number,
            number
        ];
        yaw: number;
        presentation: {
            reach: number;
            ringMax: number;
            beamRadius: number;
        };
        cuts: {
            id: string;
            shape: {
                kind: "arc";
                radius: number;
                halfAngle: number;
                yawOffset?: number;
            } | {
                kind: "lane";
                length: number;
                width: number;
            } | {
                kind: "ring";
                inner: number;
                outer: number;
            } | {
                kind: "wedge";
                length: number;
                halfAngle: number;
            } | {
                kind: "point";
                radius: number;
                exclusive?: boolean;
            } | {
                kind: "sphere";
                radius: number;
            };
            windup: number;
            active: number;
            recover: number;
            cooldown: number;
            range: number | null;
            damage: number;
            tags: `${string}.${string}`[];
            weight: {
                kind: "constant";
                value: number;
            } | {
                kind: "horizontal-distance";
                above: number;
                far: number;
                near: number;
            };
            units?: "world" | "actor";
            alternatives?: ({
                kind: "arc";
                radius: number;
                halfAngle: number;
                yawOffset?: number;
            } | {
                kind: "lane";
                length: number;
                width: number;
            } | {
                kind: "ring";
                inner: number;
                outer: number;
            } | {
                kind: "wedge";
                length: number;
                halfAngle: number;
            } | {
                kind: "point";
                radius: number;
                exclusive?: boolean;
            } | {
                kind: "sphere";
                radius: number;
            })[];
            motion?: {
                speed?: number;
                delay?: number;
                track?: "none" | "lead" | "follow";
                overshoot?: number;
                skid?: number;
            };
            eligibility?: {
                maxDy?: number;
                jumpDodges?: boolean;
            };
        }[];
        hazards: Record<string, {
                id: string;
                shape: {
                    kind: "arc";
                    radius: number;
                    halfAngle: number;
                    yawOffset?: number;
                } | {
                    kind: "lane";
                    length: number;
                    width: number;
                } | {
                    kind: "ring";
                    inner: number;
                    outer: number;
                } | {
                    kind: "wedge";
                    length: number;
                    halfAngle: number;
                } | {
                    kind: "point";
                    radius: number;
                    exclusive?: boolean;
                } | {
                    kind: "sphere";
                    radius: number;
                };
                windup: number;
                active: number;
                recover: number;
                cooldown: number;
                range: number | null;
                damage: number;
                tags: `${string}.${string}`[];
                weight: {
                    kind: "constant";
                    value: number;
                } | {
                    kind: "horizontal-distance";
                    above: number;
                    far: number;
                    near: number;
                };
                units?: "world" | "actor";
                alternatives?: ({
                    kind: "arc";
                    radius: number;
                    halfAngle: number;
                    yawOffset?: number;
                } | {
                    kind: "lane";
                    length: number;
                    width: number;
                } | {
                    kind: "ring";
                    inner: number;
                    outer: number;
                } | {
                    kind: "wedge";
                    length: number;
                    halfAngle: number;
                } | {
                    kind: "point";
                    radius: number;
                    exclusive?: boolean;
                } | {
                    kind: "sphere";
                    radius: number;
                })[];
                motion?: {
                    speed?: number;
                    delay?: number;
                    track?: "none" | "lead" | "follow";
                    overshoot?: number;
                    skid?: number;
                };
                eligibility?: {
                    maxDy?: number;
                    jumpDodges?: boolean;
                };
            }>;
    };
    portal: {
        signal: string;
        spawn: {
            x: number;
            z: number;
            yaw: number;
        };
        end: number;
        exitOffset: number;
        slow: number;
        fade: {
            out: number;
            hold: number;
            in: number;
        };
        keep: string;
        near: number;
        floor: {
            tolerance: number;
            depth: number;
        };
    };
    client: {
        light: {
            colour: number;
            drop: number;
        };
        prewarm: {
            kind: string;
            variant: string;
        };
        system: string;
        debugZ: number;
    };
    program: {
        script: unknown;
        bytes: string;
        v2?: ReturnProjectionV2RowsInput;
    };
}
type BoundedArenaEncounterInput = { [Key in keyof BoundedArenaEncounterInputFields]: BoundedArenaEncounterInputFields[Key] };
interface BoundedArenaEncounterFields {
    definition: BossEncounterDefinitionRows;
    reward: {
        tier: string;
        name: string;
        flavour: string;
        prompt: string;
    };
    page: {
        profile: unknown;
        body: string;
        identity: "runtime" | "declared";
        add: {
            kind: string;
            variant: string;
            memory: Record<string, number>;
        };
        damageTag: `${string}.${string}`;
        maxZ: number;
        reward: [
            number,
            number,
            number
        ];
        respawn: [
            number,
            number,
            number
        ];
        yaw: number;
        presentation: {
            reach: number;
            ringMax: number;
            beamRadius: number;
        };
        cuts: {
            id: string;
            shape: {
                kind: "arc";
                radius: number;
                halfAngle: number;
                yawOffset?: number;
            } | {
                kind: "lane";
                length: number;
                width: number;
            } | {
                kind: "ring";
                inner: number;
                outer: number;
            } | {
                kind: "wedge";
                length: number;
                halfAngle: number;
            } | {
                kind: "point";
                radius: number;
                exclusive?: boolean;
            } | {
                kind: "sphere";
                radius: number;
            };
            windup: number;
            active: number;
            recover: number;
            cooldown: number;
            range: number | null;
            damage: number;
            tags: `${string}.${string}`[];
            weight: {
                kind: "constant";
                value: number;
            } | {
                kind: "horizontal-distance";
                above: number;
                far: number;
                near: number;
            };
            units?: "world" | "actor";
            alternatives?: ({
                kind: "arc";
                radius: number;
                halfAngle: number;
                yawOffset?: number;
            } | {
                kind: "lane";
                length: number;
                width: number;
            } | {
                kind: "ring";
                inner: number;
                outer: number;
            } | {
                kind: "wedge";
                length: number;
                halfAngle: number;
            } | {
                kind: "point";
                radius: number;
                exclusive?: boolean;
            } | {
                kind: "sphere";
                radius: number;
            })[];
            motion?: {
                speed?: number;
                delay?: number;
                track?: "none" | "lead" | "follow";
                overshoot?: number;
                skid?: number;
            };
            eligibility?: {
                maxDy?: number;
                jumpDodges?: boolean;
            };
        }[];
        hazards: Record<string, {
                id: string;
                shape: {
                    kind: "arc";
                    radius: number;
                    halfAngle: number;
                    yawOffset?: number;
                } | {
                    kind: "lane";
                    length: number;
                    width: number;
                } | {
                    kind: "ring";
                    inner: number;
                    outer: number;
                } | {
                    kind: "wedge";
                    length: number;
                    halfAngle: number;
                } | {
                    kind: "point";
                    radius: number;
                    exclusive?: boolean;
                } | {
                    kind: "sphere";
                    radius: number;
                };
                windup: number;
                active: number;
                recover: number;
                cooldown: number;
                range: number | null;
                damage: number;
                tags: `${string}.${string}`[];
                weight: {
                    kind: "constant";
                    value: number;
                } | {
                    kind: "horizontal-distance";
                    above: number;
                    far: number;
                    near: number;
                };
                units?: "world" | "actor";
                alternatives?: ({
                    kind: "arc";
                    radius: number;
                    halfAngle: number;
                    yawOffset?: number;
                } | {
                    kind: "lane";
                    length: number;
                    width: number;
                } | {
                    kind: "ring";
                    inner: number;
                    outer: number;
                } | {
                    kind: "wedge";
                    length: number;
                    halfAngle: number;
                } | {
                    kind: "point";
                    radius: number;
                    exclusive?: boolean;
                } | {
                    kind: "sphere";
                    radius: number;
                })[];
                motion?: {
                    speed?: number;
                    delay?: number;
                    track?: "none" | "lead" | "follow";
                    overshoot?: number;
                    skid?: number;
                };
                eligibility?: {
                    maxDy?: number;
                    jumpDodges?: boolean;
                };
            }>;
    };
    portal: {
        signal: string;
        spawn: {
            x: number;
            z: number;
            yaw: number;
        };
        end: number;
        exitOffset: number;
        slow: number;
        fade: {
            out: number;
            hold: number;
            in: number;
        };
        keep: string;
        near: number;
        floor: {
            tolerance: number;
            depth: number;
        };
    };
    client: {
        light: {
            colour: number;
            drop: number;
        };
        prewarm: {
            kind: string;
            variant: string;
        };
        system: string;
        debugZ: number;
    };
    program: {
        script: unknown;
        bytes: string;
        v2?: ReturnProjectionV2Rows;
    };
}
type BoundedArenaEncounter = { [Key in keyof BoundedArenaEncounterFields]: BoundedArenaEncounterFields[Key] };
