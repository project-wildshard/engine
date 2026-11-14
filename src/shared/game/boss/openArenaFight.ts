import * as THREE from 'three';
import type { BossScript } from '@wildshard/engine/ai/BossBrain';
import type { Rng } from '@wildshard/engine/core/rng';
import type { Scope } from '@wildshard/engine/app/scope';
import type { TargetAnimal, TargetHit } from '@wildshard/engine/combat/types';
import type { AimTarget } from '@wildshard/engine/player/AimTargets';
import { terrainHeight as heightAt } from '@wildshard/engine/world/terrainHeight';
import { wind } from '@wildshard/engine/world/steppeWind';
import type { ArenaScriptData, ArenaScriptFightFile, ArenaScriptRows } from '@wildshard/format/arenaScriptRows';
import { ARENA_BURNT_PER_FRAME, ARENA_VIEW } from '@wildshard/format/arenaView';
import { ARENA_TELL_CALLS, OPEN_ARENA_VIEW } from '../shardfile/wirePrompts';
import { V2_ACTION_OPS, type V2ActionBinding } from '@wildshard/format/scriptActionsV2';
import { ReturnProgram, ProjectedState, type ProjectedSnapshot } from '../population/returnProgram';
import { installChannelPrograms } from '../plugin/channelPrograms';
import { CellField, type CellFieldSnapshot } from '../systems/cellField';
import { prepareV2WorldActions, type V2WorldActionLoan } from '../shardfile/worldActionsV2';
import type { ViewCamera, ViewTell } from '@wildshard/engine/script/viewProgram';
import type { ShardFolder } from '../shardfile/shardFolder';
import type { Mount } from '../../../client/game/riding/mount';
import type { ArenaBoundary } from '../../../client/game/riding/client';
import type { WeatherReactions } from '../../../server/game/weather/reactions';
import type { ArenaFireView, ArenaWhirlsView } from '../../../client/game/boss/arenaFire';
import type { ArenaWhirlsSnapshot } from './arenaWhirls';
import type { ArenaSceneView, CloudBody } from '../../../client/game/boss/encounterView';

/** The fight's rows: its fight file's arena script, programs and fire with its geometry file (the page's entered
 *  encounter and the Node simulation read the same). */
export async function readArenaScriptData(product: Pick<ShardFolder,'json'>, files: { fight: string; geometry: string }): Promise<ArenaScriptData> {
  const [root,geometry]=await Promise.all([product.json<ArenaScriptFightFile>(files.fight),product.json<ArenaScriptData['geometry']>(files.geometry)]);
  // T10: the fight's two programme declarations are read-only; frozen, ReturnProgram admits each once (its frozen-input
  // memo) instead of re-parsing it in projectionBindings, page and prepareMemory (two 8-11 ms parses inside the encounter's
  // constructor frame of a Nalati drive at phone 4x)
  for (const program of [root.programs.attack, root.programs.wind]) freezeDeclaration(program);
  return {...root.arenaScript,programs:root.programs,arenaFire:root.arenaFire,geometry};
}
function freezeDeclaration(value: unknown): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeDeclaration(child);
  Object.freeze(value);
}
/** The fight's looks, as the parts it calls (the page passes its views; the Node simulation its own). */
export type ArenaBodyPort = Pick<CloudBody, 'alpha' | 'flash' | 'fogColour' | 'setVisible' | 'visible' | 'aim' | 'focusWorld'> & {
  readonly part: (key: string) => { visible: boolean };
  readonly update: (t: number, camera: ViewCamera) => void;
};
/** What the fight writes of an instanced draw: a page lends the mesh, a server this count. */
export interface ArenaDraw { count: number }
/** CI12: a ground tell as the fight draws it: what its view module (the spear, fork and chain rings) and its riders' lanes
 *  call. The page's tells are Elite's GroundTell; a native host's draw nothing. */
export type ArenaTell = ViewTell;
/** The arena's scene as the fight uses it (the page's ArenaSceneView). */
export interface ArenaScenePort<D extends ArenaDraw = THREE.InstancedMesh> {
  readonly tell: (key: string, index?: number) => ArenaTell; readonly tells: (key: string) => readonly ArenaTell[];
  readonly instances: (key: string) => D; readonly mesh: ArenaSceneView['mesh']; readonly update: ArenaSceneView['update'];
}
export type ArenaFirePort<D extends ArenaDraw = THREE.InstancedMesh> = Pick<ArenaFireView, 'update'> & { readonly smoke: D; readonly flames: D };
export type ArenaWhirlsPort = Pick<ArenaWhirlsView, 'arm' | 'reset' | 'update' | 'bindView' | 'snapshot' | 'restore' | 'drawn' | 'drawHeard'>;
/** Each look made once, in the fight's construction order: the body (over the fight's pose), the arena, its whirl funnels
 *  (over the arena, the wind law, the attack program and the level scope) and the fire. */
export interface OpenArenaViews<D extends ArenaDraw = THREE.InstancedMesh> {
  readonly body: (pose: Readonly<Record<string, number>>) => ArenaBodyPort;
  readonly arena: () => ArenaScenePort<D>;
  readonly whirls: (arena: ArenaScenePort<D>, wind: ReturnProgram, author: ReturnProgram, scope: Scope) => ArenaWhirlsPort;
  readonly fire: () => ArenaFirePort<D>;
  /** the whirlwind rows' admission against the attack program's bindings (ArenaWhirlsView.preflight), run in place */
  readonly whirlsPreflight: (rows: ArenaScriptData['whirls'], bindings: ReturnType<typeof ReturnProgram.projectionBindings>) => void;
}
/** The fight's world: its level's scope (its programs' owner), the weather it reads and raises, the cairn spot, the AI
 *  random stream, the scene's fog and camera (its body's look), the wildlife it alerts and flattens grass for, and whether
 *  the page is the phone tier (the smoke's rate). */
export interface OpenArenaFightWorld {
  readonly scope: Scope; readonly weather: Pick<WeatherReactions, 'stormActive' | 'flash' | 'raise'>; readonly tieSpot: THREE.Vector3 | null;
  readonly ai: () => Rng; readonly fog: () => { readonly color: THREE.Color } | null; readonly camera: ViewCamera;
  readonly wild: { readonly trample: (x: number, z: number, radius: number, strength: number, vx: number, vz: number) => void; readonly onEvent: (name: string, x: number, z: number) => void }; readonly phone: boolean;
  /** CI12: the ground's height and the steppe wind the fight reads (absent: the page's terrainHeight and steppe wind) */
  readonly ground?: (x: number, z: number) => number;
  readonly wind?: { readonly dirX: number; readonly dirZ: number; readonly speed: number };
}
/** CI12: a support rider's body as the fight reads and writes it (a page Animal, or a native host's hunt body). */
export interface ArenaSupportBody { readonly position: THREE.Vector3; alive: boolean; maxHp: number; hp: number; readonly mem: Record<string, number> }
/** A rider its owner spawned: its body, its damage share (a law of the hit body's scale and the hit point, null: whole
 *  damage) and its dissolve. */
export interface ArenaSupportRider {
  readonly body: ArenaSupportBody;
  readonly share: (law: ((scale: number, x: number, z: number) => number) | null) => void;
  readonly dissolve: () => void;
}
/** The riders' owner: the page's patrol view (arenaRoom.ts), or a native host's. */
export interface ArenaRiderOwner {
  readonly spawnRider: (at: { readonly x: number; readonly z: number; readonly yaw: number; readonly variant?: string; readonly quiet?: boolean }) => ArenaSupportRider | null;
}
/** What the fight asks of its encounter: the player, the boss's state, the mount, contacts and the HUD lines. */
export interface OpenArenaFightHost {
  readonly player: { readonly position: THREE.Vector3 }; readonly boss: { readonly state: string } | null; readonly engaged: boolean;
  readonly mounted: () => boolean; readonly contact: (name: string, origin: THREE.Vector3, amount: number, why: string) => boolean;
  readonly throwRider: () => void; readonly horseSteed: (amount: number) => void; readonly feed: (message: string) => void;
  readonly toast: (message: string) => void; readonly riderOwner: () => ArenaRiderOwner | null;
  /** The heart's health curve (J104), dividing each hit: absent, or 1, for one player. */
  readonly heartScale?: () => number;
}
interface SupportActor { readonly rider: ArenaSupportRider; readonly a: ArenaSupportBody; readonly lane: ArenaTell; readonly law: ProjectedState }
/** the view module's cells (format/arenaView `cells`): the eased pose and the aim's operands */
export type ArenaPoseCells = Record<'bend' | 'raise' | 'castL' | 'struck' | 'alpha', { value: number }>;
const POSE_CELLS = ['bend', 'raise', 'castL', 'struck', 'alpha'] as const;
/** CI12: the fight's whole continuation as data (`OpenArenaFight.snapshot`). The host's own parts stay the host's: the `ai`
 *  stream every draw comes from, the weather, the riders' actors (handed back by site on restore) and the player. */
export interface OpenArenaFightSnapshot {
  readonly life: ProjectedSnapshot; readonly clocks: ProjectedSnapshot; readonly support: ProjectedSnapshot;
  readonly field: CellFieldSnapshot; readonly whirls: ArenaWhirlsSnapshot;
  readonly pose: Readonly<Record<string, number>>; readonly spear: readonly [number, number, number];
  readonly fireOn: boolean; readonly fireClear: boolean; readonly burnt: readonly number[];
  readonly hazardDt: number; readonly boundary: { readonly mask: number; readonly effect: Readonly<Record<string, number>> | null };
  readonly riders: readonly { readonly site: number; readonly law: ProjectedSnapshot }[];
  readonly body: { readonly visible: boolean; readonly alpha: number; readonly flash: number; readonly dome: boolean };
  /** the heart target as last published to a ray (`combatTarget`: arrows stuck in it follow and recover from it) */
  readonly heart: { readonly position: readonly [number, number, number]; readonly alive: boolean };
  /** the view module's cells after its last frame (null: no view bound) */
  readonly view: Readonly<Record<typeof POSE_CELLS[number], number>> | null;
}
/** The view half's reading of a fight (`OpenArenaFight.viewLoan`). */
export interface OpenArenaViewLoan<D extends ArenaDraw = THREE.InstancedMesh> {
  readonly arena: ArenaScenePort<D>; readonly chains: readonly ArenaTell[]; readonly field: CellField; readonly groundAt: (x: number, z: number) => number;
  readonly fire: ArenaFirePort<D>; readonly scorch: D; readonly whirls: ArenaWhirlsPort; readonly phone: boolean;
  readonly smoke: readonly [number, number] | undefined; readonly wind: { readonly dirX: number; readonly dirZ: number; readonly speed: number };
  readonly burnt: Float32Array; readonly fireOn: () => boolean; readonly fireClear: () => boolean;
  readonly bindFire: (scope: Scope, frame: (dt: number, time: number) => boolean) => void;
}
interface Chain { readonly tell:ArenaTell; readonly row:ArenaScriptData['clocks']['landings'][number] }
const _openV = new THREE.Vector3(), _openRAY = new THREE.Ray(), _openSPH = new THREE.Sphere(), _openHITP = new THREE.Vector3();
/** The open arena's fight (Nalati's Storm Titan) as numbers and rules: its life, clocks, support riders, grass fire,
 *  whirlwinds, spear and chains, the heart as a target and its damage. Its looks are ports the page fills (the cloud body,
 *  the arena's tells and lanes, the fire, the scorch and the whirl funnels) and the Node simulation fills with its own;
 *  moved from the encounter unchanged, so the page fights the same numbers in the same order. */
export class OpenArenaFight<D extends ArenaDraw = THREE.InstancedMesh> implements BossScript {
  private readonly data: ArenaScriptData;
  readonly body: ArenaBodyPort;
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
  readonly spearAt: THREE.Vector3 = new THREE.Vector3();
  // phase II
  private stormRiders: SupportActor[] = [];
  private readonly support: ProjectedState;
  private readonly memberOutputs: readonly string[];
  private get domeBroken(): boolean { return this.life.value('broke')===1; }
  private set domeBroken(on: boolean) { this.life.event('support',{ hp: this.hp,broke: Number(on) }); }
  // phase III
  private readonly field: CellField;
  private fireOn = false;
  private readonly fire: ArenaFirePort<D>;
  /** the scorch decals' draw, the burnt-out cells not yet drawn, the frame's share of them, a reset the fire view has not
   *  seen yet, and the fire view's slot (R6: behaviour/titanFireView draws the flames, smoke and scorch) */
  private readonly scorch: D;
  private readonly burntQueue: number[] = [];
  private readonly burnt = new Float32Array(1 + ARENA_BURNT_PER_FRAME);
  private fireClear = false;
  private fireFrame: ((dt: number, time: number) => boolean) | null = null;
  private readonly chains: Chain[];
  private get chainLeft(): number { return this.clocks.value(this.data.clocks.left); }
  readonly clocks:ProjectedState;
  readonly scope:Scope;
  private readonly clockRandom: Rng;
  private readonly whirls: ArenaWhirlsPort;
  // the seal
  private readonly arena: ArenaScenePort<D>;
  private get sealed(): boolean { return this.life.value('sealed')===1; }
  private hazardDt = 0;
  readonly boundary: ArenaBoundary;
  private boundaryEffect: Readonly<Record<string,number>> | null = null;
  private readonly author: ReturnProgram;
  readonly life: ProjectedState;
  private readonly fightDraw: ReturnType<typeof installChannelPrograms>;
  private readonly viewRead = { fighting: 0, victoryT: -1, phase: 0, domeBroken: 0, open: 0, flash: 0 };
  /** Nalati zero R6: the tells and pose run in the fight's view module at its frame slot (format/arenaView), lent in the
   *  entered encounter's bind; its cells are the eased pose and the aim's operands */
  private view: { readonly frame: (dt: number, time: number) => void; readonly cells: ArenaPoseCells } | null = null;
  /** the aim as the last frame drew it: what a page that steps no fight hears */
  private aimStruck = 0; private aimAlpha = 0;
  /** the fire's clears a page last heard: null, none yet */
  private heardClears: number | null = null;

  /** the ground's height and the wind the fight reads (OpenArenaFightWorld `ground` / `wind`, else the page's) */
  private readonly groundAt: (x: number, z: number) => number;
  private readonly windNow: { readonly dirX: number; readonly dirZ: number; readonly speed: number };
  constructor(private readonly ctx: OpenArenaFightWorld, private readonly host: OpenArenaFightHost, data: ArenaScriptData, views: OpenArenaViews<D>) {
    this.groundAt = ctx.ground ?? heightAt; this.windNow = ctx.wind ?? wind;
    this.clockRandom=ctx.ai();
    this.scope=ctx.scope;this.data = data; this.pose={...data.pose};
    const clocks=this.data.clocks;
    const state=clocks.frame.initial,outputs=clocks.frame.outputs,channels=data.programs.attack.v2?.channels,retain=Object.entries(clocks.frame.retain),slots=clocks.landings.flatMap(row=>[row.on,row.t,row.x,row.z]);
    if(clocks.frame.parameters[clocks.count]!==clocks.landings.length||new Set(slots).size!==slots.length||outputs===undefined
      ||[clocks.left,...slots,...retain.map(([,slot])=>slot)].some(key=>!Object.hasOwn(state,key))
      ||new Set(retain.map(([,slot])=>slot)).size!==Object.keys(state).length
      ||[...retain.map(([channel])=>channel),'strike','stuck','hurt','spread',clocks.spear,...clocks.landings.flatMap(row=>[row.strike,row.hurt])].some(key=>!outputs.includes(key))
      ||channels!==undefined&&outputs.some(key=>!channels.includes(key))
      ||Object.keys(clocks.clear).length!==slots.length||slots.some(key=>!Object.hasOwn(clocks.clear,key)||!Object.is(clocks.clear[key],state[key])))throw new Error('Invalid encounter clock bank');
    const actors=data.support.actors;
    if(actors===undefined||Object.entries(data.support.commit).some(([slot,value])=>!Object.hasOwn(data.support.member,slot)||!Number.isFinite(value)))throw new Error('Invalid support actor binding');
    this.memberOutputs=['show','alpha','hurt',...Object.values(actors.memory)];
    const bindings=ReturnProgram.projectionBindings(data.programs.attack);
    ProjectedState.preflight(data.script.fight,bindings);
    ProjectedState.preflight(clocks.frame,bindings);ProjectedState.preflight({...data.support,signal:'couple',outputs:['index','hp','mask','broke']},bindings);
    ProjectedState.preflight({initial:{...data.support.member,theta:0},parameters:data.support.parameters,signals:data.support.signals,signal:'member',outputsEvents:{member:this.memberOutputs,damage:['alpha']}},bindings);
    views.whirlsPreflight(data.whirls,bindings);
    const windBindings=ReturnProgram.projectionBindings(data.programs.wind);
    for(const law of data.whirls.laws)ProjectedState.preflight(law,windBindings);
    if(data.field.contact!==undefined)ProjectedState.preflight(data.field.contact.law,windBindings);
    if(Object.entries(data.field.channels).some(([kind,channel])=>!Object.values(kind==='state'?windBindings.script.fields:windBindings.script.channels).includes(channel))||Object.values(data.field.signals).some(signal=>!Object.values(windBindings.script.signals).includes(signal)))throw new Error('Missing cell field program binding');
    if(data.programs.attack.v2===undefined||Object.values(data.commands).some(signal=>!Object.values(bindings.script.signals).includes(signal)))throw new Error('Missing encounter command program');
    this.author=ReturnProgram.page(this.data.programs.attack,ctx.scope);
    this.clocks=new ProjectedState(clocks.frame,this.author);
    const windLaw = ReturnProgram.page(this.data.programs.wind, ctx.scope);
    this.field = new CellField(this.data.field, windLaw, ctx.ai());
    this.boundary = { field: this.field,boundary: data.boundary,mask: 0 };
    this.life = new ProjectedState(this.data.script.fight,this.author);
    this.support = new ProjectedState({...this.data.support,signal:'couple',outputs:['index','hp','mask','broke']},this.author);
    this.body = views.body(this.pose);
    this.fightDraw = installChannelPrograms(this.data.geometry.poses, this.data.view.group, new Map<string,unknown>([
      ['pose',this.pose],['alpha',this.body.alpha],['flash',this.body.flash],['fight',this.viewRead],
    ]));
    const arena = this.arena = views.arena();
    this.chains=clocks.landings.map((row,i)=>({tell:arena.tell('chain',i),row}));
    this.whirls = views.whirls(arena, windLaw, this.author, this.scope);
    this.fire = views.fire();
    this.scorch = arena.instances('scorch'); this.scorch.count = 0;
    const target = data.view.target;
    this.heartTarget = { kind: data.definition.id,position: new THREE.Vector3(),alive: true,damageFor: () => target.damage,applyDamage: amount => this.hitHeart(amount) };
    this.heartHit = { animal: this.heartTarget,point: new THREE.Vector3(),distance: 0,headshot: false };
    this.heartLock = { kind: data.definition.id,position: new THREE.Vector3(),alive: true,lockable: true,lockRange: target.range,dims: { bodyY: 0,bodyRadius: target.closed } };
  }

  /** What the fight's view half (arenaFire.ts `lendOpenArenaView`) draws from: live owners and reads, nothing to step. */
  get viewLoan(): OpenArenaViewLoan<D> {
    return { arena: this.arena, chains: this.chains.map(chain => chain.tell), field: this.field, groundAt: this.groundAt, fire: this.fire, scorch: this.scorch, whirls: this.whirls,
      phone: this.ctx.phone, smoke: this.data.arenaFire.cells?.smoke, wind: this.windNow, burnt: this.burnt, fireOn: () => this.fireOn, fireClear: () => this.fireClear,
      bindFire: (scope, frame) => { this.fireFrame = frame; scope.onDispose(() => { if (this.fireFrame === frame) this.fireFrame = null; }); } };
  }
  /** What the view module samples from `source` (format/arenaView `sources`: the life and clock state, the pose, the spear
   *  on the ground), one finite field at a time; the page lends these, a native proof's lane reads the same (boss/headlessArenaPose.ts). */
  viewSource(source: string): (field: string) => number {
    const { sources } = ARENA_VIEW, pose = this.pose;
    if (source === sources.life) return field => this.life.value(field);
    if (source === sources.clocks) return field => this.clocks.value(field);
    if (source === sources.pose) return field => field === 'bend' ? pose.bend : field === 'raise' ? pose.raise : field === 'castL' ? pose.castL : Number.NaN;
    if (source === sources.spear) return field => field === 'x' ? this.spearAt.x : field === 'z' ? this.spearAt.z : Number.NaN;
    throw new Error(`Unknown arena view source ${source}`);
  }
  /** Fresh cells for the view module to write: the pose as it stands, no aim. */
  poseCells(): ArenaPoseCells {
    const pose = this.pose;
    return { bend: { value: pose.bend }, raise: { value: pose.raise }, castL: { value: pose.castL }, struck: { value: 0 }, alpha: { value: 0 } };
  }
  /** The fight's frame slot runs `view` (its module writing `cells`) for `scope`'s life: the page's lent slot, or a native
   *  host's own lane over the same sources (boss/headlessArenaPose.ts). */
  adoptView(scope: Scope, view: { readonly frame: (dt: number, time: number) => void; readonly cells: ArenaPoseCells }): void {
    if (this.view !== null) throw new Error('Arena view is already bound');
    this.view = view; scope.onDispose(() => { if (this.view === view) this.view = null; });
  }

  /** CI12: the fight's whole continuation as data, for a native checkpoint (the host's parts excluded, see the type). */
  snapshot(): OpenArenaFightSnapshot {
    const b = this.body, lanes = this.arena.tells('lane'), cells = this.view?.cells ?? null;
    return { life: this.life.snapshot(), clocks: this.clocks.snapshot(), support: this.support.snapshot(), field: this.field.snapshot(), whirls: this.whirls.snapshot(),
      pose: { ...this.pose }, spear: [this.spearAt.x, this.spearAt.y, this.spearAt.z], fireOn: this.fireOn, fireClear: this.fireClear, burnt: [...this.burntQueue],
      hazardDt: this.hazardDt, boundary: { mask: this.boundary.mask, effect: this.boundaryEffect === null ? null : { ...this.boundaryEffect } },
      riders: this.stormRiders.map(r => ({ site: lanes.indexOf(r.lane), law: r.law.snapshot() })),
      body: { visible: b.visible, alpha: b.alpha.value, flash: b.flash.value, dome: b.part(this.data.view.dome).visible },
      heart: { position: [this.heartTarget.position.x, this.heartTarget.position.y, this.heartTarget.position.z], alive: this.heartTarget.alive },
      view: cells === null ? null : { bend: cells.bend.value, raise: cells.raise.value, castL: cells.castL.value, struck: cells.struck.value, alpha: cells.alpha.value } };
  }
  /** Continue a fresh fight (no riders yet; its view bound first when the snapshot has one) from `saved`: the next update
   *  runs as the snapshotted fight's would. `rider` hands back the host's own restored actor at a support site. */
  restore(saved: OpenArenaFightSnapshot, rider: (site: number) => ArenaSupportRider | null): void {
    if (this.stormRiders.length > 0 || (saved.view === null) !== (this.view === null)) throw new Error('Arena restore needs a fresh fight with its view bound alike');
    const keys = Object.keys(this.pose);
    if (Object.keys(saved.pose).length !== keys.length || keys.some(key => !Number.isFinite(saved.pose[key]))
      || [...saved.spear, ...saved.heart.position, saved.hazardDt, saved.boundary.mask, ...saved.burnt].some(value => !Number.isFinite(value))) throw new Error('Invalid arena fight snapshot');
    this.life.restore(saved.life); this.clocks.restore(saved.clocks); this.support.restore(saved.support);
    this.field.restore(saved.field); this.whirls.restore(saved.whirls);
    Object.assign(this.pose, saved.pose); this.spearAt.set(saved.spear[0], saved.spear[1], saved.spear[2]);
    this.fireOn = saved.fireOn; this.fireClear = saved.fireClear; this.burntQueue.length = 0; this.burntQueue.push(...saved.burnt);
    this.hazardDt = saved.hazardDt; this.boundary.mask = saved.boundary.mask; this.boundaryEffect = saved.boundary.effect === null ? null : { ...saved.boundary.effect };
    for (const row of saved.riders) {
      const held = rider(row.site), lane = this.arena.tells('lane')[row.site];
      if (held === null || lane === undefined) throw new Error('Missing restored support rider');
      const law = this.riderLaw(row.site, held); law.restore(row.law); this.stormRiders.push({ rider: held, a: held.body, lane, law });
    }
    this.heartTarget.position.set(saved.heart.position[0], saved.heart.position[1], saved.heart.position[2]); this.heartTarget.alive = saved.heart.alive;
    const b = this.body; b.setVisible(saved.body.visible); b.alpha.value = saved.body.alpha; b.flash.value = saved.body.flash; b.part(this.data.view.dome).visible = saved.body.dome;
    const cells = this.view?.cells;
    if (cells !== undefined && saved.view !== null) for (const key of POSE_CELLS) cells[key].value = saved.view[key];
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
  rowlessFocus(): THREE.Vector3 { return this.body.focusWorld(_openHITP); }
  rewardPoint(): THREE.Vector3 { const p = this.point(false); return new THREE.Vector3(p.x,this.groundAt(p.x,p.z)+this.data.view.reward.lift,p.z); }
  respawnPoint(): { pos: THREE.Vector3; yaw: number } { const p = this.point(true); return { pos: new THREE.Vector3(p.x,this.groundAt(p.x,p.z),p.z),yaw: p.yaw }; }
  cairnSpot(): THREE.Vector3 { return this.ctx.tieSpot ?? new THREE.Vector3(this.data.arena.anchor.x, this.groundAt(this.data.arena.anchor.x, this.data.arena.anchor.z), this.data.arena.anchor.z); }

  reset(phase: number): void {
    this.life.restart({ phase,share: this.data.phases[phase]?.at ?? 1,tied: Number(this.tied),sealed: Number(this.sealed) }); this.clocks.reset();
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
    if (this.life.event('introClock',{t})['zzzzIntroTick']===1) {
      const answer = this.life.event('intro',{ t,amount: Number(short) });
      this.pose.rise = this.life.value(this.data.script.fight.retainEvents.intro.rise); this.pose.kneel = this.life.value(this.data.script.fight.retainEvents.intro.kneel);
      b.alpha.value = this.life.value(this.data.script.fight.retainEvents.intro.alpha); b.flash.value = answer['flash'] ?? b.flash.value;
      if (answer['strike']===1) this.bolt(this.data.arena.center.x+this.data.view.introBolt.x,this.data.arena.center.z+this.data.view.introBolt.z);
    }
    return b.focusWorld(_openHITP);
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
    const fog = this.ctx.fog();
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
    // the frame slot: the view module eases the pose and draws the spear, fork and chain rings (behaviour titanView);
    // the aim's operands are captured here, before the whirls and the fire (a reset during their contact keeps them)
    let struck = 0, alpha = 0;
    const view = this.view;
    if (view !== null) {
      view.frame(dt, t); const c = view.cells;
      this.pose.bend = c.bend.value; this.pose.raise = c.raise.value; this.pose.castL = c.castL.value; struck = c.struck.value; alpha = c.alpha.value;
    }
    this.updateWhirls(dt, t, fighting && this.victoryT < 0, this.hazardDt);
    this.updateFire(dt, t, fighting && this.victoryT < 0, this.hazardDt);
    // the spear in his hand (raised) or stuck in the meadow
    this.aimStruck = struck; this.aimAlpha = b.visible ? alpha : 0;
    b.aim(struck===1 ? this.spearAt : null,this.aimAlpha);
    b.update(t, this.ctx.camera);
  }

  // ── a page on a server: it steps no fight, and draws what that fight says (server/boss/arenaWords.ts) ──

  /** A frame of the fight's looks, in the order `hear` takes it. */
  lookWord(): number[] {
    const b = this.body, life = this.life, at = this.spearAt, step = this.data.script.fight.retainEvents.step;
    return [Number(b.visible), b.alpha.value, b.flash.value, Number(b.part(this.data.view.dome).visible), life.value('sealed'), life.value('fighting'), life.value('open'),
      life.value('victoryT'), life.value('hp'), life.value('tied'), life.value(step.mask), this.aimStruck, this.aimAlpha, at.x, at.y, at.z, ...Object.values(this.pose)];
  }
  /** One word off the wire. Nothing here decides: the lock and the ray read what the server's fight said, and the next `followFrame` draws it. */
  hear(name: string, args: readonly number[]): void {
    if (name === OPEN_ARENA_VIEW.look) this.hearLook(args);
    else if (name === OPEN_ARENA_VIEW.tell) this.hearTell(args);
    else if (name === OPEN_ARENA_VIEW.whirl) { const [index = -1, k = 0, shown = 0, x = 0, y = 0, z = 0] = args, row = this.whirls.drawn[index]; if (row !== undefined) Object.assign(row, { k, shown, x, y, z }); }
    else if (name === OPEN_ARENA_VIEW.fire) this.hearFire(args);
    else if (name === OPEN_ARENA_VIEW.cells) { const [row = 0, ...pairs] = args; for (const cell of this.field.hearRow(row, pairs)) this.addScorch(cell); }
  }
  private hearLook(args: readonly number[]): void {
    const [visible = 0, alpha = 1, flash = 0, dome = 0, sealed = 0, fighting = 0, open = 0, victoryT = -1, hp = 0, tied = 0, mask = 0, struck = 0, aim = 0, x = 0, y = 0, z = 0, ...pose] = args, b = this.body;
    if (b.visible !== (visible === 1)) b.setVisible(visible === 1);
    b.alpha.value = alpha; b.flash.value = flash; b.part(this.data.view.dome).visible = dome === 1;
    this.life.set({ sealed, fighting, open, victoryT, hp, tied }); this.boundary.mask = mask;
    this.aimStruck = struck; this.aimAlpha = aim; this.spearAt.set(x, y, z);
    const held: Record<string, number> = this.pose;
    Object.keys(held).forEach((key, index) => { held[key] = pose[index] ?? held[key] ?? 0; });
  }
  private hearTell(args: readonly number[]): void {
    const [slot = 0, call = -1, a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = args, name = ARENA_TELL_CALLS[call];
    const tell = this.arena.tells(Object.keys(this.data.geometry.arena.tells)[Math.floor(slot / 16)] ?? '')[slot % 16];
    if (tell === undefined) return;
    if (name === 'ring') tell.ring(a, b, c, d); else if (name === 'lane') tell.lane(a, b, c, d, e, f); else if (name === 'wedge') tell.wedge(a, b, c, d, e, f); else tell.hide();
  }
  private hearFire([on = 0, clears = 0]: readonly number[]): void {
    if (this.heardClears !== null && this.heardClears !== clears) this.clearFire();
    this.heardClears = clears; this.fireOn = on === 1;
  }
  /** A page's frame of a fight it heard: `update`'s drawing, in `update`'s order, and none of its rules. */
  followFrame(dt: number, t: number): void {
    const b = this.body, fog = this.ctx.fog();
    this.arena.update(dt, t, this.sealed);
    this.whirls.drawHeard(dt, t);
    this.field.coast(dt); this.updateFire(dt, t, false);
    if (!b.visible) return;
    if (fog) b.fogColour.copy(fog.color);
    b.aim(this.aimStruck === 1 ? this.spearAt : null, this.aimAlpha);
    b.update(t, this.ctx.camera);
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
    this.whirls.arm(0);
  }

  // ── the heart as a target (main's Targets chain) ──

  private readonly heartTarget: TargetAnimal;
  /** CI12: the heart as the combat target `target()` hits (the same object every hit), for a native host that keys an arrow
   *  stuck in it to this encounter and finds it again after a restore. */
  get combatTarget(): TargetAnimal { return this.heartTarget; }
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
    this.body.focusWorld(_openHITP);
    _openSPH.set(_openHITP, this.heartOpen ? this.data.view.target.open : this.data.view.target.closed);
    _openRAY.set(origin, dir);
    if (_openRAY.intersectSphere(_openSPH, _openV) === null) return hit;
    const d = _openV.distanceTo(origin);
    if (d > best) return hit;
    this.heartTarget.position.copy(_openHITP); this.heartTarget.alive = !this.dead;
    this.heartHit.point.copy(_openV); this.heartHit.distance = d; this.heartHit.headshot = this.heartOpen;
    return this.heartHit;
  }

  private hitHeart(amount: number): boolean {
    const answer = this.life.event('damage',{ amount: amount / (this.host.heartScale?.() ?? 1),mode: this.clocks.value('mode') });
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
        this.spearAt.y = this.groundAt(this.spearAt.x, this.spearAt.z); this.bolt(this.spearAt.x, this.spearAt.z);
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
      const rider = gr.spawnRider({ x, z, yaw: 0, variant: this.data.view.quietVariant, quiet: true });
      if (rider === null) continue;
      const a = rider.body;
      const lane = this.arena.tells('lane')[i];
      if (lane === undefined) continue;
      const actors=this.data.support.actors;if(actors===undefined)throw new Error('Missing support actor rows');
      a.maxHp=actors.hp;a.hp=actors.hp;
      const r: SupportActor = { rider,a,lane,law: this.riderLaw(i,rider) };
      this.stormRiders.push(r);
    }
  }

  /** A support rider's law at `site` and its damage share on `a` (spawned, or the host's restored actor). */
  private riderLaw(site: number, rider: ArenaSupportRider): ProjectedState {
    const rows=this.data.support,actors=rows.actors,at=this.data.supportSites[site];if(actors===undefined||at===undefined)throw new Error('Missing support actor rows');
    const law=new ProjectedState({initial:{...rows.member,theta:at.theta},parameters:rows.parameters,signals:rows.signals,signal:'member',outputsEvents:{member:this.memberOutputs,damage:['alpha']}},this.author),player=this.host.player.position;
    rider.share((scale,x,z)=>law.event('damage',{x,z,px:player.x,pz:player.z,radius:scale})['alpha']??1);
    return law;
  }

  private clearRiders(): void {
    const gr = this.host.riderOwner();
    for (const r of this.stormRiders) { r.rider.share(null);r.lane.hide(); if (r.a.alive && gr !== null) { r.a.alive = false; r.rider.dissolve(); } }
    this.stormRiders = [];
    for (const l of this.arena.tells('lane')) l.hide();
  }

  private updateRiders(dt: number): void {
    const p=this.host.player.position,riders=this.stormRiders,rows=this.data.support;
    const frame={dt,px:p.x,pz:p.z,hp:this.hp,invuln:Number(this.invuln)};
    const state=this.support.project({...frame,count:riders.length},this.ctx.ai(),riders.map(({a,law})=>({x:a.position.x,z:a.position.z,hit:Number(a.alive),mode:law.value('mode')})));
    const selected=riders[state['index']??-1];
    if(selected!==undefined){
      selected.law.set(rows.commit);
      selected.law.set(Object.fromEntries(['x0','z0','x1','z1'].map(key=>[key,state[key]??0] as const)));
    }
    this.hp=state['hp']??this.hp;
    for(let i=riders.length-1;i>=0;i--){
      const r=riders[i];if(r===undefined)continue;
      if(((state['mask']??0)&(1<<i))!==0){
        r.rider.share(null);r.lane.hide();riders.splice(i,1);
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

  /** A native contact/result remains a synchronous barrier. Only its original
   * concrete field or current entered mount is lent for this one request. */
  private command(signal:string,frame:Readonly<Record<string,number>>,loan:Extract<V2WorldActionLoan,{kind:'mount'|'cell-field'}>):void {
    const project=this.author.prepareWorld;if(project===undefined)throw new Error('Missing encounter command transport');
    const binding:V2ActionBinding={identity:'arena',handle:1,targets:new Map([[1,{identity:loan.target,kind:loan.kind==='cell-field'?'cell-field':'mount'}]]),operations:new Set([loan.kind==='cell-field'?V2_ACTION_OPS.ignite:V2_ACTION_OPS.dismount]),maxCommands:1,bounds:{coordinate:Number.MAX_VALUE,velocity:0}};
    const prepared=project(signal,frame,new Map([[1,binding]])),effects=prepareV2WorldActions(prepared.actions,[loan]);
    if(Object.keys(prepared.values).length>0||prepared.actions.length!==1)throw new Error('Invalid encounter command result');
    effects.validate();prepared.accept();for(const apply of effects.operations)apply();
  }
  dismount(mount:Mount,scope:Scope):void {this.command(this.data.commands.dismount,{}, {binding:'arena',target:'mount',kind:'mount',scope,owner:mount});}
  private ignite(x:number,z:number):void {this.command(this.data.commands.ignite,{x,z},{binding:'arena',target:'field',kind:'cell-field',scope:this.scope,owner:this.field});}
  private addScorch(c: number): void {
    this.burntQueue.push(c);
    this.ctx.wild.trample(this.field.x(c), this.field.z(c), this.data.tuning.cell * 0.6, 1, 0, 0);   // the grass burnt flat
  }
  private clearFire(): void { this.field.clear(); this.burntQueue.length = 0; this.fireClear = true; this.fireOn = false; }

  private updateFire(dt: number, t: number, live: boolean, thinkDt = 0): void {
    this.fire.update(t, this.windNow.dirX, this.windNow.dirZ, this.windNow.speed, this.body.fogColour, this.body.flash.value);
    if (this.fireOn && live) for (const cell of this.field.update(dt, { wx: this.windNow.dirX, wz: this.windNow.dirZ })) this.addScorch(cell);
    // the fire slot: the view module draws the smoke, the burning cells' flames and up to a frame's share of the burnt-out
    // cells' scorch; what it has not run for (its lane's rate can skip a frame) waits for the frame it runs
    const n = Math.min(ARENA_BURNT_PER_FRAME, this.burntQueue.length); this.burnt[0] = n;
    for (let k = 0; k < n; k++) this.burnt[1 + k] = this.burntQueue[k] ?? 0;
    if (this.fireFrame?.(dt, t) === true) { this.burntQueue.splice(0, n); this.fireClear = false; }
    if (!this.fireOn || !live || thinkDt <= 0) return;
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
      if(values[chain.row.hurt]===1)this.host.contact('chain',_openV.set(x,p.y,z),this.data.tuning.chainDamage,this.data.lines.chain);
    }
  }

  // ── whirlwinds: touching one lifts you out of the saddle ──

  private updateWhirls(dt: number, t: number, live: boolean, thinkDt: number): void {
    const p = this.host.player.position;
    const hits = this.whirls.update(dt, t, live, thinkDt, { wx: this.windNow.dirX, wz: this.windNow.dirZ, px: p.x, pz: p.z });
    for (const at of hits) if (this.host.contact('whirl', at, this.data.tuning.whirlDamage, this.data.lines.whirl)) this.host.throwRider();
  }

  // ── a strike from the sky ──
  private bolt(x: number, z: number): void {
    const y = this.groundAt(x, z);
    this.ctx.weather.raise(this.data.weather.strike, { x, y, z, kind: 0 });
    this.ctx.weather.flash = 1;
    this.body.flash.value = 1;
    this.ctx.wild.onEvent('lightning', x, z);
  }

}
