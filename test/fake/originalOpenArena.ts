// Frozen native Storm Titan shell and projection before open/closed lifecycle convergence.
import type { ArenaScriptData,ArenaScriptRows,ArenaScriptFightFile } from '@wildshard/format/arenaScriptRows';
import { installEnteredRuntimeService } from '../../src/client/game/shard/retainedHooks';
/** Client projection of the G474 arena-script boss contract. Authored inputs
 * are rows; entered native owners supply rendering, health, riding and kit. */
import * as THREE from 'three';
import type { Game } from '@wildshard/engine/core/Game';
import type { Player } from '@wildshard/engine/player/Player';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import type { BossScript } from '@wildshard/engine/ai/BossBrain';
import type { TargetAnimal, TargetHit } from '@wildshard/engine/combat/types';
import type { AimTarget } from '@wildshard/engine/player/AimTargets';
import type { BossBar } from '@wildshard/engine/ui/BossBar';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import type { WeatherContinuation } from '@wildshard/engine/world/weatherContinuation';
import { app } from '@wildshard/engine/app/runtime';
import { TIER } from '@wildshard/engine/core/tier';
import { listenPage } from '@wildshard/engine/input/dom';
import { terrainHeight as heightAt } from '@wildshard/engine/world/terrainHeight';
import { wind } from '@wildshard/engine/world/steppeWind';
import { canReach } from '@wildshard/engine/ai/reach';
import { StrikeRunner, type StrikeSpec } from '@wildshard/engine/ai/strikes';
import { strikeFromData } from '@wildshard/engine/ai/strikeRows';
import { modelContext, type ModelDef } from '@wildshard/engine/models/model';
import { Rng } from '@wildshard/engine/core/rng';
import type { ShardContext } from '../../src/client/game/plugin/context';
import { installChannelPrograms } from '../../src/shared/game/plugin/channelPrograms';
import type { WeatherReactions } from '../../src/server/game/weather/reactions';
import type { ShardProduct } from '../../src/shared/game/shardfile/shardProduct';
import { installBossEncounter, type Boss } from '../../src/client/game/Boss';
import { ProjectedState, ReturnProgram } from '../../src/shared/game/population/returnProgram';
import { wildEnv } from '../fixtures/pageWildEnvironment';
import { setEliteDamage } from '@wildshard/engine/entities/eliteBrain';
import { CellField } from '../../src/shared/game/systems/cellField';
import { ArenaFireView, ArenaWhirlsView } from './originalArenaFire';
import { ArenaSceneView, CloudBody, type PatrolEncounterView } from '../../src/client/game/boss/encounterView';
import type { GroundTell } from '../../src/client/game/eliteView';
import type { ArcWeaponPower } from '../../src/client/game/weapons/arcPower';
import type { HeldClaims, HeldSlotKit } from '../../src/client/game/loadout/claims';
import type { CosmeticFinishLocker } from '../../src/client/game/loadout/cosmeticFinishes';
import { enteredAdventurePersistence } from '../../src/shared/game/quest/chapterBindings';
import {pageRidingMount,respawnPageMounted,arenaBlockedAt,installArenaBoundary,type ArenaBoundary} from '../../src/client/game/riding/client';
import type { Mount } from '../../src/client/game/riding/mount';

/** Read schema-checked named products; no validator is imported into play. */
export async function readArenaScriptData(product: Pick<ShardProduct,'json'>, files: { fight: string; geometry: string }): Promise<ArenaScriptData> {
  const [root,geometry]=await Promise.all([product.json<ArenaScriptFightFile>(files.fight),product.json<ArenaScriptData['geometry']>(files.geometry)]);
  return {...root.arenaScript,programs:root.programs,arenaFire:root.arenaFire,geometry};
}
/** Native cloud resources are identical for an entered fight and its specimen. */
export function arenaScriptCloud(scene: THREE.Scene, state: Readonly<Record<string,number>>, data: ArenaScriptData): CloudBody {
  const g = data.geometry;
  return new CloudBody(scene,{ ...g.body,geometry: { ...g.body.geometry,eyes: g.eyes },poses: g.poses,
    puffs: { ...g.body.puffs,rows: g[TIER].puffs } },state,new Map([['place',{ ...data.arena.body,ground: heightAt(data.arena.ground.x,data.arena.ground.z) }]]));
}
export interface ArenaScriptWorld { readonly game: Game; readonly player: Player; readonly weather: WeatherReactions; readonly air: WeatherContinuation; readonly tieSpot: THREE.Vector3 | null }
interface SupportActor { readonly a: Animal; readonly lane: GroundTell; readonly law: ProjectedState }
interface Chain { readonly tell:GroundTell; readonly row:ArenaScriptData['clocks']['landings'][number] }
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _ray = new THREE.Ray(), _sph = new THREE.Sphere(), _hitP = new THREE.Vector3();
export class ArenaScriptFight implements BossScript {
  private readonly data: ArenaScriptData;
  readonly body: CloudBody;
  /** the body's pose, set by the fight and read by its channel rows */
  readonly pose:ArenaScriptRows['pose'];
  get phase(): number { return this.life.value('phase'); }
  get hp(): number { return this.life.value('hp'); }
  private set hp(hp: number) { this.life.event('support',{ hp,broke: Number(this.domeBroken) }); }
  private get invuln(): boolean { return this.life.value('invuln')===1; }
  private get fighting(): boolean { return this.life.value('fighting')===1; }
  private get open(): boolean { return this.life.value('open')===1; }
  private get victoryT(): number { return this.life.value('victoryT'); }
  // the spear
  readonly spearAt = new THREE.Vector3();
  // phase II
  private stormRiders: SupportActor[] = [];
  private readonly support: ProjectedState;
  private get domeBroken(): boolean { return this.life.value('broke')===1; }
  private set domeBroken(on: boolean) { this.life.event('support',{ hp: this.hp,broke: Number(on) }); }
  // phase III
  private readonly field: CellField;
  private fireOn = false;
  private readonly fire: ArenaFireView;
  private readonly chains: Chain[];
  private get chainLeft(): number { return this.clocks.value(this.data.clocks.left); }
  readonly clocks:ProjectedState;
  private readonly clockRandom=app.rng.stream('ai');
  private readonly whirls: ArenaWhirlsView;
  // the seal
  private readonly arena: ArenaSceneView;
  private get sealed(): boolean { return this.life.value('sealed')===1; }
  private introT = -1;
  private hazardDt = 0;
  readonly boundary: ArenaBoundary;
  private boundaryEffect: Readonly<Record<string,number>> | null = null;
  private readonly author: ReturnProgram;
  readonly life: ProjectedState;
  private readonly fightDraw: ReturnType<typeof installChannelPrograms>;
  private readonly viewRead = { fighting: 0, victoryT: -1, phase: 0, domeBroken: 0, open: 0, flash: 0 };

  constructor(private readonly ctx: ArenaScriptWorld, private readonly host: OriginalOpenArenaEncounter, data: ArenaScriptData) {
    this.data = data; this.pose={...data.pose};
    const scene = ctx.game.scene;
    const clocks=this.data.clocks;
    const state=clocks.frame.initial,outputs=clocks.frame.outputs,channels=data.programs.attack.v2?.channels,retain=Object.entries(clocks.frame.retain),slots=clocks.landings.flatMap(row=>[row.on,row.t,row.x,row.z]);
    if(clocks.frame.parameters[clocks.count]!==clocks.landings.length||new Set(slots).size!==slots.length||outputs===undefined
      ||[clocks.left,...slots,...retain.map(([,slot])=>slot)].some(key=>!Object.hasOwn(state,key))
      ||new Set(retain.map(([,slot])=>slot)).size!==Object.keys(state).length
      ||[...retain.map(([channel])=>channel),'strike','stuck','hurt','spread',clocks.spear,...clocks.landings.flatMap(row=>[row.strike,row.hurt])].some(key=>!outputs.includes(key))
      ||channels!==undefined&&outputs.some(key=>!channels.includes(key))
      ||Object.keys(clocks.clear).length!==slots.length||slots.some(key=>!Object.hasOwn(clocks.clear,key)||!Object.is(clocks.clear[key],state[key])))throw new Error('Invalid encounter clock bank');
    ProjectedState.preflight(data.script.fight,ReturnProgram.projectionBindings(data.programs.attack));
    this.author=ReturnProgram.page(this.data.programs.attack,ctx.game.levelScope);
    this.clocks=new ProjectedState(clocks.frame,this.author);
    const windLaw = ReturnProgram.page(this.data.programs.wind, ctx.game.levelScope);
    this.field = new CellField(this.data.field, windLaw, app.rng.stream('ai'));
    this.boundary = { field: this.field,boundary: data.boundary,mask: 0 };
    this.life = new ProjectedState(this.data.script.fight,this.author);
    this.support = new ProjectedState({...this.data.support,signal:'couple'},this.author);
    this.body = arenaScriptCloud(scene, this.pose, data);
    this.fightDraw = installChannelPrograms(this.data.geometry.poses, this.data.view.group, new Map<string,unknown>([
      ['pose',this.pose],['alpha',this.body.alpha],['flash',this.body.flash],['fight',this.viewRead],
    ]));
    const arena = this.arena = new ArenaSceneView(scene, this.data.geometry.arena);
    this.chains=clocks.landings.map((row,i)=>({tell:arena.tell('chain',i),row}));
    this.whirls = new ArenaWhirlsView(this.data.whirls, windLaw, [arena.mesh('funnel0'), arena.mesh('funnel1'), arena.mesh('funnel2')], arena.instances('debris'));
    this.fire = new ArenaFireView(scene, this.data.arenaFire, (TIER === 'phone' ? this.data.geometry.phone : this.data.geometry.desktop).flames);
    this.fire.attachScorch(arena.instances('scorch'));
    const target = data.view.target;
    this.heartTarget = { kind: data.definition.id,position: new THREE.Vector3(),alive: true,damageFor: () => target.damage,applyDamage: amount => this.hitHeart(amount) };
    this.heartHit = { animal: this.heartTarget,point: new THREE.Vector3(),distance: 0,headshot: false };
    this.heartLock = { kind: data.definition.id,position: new THREE.Vector3(),alive: true,lockable: true,lockRange: target.range,dims: { bodyY: 0,bodyRadius: target.closed } };
  }

  // ── BossScript ──
  get hpFrac(): number { return Math.max(0, this.hp / this.data.place.heartHp); }
  get shielded(): boolean { return this.life.value(this.data.script.fight.retainEvents.step.shield)===1; }
  get dead(): boolean { return this.hp <= 0; }
  get heartOpen(): boolean {
    return this.open;
  }
  inArena(_p: THREE.Vector3): boolean { return this.life.value(this.data.script.fight.retainEvents.step.enter)===1; }
  /** the strip is tied (the cairn's prompt) — the threshold */
  get tied(): boolean { return this.life.value('tied')===1; }
  set tied(on: boolean) { this.life.event('tied',{ amount: Number(on) }); }
  seal(on: boolean): void { this.life.event('seal',{ amount: Number(on) }); }
  clampHp(share: number): void { this.life.event('clamp',{ share }); }
  setInvulnerable(on: boolean): void { this.life.event('invulnerable',{ amount: Number(on) }); }
  private point(respawn: boolean): { x: number; z: number; yaw: number } {
    const at = this.cairnSpot(), center = this.data.arena.center, body = this.data.arena.body;
    const answer = this.life.event('point',{ x: at.x,z: at.z,cx: center.x,cz: center.z,bodyX: body.x,bodyZ: body.z,amount: Number(respawn) });
    return { x: answer['x'] ?? at.x,z: answer['z'] ?? at.z,yaw: answer['yaw'] ?? 0 };
  }
  rewardPoint(): THREE.Vector3 { const p = this.point(false); return new THREE.Vector3(p.x,heightAt(p.x,p.z)+this.data.view.reward.lift,p.z); }
  respawnPoint(): { pos: THREE.Vector3; yaw: number } { const p = this.point(true); return { pos: new THREE.Vector3(p.x,heightAt(p.x,p.z),p.z),yaw: p.yaw }; }
  cairnSpot(): THREE.Vector3 { return this.ctx.tieSpot ?? new THREE.Vector3(this.data.arena.anchor.x, heightAt(this.data.arena.anchor.x, this.data.arena.anchor.z), this.data.arena.anchor.z); }

  reset(phase: number): void {
    this.life.restart({ phase,share: this.data.phases[phase]?.at ?? 1,tied: Number(this.tied),sealed: Number(this.sealed) }); this.clocks.reset(); this.introT = -1;
    this.boundaryEffect = null; this.hazardDt = 0; this.boundary.mask = 0;
    const b = this.body;
    Object.assign(this.pose,this.data.pose);
    b.alpha.value = 1; b.part(this.data.view.dome).visible = false;
    b.setVisible(false);
    this.arena.tell('spear').hide(); this.arena.tell('fork').hide(); this.body.aim(null, 0);
    this.clearRiders();
    this.domeBroken = false; this.support.reset();
    this.clearFire();
    this.clocks.set(this.data.clocks.clear);for (const c of this.chains) c.tell.hide();
    this.whirls.reset();
  }

  intro(t: number, short: boolean): THREE.Vector3 {
    const b = this.body; if (!b.visible) b.setVisible(true);
    if (this.introT<0 || t-this.introT>=.1-1e-9) {
      this.introT = t; const answer = this.life.event('intro',{ t,amount: Number(short) });
      this.pose.rise = this.life.value(this.data.script.fight.retainEvents.intro.rise); this.pose.kneel = this.life.value(this.data.script.fight.retainEvents.intro.kneel);
      b.alpha.value = this.life.value(this.data.script.fight.retainEvents.intro.alpha); b.flash.value = answer['flash'] ?? b.flash.value;
      if (answer['strike']===1) this.bolt(this.data.arena.center.x+this.data.view.introBolt.x,this.data.arena.center.z+this.data.view.introBolt.z);
    }
    return b.focusWorld(_hitP);
  }

  begin(phase: number): void {
    this.phaseEffects(this.life.event('begin',{ phase }));
  }

  enterPhase(phase: number): void {
    this.phaseEffects(this.life.event('phase',{ phase }));
  }
  private phaseEffects(row: Readonly<Record<string,number>>): void {
    this.clocks.set({ mode: row['mode'] ?? 0, cd: row['cd'] ?? 0 }); this.arena.tell('spear').hide(); this.arena.tell('fork').hide(); this.body.aim(null, 0);
    this.pose.bend = this.data.pose.bend; this.pose.raise = this.data.pose.raise; this.pose.rise = row['rise'] ?? this.pose.rise;
    this.whirls.arm(row['mask'] ?? 0);
    if (row['arm'] === 1) { this.domeBroken = false; this.spawnRiders(); } else this.clearRiders();
    if (row['spread'] === 1) {
      this.fireOn = true;
      const p = this.host.player.position;
      for (const seed of this.data.seeds) this.ignite(p.x + seed.x, p.z + seed.z);
    }
    const line = this.data.phaseLines[row['index'] ?? -1]; if (line) this.host.feed(line);
  }

  takeBoundary(): Readonly<Record<string,number>> | null { const effect = this.boundaryEffect; this.boundaryEffect = null; return effect; }
  update(dt: number, t: number, fighting: boolean): void {
    const b = this.body, p = this.host.player.position;
    const boss = this.host.boss, center = this.data.arena.center;
    const decision = this.life.step(dt,{ px: p.x,pz: p.z,cx: center.x,cz: center.z,radius: this.data.place.arenaRadius,
      mounted: Number(this.host.mounted()),fighting: Number(fighting),mode: this.clocks.value('mode'),
      engaged: Number(this.host.engaged),storm: Number(this.ctx.weather.stormActive),armed: Number(boss?.state==='armed'),victory: Number(boss?.state==='victory') });
    this.hazardDt = decision.dt;
    if (decision.dt>0) {
      this.boundaryEffect = decision.values; this.boundary.mask = this.life.value(this.data.script.fight.retainEvents.step.mask);
      if (decision.values['show']===0) b.setVisible(false);
    }
    this.arena.update(dt, t, this.sealed);   // the wall rises / falls with the seal
    if (!b.visible && this.victoryT < 0) { this.updateFire(dt, t, false); return; }
    Object.assign(this.viewRead, { fighting: Number(fighting), victoryT: this.victoryT, phase: this.phase, domeBroken: Number(this.domeBroken), open: Number(this.heartOpen), flash: this.ctx.weather.flash });
    this.fightDraw.evaluate({ time: t, delta: dt, values: {} });
    const fog = this.ctx.game.scene.fog;
    if (fog) b.fogColour.copy(fog.color);
    // the dome
    b.part(this.data.view.dome).visible = b.visible && this.life.value(this.data.script.fight.retainEvents.step.dome)===1;
    if (this.life.value(this.data.script.fight.retainEvents.step.active)===1 && this.fighting) {
      const step = this.clocks.step(dt, { phase: this.phase, fighting: Number(fighting), px: p.x, pz: p.z }, this.clockRandom);
      if (this.life.value(this.data.script.fight.retainEvents.step.weapon)===1) this.updateSpear(step.values[this.data.clocks.spear]===1?step.values:undefined);
      if (this.life.value(this.data.script.fight.retainEvents.step.arm)===1 && step.dt>0) this.updateRiders(step.dt);
      if (this.life.value(this.data.script.fight.retainEvents.step.spread)===1 && step.dt>0) this.updateChains(step.values);
    }
    if (decision.dt>0) this.life.event('tell',{ t,mode: this.clocks.value('mode'),spearT: this.clocks.value('t'),chainLeft: this.chainLeft,bend: this.pose.bend,raise: this.pose.raise });
    const tell = this.life.state,slots=this.data.script.fight.retainEvents.tell,struck=tell[slots.struck],alpha=tell[slots.alpha];
    this.pose.bend += ((tell[slots.bend] ?? this.pose.bend)-this.pose.bend)*Math.min(1,dt*(tell[slots.bendRate] ?? 0));
    this.pose.raise += ((tell[slots.raise] ?? this.pose.raise)-this.pose.raise)*Math.min(1,dt*(tell[slots.raiseRate] ?? 0));
    this.pose.castL += ((tell[slots.castL] ?? 0)-this.pose.castL)*Math.min(1,dt*4);
    if (tell[slots.tell]===1) {
      this.arena.tell('spear').ring(this.spearAt.x,this.spearAt.z,tell[slots.ringRadius] ?? 0,tell[slots.ringAlpha] ?? 0);
      this.arena.tell('fork').ring(this.spearAt.x,this.spearAt.z,tell[slots.forkRadius] ?? 0,tell[slots.forkAlpha] ?? 0);
    } else { this.arena.tell('spear').hide(); this.arena.tell('fork').hide(); }
    for (const ring of this.chains) if (this.clocks.value(ring.row.on)===1) ring.tell.ring(this.clocks.value(ring.row.x),this.clocks.value(ring.row.z),tell[slots.chainRadius] ?? 0,tell[slots.chainAlpha] ?? 0);
    this.updateWhirls(dt, t, fighting && this.victoryT < 0, this.hazardDt);
    this.updateFire(dt, t, fighting && this.victoryT < 0, this.hazardDt);
    // the spear in his hand (raised) or stuck in the meadow
    b.aim(struck===1 ? this.spearAt : null,b.visible ? alpha ?? 0 : 0);
    b.update(t, this.ctx.game.camera);
  }

  victory(): void {
    this.life.event('victory');
    this.clocks.set({ mode: 0 }); this.arena.tell('spear').hide(); this.arena.tell('fork').hide();
    this.clocks.set(this.data.clocks.clear);for (const c of this.chains) c.tell.hide();
    for (const l of this.arena.tells('lane')) l.hide();
    this.clearRiders();
    // the rain puts the fire out: every burning cell goes to black
    for (const cell of this.field.deactivate()) this.addScorch(cell);
    this.fireOn = false;
    this.fire.out();
    this.whirls.arm(0);
  }

  // ── the heart as a target (main's Targets chain) ──

  private readonly heartTarget: TargetAnimal;
  private readonly heartHit: TargetHit;
  private readonly heartLock: AimTarget;
  lockTarget(): AimTarget | null {
    if (!this.fighting || !this.body.visible || this.victoryT >= 0) return null;
    this.body.focusWorld(this.heartLock.position); this.heartLock.alive = !this.dead;
    return this.heartLock;
  }

  target(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, hit: TargetHit | null): TargetHit | null {
    if (!this.fighting || !this.body.visible || this.victoryT >= 0) return hit;
    const best = hit !== null ? Math.min(maxDist, hit.distance) : maxDist;
    this.body.focusWorld(_hitP);
    _sph.set(_hitP, this.heartOpen ? this.data.view.target.open : this.data.view.target.closed);
    _ray.set(origin, dir);
    if (_ray.intersectSphere(_sph, _v) === null) return hit;
    const d = _v.distanceTo(origin);
    if (d > best) return hit;
    this.heartTarget.position.copy(_hitP); this.heartTarget.alive = !this.dead;
    this.heartHit.point.copy(_v); this.heartHit.distance = d; this.heartHit.headshot = this.heartOpen;
    return this.heartHit;
  }

  private hitHeart(amount: number): boolean {
    const answer = this.life.event('damage',{ amount,mode: this.clocks.value('mode') });
    if (answer['show']===1) this.host.toast(this.data.immuneLines[answer['index'] ?? 0] ?? '');
    if (answer['flash']===1) this.body.flash.value = 1;
    return this.dead;
  }

  // ── I · the Sky Spear ──

  private updateSpear(answer: Readonly<Record<string, number>> | undefined): void {
    if (answer !== undefined) {
      const n = (key: string): number => { const value = answer[key]; if (value === undefined) throw new Error('Missing attack decision'); return value; };
      this.spearAt.x = this.clocks.value('x'); this.spearAt.z = this.clocks.value('z');
      if (n('strike') === 1) {
        this.spearAt.y = heightAt(this.spearAt.x, this.spearAt.z); this.bolt(this.spearAt.x, this.spearAt.z);
        if (n('hurt') === 1 && this.host.contact('spear', this.spearAt, this.data.tuning.spearDamage, this.data.lines.spear)) this.host.throwRider();
        if (n('spread') === 1) this.ignite(this.spearAt.x, this.spearAt.z);
      }
      if (n('stuck') === 1) this.host.feed(this.data.lines.spearStuck);
    }
  }

  // ── II · the Three Winds ──

  private spawnRiders(): void {
    this.clearRiders();
    const gr = this.host.riderOwner();
    if (gr === null) { this.domeBroken = true; return; }
    for (const [i, site] of this.data.supportSites.entries()) {
      const { x, z } = site;
      const a = gr.spawnRider({ x, z, yaw: 0, variant: this.data.view.quietVariant, quiet: true });
      if (a === null) continue;
      const lane = this.arena.tells('lane')[i];
      if (lane === undefined) continue;
      const rows=this.data.support,actors=rows.actors;if(actors===undefined)throw new Error('Missing support actor rows');
      const law=new ProjectedState({initial:{...rows.member,theta:site.theta},parameters:rows.parameters,signals:rows.signals,signal:'member'},this.author),player=this.host.player.position;
      a.maxHp=actors.hp;a.hp=actors.hp;
      setEliteDamage(a,(body,point)=>law.event('damage',{x:point.x,z:point.z,px:player.x,pz:player.z,radius:body.scale})['alpha']??1);
      const r: SupportActor = { a,lane,law };
      this.stormRiders.push(r);
    }
  }

  private clearRiders(): void {
    const gr = this.host.riderOwner();
    for (const r of this.stormRiders) { setEliteDamage(r.a,()=>1);r.lane.hide(); if (r.a.alive && gr !== null) { r.a.alive = false; gr.dissolve(r.a); } }
    this.stormRiders = [];
    for (const l of this.arena.tells('lane')) l.hide();
  }

  private updateRiders(dt: number): void {
    const p=this.host.player.position,riders=this.stormRiders,rows=this.data.support;
    const frame={dt,px:p.x,pz:p.z,hp:this.hp,invuln:Number(this.invuln)};
    const state=this.support.project({...frame,count:riders.length},app.rng.stream('ai'),riders.map(({a,law})=>({x:a.position.x,z:a.position.z,hit:Number(a.alive),mode:law.value('mode')})));
    const selected=riders[state['index']??-1];
    if(selected!==undefined){
      selected.law.set(rows.commit);
      selected.law.set(Object.fromEntries(['x0','z0','x1','z1'].map(key=>[key,state[key]??0] as const)));
    }
    this.hp=state['hp']??this.hp;
    for(let i=riders.length-1;i>=0;i--){
      const r=riders[i];if(r===undefined)continue;
      if(((state['mask']??0)&(1<<i))!==0){
        setEliteDamage(r.a,()=>1);r.lane.hide();riders.splice(i,1);
        this.host.feed(riders.length>0?this.data.lines.riderBreaks+this.data.view.remaining.replace('{count}',String(riders.length)):this.data.lines.lastRider);continue;
      }
      const a=r.a,answer=r.law.project({...frame,ax:a.position.x,az:a.position.z});
      const n=(key:string):number=>{const value=answer[key];if(value===undefined)throw new Error('Missing support decision');return value;};
      for(const [slot,channel]of Object.entries(rows.actors?.memory??{}))a.mem[slot]=n(channel);
      if(n('show')===1)r.lane.lane(r.law.value('x0'),r.law.value('z0'),r.law.value('x1'),r.law.value('z1'),4.2,n('alpha'));else r.lane.hide();
      if(n('hurt')===1&&this.host.contact('wind',a.position,this.data.tuning.chargeDamage,this.data.lines.charge))this.host.throwRider();
    }
    if(state['broke']===1&&!this.domeBroken){this.domeBroken=true;this.body.flash.value=1;}
  }

  // ── III · the grass fire + chain lightning ──

  private ignite(x: number, z: number): void { this.field.activate(x, z); }
  private addScorch(c: number): void {
    this.fire.scorchCell(this.field, c);
    wildEnv.trample(this.field.x(c), this.field.z(c), this.data.tuning.cell * 0.6, 1, 0, 0);   // the grass burnt flat
  }
  private clearFire(): void { this.field.clear(); this.fire.clear(); this.fireOn = false; }

  private updateFire(dt: number, t: number, live: boolean, thinkDt = 0): void {
    this.fire.update(dt, t, wind.dirX, wind.dirZ, wind.speed, this.body.fogColour, this.body.flash.value);
    if (!this.fireOn) return;
    if (live) for (const cell of this.field.update(dt, { wx: wind.dirX, wz: wind.dirZ })) this.addScorch(cell);
    this.fire.drawField(this.field, dt, wind.dirX, wind.dirZ);
    if (!live || thinkDt <= 0) return;
    // the player in fire: 8 / s; the horse panics near it
    const p = this.host.player.position;
    const contact = this.field.sense(thinkDt, p, { mounted: Number(this.host.mounted()) });
    if ((contact['hurt'] ?? 0) > 0) this.host.contact('fire', p, contact['hurt'] ?? 0, this.data.lines.burning);
    if ((contact['speed'] ?? 0) < 0) this.host.horseSteed(contact['speed'] ?? 0);
  }

  private updateChains(values:Readonly<Record<string,number>>):void {
    const p=this.host.player.position;
    for(const chain of this.chains)if(values[chain.row.strike]===1){
      const x=this.clocks.value(chain.row.x),z=this.clocks.value(chain.row.z);
      chain.tell.hide();this.bolt(x,z);this.ignite(x,z);
      if(values[chain.row.hurt]===1)this.host.contact('chain',_v.set(x,p.y,z),this.data.tuning.chainDamage,this.data.lines.chain);
    }
  }

  // ── whirlwinds: touching one lifts you out of the saddle ──

  private updateWhirls(dt: number, t: number, live: boolean, thinkDt: number): void {
    const p = this.host.player.position;
    for (const at of this.whirls.update(dt, t, live, thinkDt, { wx: wind.dirX, wz: wind.dirZ, px: p.x, pz: p.z }))
      if (this.host.contact('whirl', at, this.data.tuning.whirlDamage, this.data.lines.whirl)) this.host.throwRider();
  }

  // ── a strike from the sky ──
  private bolt(x: number, z: number): void {
    const y = heightAt(x, z);
    this.ctx.weather.raise(this.data.weather.strike, { x, y, z, kind: 0 });
    this.ctx.weather.flash = 1;
    this.body.flash.value = 1;
    wildEnv.onEvent('lightning', x, z);
  }

  /** the storm wall and the fire line the horse will not ride into */
  refuses(x: number, z: number): boolean {
    return arenaBlockedAt(this.field, { x, z }, this.data.boundary, this.life.value(this.data.script.fight.retainEvents.step.mask));
  }
}

// ─────────────────────────────── the wiring ───────────────────────────────



/** The entered native owner supplies all effects. No authored function is an
 * argument to this constructor or to bind; resources remain with their owners. */
export class OriginalOpenArenaEncounter {
  readonly fight: ArenaScriptFight;
  readonly spareLight: THREE.PointLight;
  boss: Boss | null = null; ui: BossBar | null = null;
  power: ArcWeaponPower | null = null;
  riders: PatrolEncounterView | null = null;
  mount: Mount | null = null;
  private context: ShardContext | null = null;
  private kit: HeldSlotKit | null = null;
  private readonly prompt: Interactable;
  private readonly contacts = new Map<string,StrikeSpec>();
  private readonly strikes = new StrikeRunner();
  private skipEnter = false; private skipTouch = false;
  private hurtWhy = ''; private hurtT = 0;
  constructor(readonly world: ArenaScriptWorld, readonly data: ArenaScriptData) {
    for (const [name,row] of Object.entries(data.contacts)) this.contacts.set(name,strikeFromData(row));
    this.fight = new ArenaScriptFight(world,this,data);
    this.spareLight = new THREE.PointLight(data.view.light.colour,0,1,2);
    this.spareLight.position.set(data.arena.body.x,data.view.light.y,data.arena.body.z); world.game.scene.add(this.spareLight);
    const spot = this.fight.cairnSpot();
    this.prompt = { position: new THREE.Vector3(spot.x,spot.y+data.view.promptLift,spot.z),radius: 0,label: data.lines.tie,onInteract: () => { this.tie(); } };
  }
  get player(): Player { return this.world.player; }
  get engaged(): boolean { return this.boss?.engaged === true; }
  riderOwner(): PatrolEncounterView | null { return this.riders; }
  mounted(): boolean { return this.mount?.mounted === true; }
  throwRider(): void { if (this.mount?.mounted === true) this.mount.dismount(true); }
  horseSteed(amount: number): void { if (this.mount !== null) this.mount.steed = Math.max(0,this.mount.steed+amount); }
  toast(message: string): void { this.context?.game.runtime?.play?.hud.toast(message); }
  feed(message: string): void { this.context?.game.runtime?.play?.hud.killFeed(message); }
  hurt(amount: number, why: string): void {
    const ctx = this.context, target = ctx?.app.player;
    if (ctx === null || ctx.scope.disposed || target === undefined || target === null) return;
    const say = why !== this.hurtWhy || this.hurtT <= 0;
    if (say) { this.hurtWhy = why; this.hurtT = this.data.view.notice; }
    ctx.app.combat.hit({ source: 'env',sourceTags: [`boss.${this.data.record.kind}`,'feel.jolt','cover.checked'],target,amount,
      point: this.player.position.clone(),dir: new THREE.Vector3(),cause: { kind: this.data.record.kind,label: this.data.definition.name },toast: say ? why : '' });
  }
  contact(name: string, origin: THREE.Vector3, amount: number, why: string): boolean {
    const row = this.contacts.get(name), target = this.player.position;
    if (!this.data.whole.includes(name)) {
      if (row === undefined) throw new Error('Missing arena contact');
      if (!this.strikes.contains(row,{ actor: { position: origin,scale: 1,yaw: 0 },target })) return false;
      if (!row.tags.includes('cover.exempt')) {
        const anchor = { position: origin,scale: 1,alive: true,dims: { bodyY: 1.2,bodyRadius: .1 },
          headWorld: (out: THREE.Vector3) => out.copy(origin).add(_w.set(0,1.2,0)) };
        if (!canReach(anchor,target,this.world.game.app.physics)) return false;
      }
    }
    this.hurt(amount,why); return true;
  }
  /** Bind the concrete kit, saved owner, native cosmetic locker and specimen. */
  bind(ctx: ShardContext, kit: HeldSlotKit, arsenal: HeldClaims, rewardModel: ModelDef<object>, locker: CosmeticFinishLocker): void {
    const runtime = ctx.game.runtime, play = runtime?.play;
    if (runtime === undefined || play === undefined || play === null) throw new Error('Arena script requires entered play');
    const health = ctx.app.player;
    installEnteredRuntimeService(ctx, entered => { health?.checkpoint(entered, () => this.onPlayerDeath(), () => ctx.app.player === health); });
    this.context = ctx; this.kit = kit; this.mount = pageRidingMount(ctx);
    const { game,player } = this.world, power = new (arsenal.blade('blade').Power)({ scene: game.scene,player,camera: game.camera,
      animals: play.animals,weather: this.world.weather,scope: ctx.scope });
    this.power = power;
    const saved = enteredAdventurePersistence(ctx.scope), row = this.data;
    const encounter = installBossEncounter({ definition: row.definition,reward: row.reward },() => this.fight,{
      game,player,spareLight: this.spareLight,scope: ctx.scope,chunkId: ctx.product.slug,interactables: runtime.interactables,persistence: saved.bosses,
      reward: { model: () => {
        const model = rewardModel.build(modelContext(game.sky),rewardModel.defaults,new Rng(0));
        if (!(model instanceof THREE.Object3D)) throw new Error('Arena reward requires a native specimen'); return model;
      },grant: () => { kit.upgradeBlade('blade-reward',play.weapons,power); locker.own(row.skin.id); play.hud.toast(row.skin.toast); } },
      lockInput: on => { play.weapons.setEnabled(!on); player.moveScale = on ? 0 : 1; },
      respawn: (pos,yaw) => { respawnPageMounted(ctx,pos,yaw,row.view.respawn); kit.refill(); },
      skipHeld: () => this.skipEnter || this.skipTouch || ctx.app.input.held('jump') || ctx.app.input.held('use'),
      toast: message => { play.hud.toast(message); },feed: message => { play.hud.killFeed(message); },pickupHum: on => { play.audio.pickupHum(on); },
      music: event => { if (event === 'death' || event === 'pickup') play.music.sting(event); else if (event === 'victory') play.music.sting('chunk'); else play.music.combat(1); },
    });
    this.boss = encounter.boss; this.ui = encounter.ui; runtime.interactables.push(this.prompt);
    if (encounter.boss.rewardTaken) kit.upgradeBlade('blade-reward',play.weapons,power);
    installArenaBoundary(ctx.scope,this.fight.boundary);
    listenPage(ctx.scope,'keydown',event => { if (event instanceof KeyboardEvent && event.code === 'Enter') this.skipEnter = true; });
    listenPage(ctx.scope,'keyup',event => { if (event instanceof KeyboardEvent && event.code === 'Enter') this.skipEnter = false; });
    listenPage(ctx.scope,'pointerdown',() => { this.skipTouch = true; });
    listenPage(ctx.scope,'pointerup',() => { this.skipTouch = false; });
    listenPage(ctx.scope,'pointercancel',() => { this.skipTouch = false; });
    ctx.debug.expose(row.view.debug,this);
  }
  private tie(): void {
    const boss = this.boss; if (boss === null) return;
    const answer = this.fight.life.event('tie',{ engaged: Number(this.engaged),victory: Number(boss.state==='victory'),
      hit: Number(boss.reward!==null),mounted: Number(this.mounted()),storm: Number(this.world.weather.stormActive) });
    if (answer['arm']===1) { this.fight.tied = true; if (answer['disarm']===1) boss.disarm(); boss.arm(); }
    const line = this.data.tieLines[answer['index'] ?? -1]; if (line) this.toast(line);
  }
  devStartAt(phase: number): void {
    this.world.air.force(this.data.weather.storm,.1);
    const at = this.fight.respawnPoint(), ctx = this.context;
    if (ctx !== null) respawnPageMounted(ctx,at.pos,at.yaw,this.data.view.respawn);
    this.fight.tied = true; this.boss?.devStartAt(phase);
  }
  onPlayerDeath(): boolean { return this.boss?.onPlayerDeath() ?? false; }
  update(dt: number, t: number): void {
    this.power?.update(dt,t); this.hurtT -= dt;
    const boss = this.boss; if (boss === null || this.context === null || this.kit === null) return;
    if (boss.state !== 'dormant' || this.fight.body.visible) boss.update(dt,t); else this.fight.update(dt,t,false);
    const answer = this.fight.takeBoundary(); if (answer === null) return;
    this.prompt.radius = answer['radius'] ?? 0;
    this.prompt.label = answer['label']===1 ? this.data.lines.tieOnFoot : answer['label']===2 ? this.data.lines.tieQuiet : this.data.lines.tie;
    if (answer['disarm']===1) { this.fight.tied = false; boss.disarm(); }
    const p = this.player.position; p.x = answer['x'] ?? p.x; p.z = answer['z'] ?? p.z;
    if (answer['hurt']===1) this.contact('wall',p,this.data.view.wallDamage,this.data.lines.wall);
    if (answer['clear']===1) {
      this.fight.tied = false; this.world.air.force(this.data.weather.clearing);
      const saved = enteredAdventurePersistence(this.context.scope); saved.kill(this.data.record.kind,this.data.record.variant); saved.feat(this.data.record.kind);
    }
  }
  target(origin: THREE.Vector3, dir: THREE.Vector3, max: number, hit: TargetHit | null): TargetHit | null { return this.fight.target(origin,dir,max,hit); }
  lockTarget(): AimTarget | null { return this.fight.lockTarget(); }
}
