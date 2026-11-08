import type { DamageRequest } from '@wildshard/engine/combat/pipeline';
import type { DirectedLaw } from './directedLaw';
import type { NativeGroupCollection } from '../shardfile/groupRuntime';
import * as v from 'valibot';
import { ActorProjectionV2,type ActorProjectionOwner } from './actorProjectionV2';
import { ForagerPopulation } from '@wildshard/engine/ai/ambientForager';
import { GrassField } from '../../../shared/game/systems/looks/grassField';
import { TrampleField } from '../../../shared/game/systems/looks/trampleField';
import { knockdownVelocity, PopulationRelations } from './relations';
import { installPopulationSignals } from './signals';
import { sayFightView } from '@wildshard/engine/sim/shardRows';
import { Vector3 } from 'three';
import { AggressionDirector } from '@wildshard/engine/ai/director';
import type { PackBrain } from '@wildshard/engine/ai/pack';
import type { HerdBrain } from '@wildshard/engine/ai/herd';
import type { FlockBrain, FlockThreat } from '@wildshard/engine/ai/flock';
import { canReach } from '@wildshard/engine/ai/reach';
import { createNativeSpeciesContext } from '../plugin/brain';
import type { NativeEliteBindings } from '@wildshard/engine/ai/eliteRoster';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { HuntBody } from '@wildshard/engine/ai/hunt';
import { huntMemoryCodec } from '@wildshard/engine/ai/huntPattern';
import { StalkerBrain } from '@wildshard/engine/ai/stalker';
import { Rng } from '@wildshard/engine/core/rng';
import type { SimHost } from '@wildshard/engine/sim';
import { emitFault } from '@wildshard/engine/core/faults';

/** Existing native envelope fields; adapters retain their historical wire names. */
export interface NativeHuntContinuation {
  readonly clock: number; readonly rng: ReturnType<Rng['snapshot']>;
  readonly noise: { readonly seen: boolean; readonly speed: number; readonly prev: readonly [number, number, number] };
  readonly sight: readonly (boolean | null | undefined)[]; readonly memories: readonly unknown[];
  readonly herds: readonly (readonly [number, number])[];
}
/** Detached scalar/vector state; never a borrowed body, memory or controller. */
export interface NativeHuntSnapshot {
  clock: number; rng: { [K in keyof ReturnType<Rng['snapshot']>]: ReturnType<Rng['snapshot']>[K] };
  noise: { seen: boolean; speed: number; prev: [number, number, number] };
  sight: (boolean | null)[]; memories: (ReturnType<typeof huntMemoryCodec.save> | null)[];
  herds: [number, number][];
}
/** Immutable native capacity and historical memory field selection. */
export interface NativeManagerRows {
  readonly limit: number; readonly sightSlots: number; readonly initialSight: boolean | null;
  readonly memoryFields?: readonly string[];
}
const huntBody = (actor: AnimalSim): actor is HuntBody => 'hidden' in actor && typeof actor.hidden === 'boolean'
  && 'sampleTerrain' in actor && typeof actor.sampleTerrain === 'function';

/** Native manager state over concrete built-in hunt/stream owners. Inputs are
 * actor ids, plain rows and saved values, never a shard resolver or callback.
 * This installs no independent clock, allocates no actor and draws no entropy.
 * Null roster slots preserve a retired body's historical array position. */
export class NativeManager {
  readonly noise: { seen: boolean; speed: number; prev: Vector3; } = { seen: false, speed: 0, prev: new Vector3() };
  readonly sight: (boolean | null | undefined)[];
  private clock = 0;
  constructor(private readonly host: SimHost, private readonly hunt: StalkerBrain<HuntBody>, private readonly stream: Rng, private readonly rows: NativeManagerRows) {
    if (!(hunt instanceof StalkerBrain) || !(stream instanceof Rng) || !Number.isSafeInteger(rows.limit) || rows.limit < 1 || rows.limit > 1024
      || !Number.isSafeInteger(rows.sightSlots) || rows.sightSlots < 0 || rows.sightSlots > rows.limit
      || (rows.initialSight !== null && typeof rows.initialSight !== 'boolean')) throw new Error('Invalid native manager owners or capacity');
    this.sight = Array.from({ length: rows.sightSlots }, () => rows.initialSight);
  }
  /** Advance at the original manager phase, with the owner's actual dt. */
  advance(dt: number): void { this.hunt.beginTick(dt); this.clock += dt; }
  /** Resolve every native identity before observing or restoring any state. */
  private roster(ids: readonly (string | null)[], participants: readonly string[]): (HuntBody | null)[] {
    const present = ids.filter((id): id is string => id !== null), names = new Set(present);
    if (ids.length > this.rows.limit || names.size !== present.length || new Set(participants).size !== participants.length
      || participants.some(id => !names.has(id))) throw new Error('Invalid native manager roster');
    return ids.map(id => {
      if (id === null) return null;
      const actor = this.host.entities.get(id);
      if (actor === undefined || !huntBody(actor)) throw new Error('Foreign native manager body');
      return actor;
    });
  }
  /** Capture a detached common payload in the adapter's declared slot order. */
  snapshot(ids: readonly (string | null)[], participants: readonly string[]): NativeHuntSnapshot {
    const bodies = this.roster(ids, participants), participating = new Set(participants);
    return { clock: this.clock, rng: { ...this.stream.snapshot() }, noise: { seen: this.noise.seen, speed: this.noise.speed, prev: this.noise.prev.toArray() },
      sight: this.sight.map(value => value ?? null), memories: bodies.map(actor => {
        const memory = actor === null || !participating.has(actor.entityId) ? undefined : this.hunt.memory(actor);
        return memory === undefined ? null : huntMemoryCodec.save(memory, this.rows.memoryFields);
      }), herds: this.hunt.herds.map(herd => [herd.cx, herd.cz]) };
  }
  /** Quietly restore after the adapter reinstalls its exact native roster. */
  restore(state: NativeHuntContinuation, ids: readonly (string | null)[], participants: readonly string[]): void {
    const bodies = this.roster(ids, participants), participating = new Set(participants);
    if (state.memories.length !== bodies.length || state.sight.length !== this.sight.length || state.herds.length !== this.hunt.herds.length
      || !Number.isFinite(state.clock)) throw new Error('Incompatible native manager continuation');
    this.stream.restore(state.rng); this.hunt.beginTick(state.clock - this.clock); this.clock = state.clock;
    this.noise.seen = state.noise.seen; this.noise.speed = state.noise.speed; this.noise.prev.set(...state.noise.prev);
    state.sight.forEach((seen, i) => { this.sight[i] = seen; });
    state.herds.forEach(([cx, cz], i) => { const herd = this.hunt.herds[i]; if (herd !== undefined) { herd.cx = cx; herd.cz = cz; } });
    bodies.forEach((actor, i) => {
      const memory = actor === null || !participating.has(actor.entityId) ? undefined : this.hunt.memory(actor), saved = state.memories[i];
      if ((saved === null) !== (memory === undefined)) throw new Error('Incompatible native manager memory');
      if (memory !== undefined) huntMemoryCodec.restore(memory, saved, this.rows.memoryFields === undefined);
    });
  }
}

/** The single shard supplies dispatch roles and guest ids; clocks and concrete
 * actor, group, hunt, token and elite owners belong to the game. */
export interface NativeDriverRows {
  tokens: string; program: unknown; packKind: string; dogKind: string; eliteKinds: readonly string[]; dispatch: string; projection?:unknown;
  /** Admitted self-thinking species whose page metadata declares tick: always. */
  readonly alwaysKinds?:readonly string[];
}
/** Manager decisions and native body continuation. Contexts allocate only when
 * a concrete actor joins; restored and newly bonded actors keep the same owner. */
export class NativePopulationDriver {
  private readonly contexts = new WeakMap<HuntBody, ReturnType<typeof this.makeContext>>();
  private readonly author: ReturnProgram;
  private readonly tokens: WeakMap<AnimalSim, AggressionDirector<AnimalSim>>;
  private readonly sheep = new Vector3();
  private readonly projection:ActorProjectionV2|undefined;
  private readonly route = { elite: 0, wolf: 0, dog: 0, held: 0 };
  private readonly missing = new Error('Missing native population context');
  private readonly always:ReadonlySet<string>;
  private dodgeCd = 0;
  private readonly otherDodges = new Map<string, number>();
  private calmState = false;
  /** The entered population owner's current calm state, as on the page. */
  get calm(): boolean {
    if (this.host.scope.disposed || this.host.scope.disposing) throw this.missing;
    return this.calmState;
  }
  set calm(value: boolean) {
    if (typeof value !== 'boolean' || this.host.scope.disposed || this.host.scope.disposing) throw this.missing;
    this.calmState = value;
  }
  /** CI12: kinds that decide through their own directed law (Nalati's ghost riders), as the page's self-thinking species */
  private readonly directed = new Map<string, NativeDirected>();
  /** Runs when a body turns to the player nearest it, before it decides or acts (the room's senses, nativePopulation). */
  focused: () => void = () => undefined;
  private readonly policy = { state: 'owned' as const, decide: (dt: number, actor: HuntBody): void => { this.decide(actor, dt); }, sample: (actor: HuntBody): void => { actor.sampleTerrain(); } };
  private readonly cadence;
  constructor(private readonly host: SimHost, private readonly manager: NativeManager, private readonly hunt: StalkerBrain<HuntBody>, private readonly rng: Rng,
    private readonly bodies: HuntBody[], private readonly packs: ReadonlyMap<AnimalSim, PackBrain<AnimalSim>>,
    private readonly herds: ReadonlyMap<AnimalSim, HerdBrain<AnimalSim>>, private readonly elites: NativeEliteBindings,
    private readonly flocks: readonly FlockBrain[], private readonly wolves: readonly FlockThreat[], private readonly rows: NativeDriverRows, groups: NativeGroupCollection) {
    const tokens = groups.tokens; if (!groups.owns(host) || tokens === undefined || tokens.id !== rows.tokens || !(tokens.owners instanceof WeakMap)) throw new Error('Missing native manager tokens'); this.tokens = tokens.owners;
    if (bodies.length > 64 || flocks.length > 4) throw new Error('Native population driver capacity exceeded');
    const always=v.parse(v.pipe(v.array(v.pipe(v.string(),v.minLength(1))),v.maxLength(16)),rows.alwaysKinds??[]);
    if(new Set(always).size!==always.length||always.some(kind=>!rows.eliteKinds.includes(kind)))throw new Error('Invalid native always species');
    this.always=new Set(always);
    this.author = ReturnProgram.native(host, rows.program);
    this.projection=rows.projection===undefined?undefined:new ActorProjectionV2(rows.dogKind,{program:rows.program,step:rows.projection});
    for (const actor of bodies) this.admit(actor);
    this.cadence = hunt.bindRoster({ limit: 64, order: 'combined', at: index => bodies[index],
      actor: actor => actor.harnessHold || actor.hidden ? null : actor, id: actor => actor.entityId,
      player: host.playerFocus, noise: manager.noise, sight: manager.sight,
      reach: actor => canReach(actor, host.nearestPlayer(actor.position).position, host.physics), brainDt: (id, urgent) => this.takeStep(id, urgent === true),
      policy: () => this.policy, beforeDecisions: () => {
        if (this.dodged()) for (const actor of bodies) if (actor.alive && !actor.harnessHold && !actor.hidden && (actor.aggressive || hunt.sensed(actor))) this.cadence.wake(actor);
      } });
    host.useBodyStep({ before: (_id, body, dt) => {
      this.focused();
      const actor = this.bodies.find(candidate => candidate === body); if (actor === undefined || actor.hidden || !actor.alive || actor.stunned || actor.kind === rows.dogKind) return;
      const elite = elites.brains.get(actor);
      if (elite !== undefined) elite.act(actor);
      else if (actor.kind === rows.packKind) { const pack = packs.get(actor); if (pack !== undefined) { const c = this.context(actor, dt); pack.drive(actor, c, true); c.confine(actor); } }
      else { const herd = herds.get(actor); if (herd !== undefined) herd.drive(actor, this.context(actor, dt), true); }
    }, after: (_id, body) => {
      const actor = this.bodies.find(candidate => candidate === body); if (actor?.alive === true && !actor.hidden && !actor.stunned && actor.state === 'charge') hunt.chargeContact(actor, host.nearestPlayer(actor.position).position);
    } });
  }
  private required(actor: AnimalSim): HuntBody { const body = this.bodies.find(candidate => candidate === actor); if (body === undefined) throw this.missing; return body; }
  private makeContext(actor: HuntBody) {
    const { observation } = createNativeSpeciesContext({ host: this.host, hunt: this.hunt, rng: this.rng,
      world: null, heightAt: (x, z) => this.host.groundHeightAt(x, z), waterLevel: 0 }, actor, null);
    const projection:{owner?:ActorProjectionOwner}={};
    return { ...observation, projection, claim: (a: AnimalSim): boolean => {
      const director = this.tokens.get(a); if (director !== undefined && !(director instanceof AggressionDirector)) throw this.missing; return director?.take(a) ?? true;
    }, pathYaw: (a: AnimalSim, x: number, z: number, every = 1): number => this.hunt.pathYawFor(this.required(a), x, z, every),
      steer: (a: AnimalSim, yaw: number, speed: number, turn: number): void => { this.hunt.steerAny(this.required(a), yaw, speed, turn); },
      confine: (a: AnimalSim): void => { this.hunt.confine(this.required(a)); }, reach: (a: AnimalSim): boolean => canReach(a, this.host.nearestPlayer(a.position).position, this.host.physics) };
  }
  admit(actor: HuntBody): void {
    if (this.host.entities.get(actor.entityId) !== actor || this.contexts.has(actor)) throw new Error('Invalid native driver actor');
    this.contexts.set(actor, this.makeContext(actor));
    const directed = this.directed.get(actor.kind); if (directed !== undefined) this.scaleHits(actor, directed);
  }
  /** Bind `kind` to its directed law: its bodies decide through it (only the default dispatch is skipped; the cadence,
   *  the body step and its contacts stay) and its hits scale by it, times `eliteDamage` for an elite recipe (1 without, as
   *  the page's eliteDamageMul for an actor with no elite damage bound). */
  bindSpecies(kind: string, law: NativeDirected['law'], eliteDamage?: NativeDirected['eliteDamage']): void {
    if (this.directed.has(kind)) throw new Error('Duplicate native directed species');
    const directed: NativeDirected = { law, ...(eliteDamage === undefined ? {} : { eliteDamage }) }; this.directed.set(kind, directed);
    for (const actor of this.bodies) if (actor.kind === kind && this.contexts.has(actor)) this.scaleHits(actor, directed);
  }
  private scaleHits(actor: HuntBody, directed: NativeDirected): void {
    if (!directed.law.scalesDamage) return;
    actor.combatActor().damageMul = request => directed.law.damageScale(actor.mem, request.point) * (directed.law.elite ? directed.eliteDamage?.(actor, request) ?? 1 : 1);
  }
  private context(actor: HuntBody, dt: number) {
    const context = this.contexts.get(actor); if (context === undefined) throw this.missing;
    context.dt = dt; context.t = this.host.clock.now; context.playerSpeed = this.manager.noise.speed; context.calm = this.calmState;
    context.herd = actor.herd >= 0 ? this.hunt.herds[actor.herd]?.members ?? null : null; return context;
  }
  private dog(actor: HuntBody, dt: number): void {
    const flock = this.flocks.find(row => row.dog === actor);
    if (flock === undefined) { actor.setMotion(actor.yaw, 0, 1); return; }
    if(this.projection===undefined)throw new Error('Missing native crowd projection rows');
    actor.mem['dogThinkAt']=this.host.clock.now;
    const context=this.context(actor,dt);
    if(context.projection.owner?.crowd?.owner!==flock)context.projection.owner={scope:this.host.scope,group:'crowd.guard',slot:0,identity:actor.entityId,random:this.host.rng.stream('ai'),
      crowd:{owner:flock,point:this.sheep},rosters:new Map([['threats',this.wolves]])};
    const outputs=this.projection.step(actor,context,context.projection.owner);
    if(outputs!==undefined)for(const [channel,value]of Object.entries(outputs))if(value!==0&&!this.projection.consumes(channel))
      sayFightView(this.host,`creature.output:${channel}`,[actor.position.x,this.host.groundHeightAt(actor.position.x,actor.position.z),actor.position.z,value]);
  }

  private decide(actor: HuntBody, dt: number): void {
    const elite = this.elites.brains.get(actor);
    if (!actor.alive) { actor.lookWeight = 0; return; }
    // a directed kind (ghost riders) decides through its own law: it needs no elite brain
    const directed = this.directed.get(actor.kind);
    if (directed === undefined && this.rows.eliteKinds.includes(actor.kind) && elite === undefined) throw this.missing;
    if (actor.stunned) { actor.setMotion(actor.yaw, 0, 1); actor.setStrafe(0); actor.lookTarget.copy(this.host.nearestPlayer(actor.position).position); actor.lookWeight = 1; return; }
    if (directed !== undefined) {
      // the page's self-thinking path (AnimalManager.thinkFrame): its context, its herd, the ground under it, its own law
      const context = this.context(actor, dt), herd = actor.herd >= 0 ? this.hunt.herds[actor.herd] : undefined;
      actor.sampleTerrain(); directed.law.decide(actor, context);
      if (herd !== undefined) this.hunt.updateHerd(herd);
      return;
    }
    Object.assign(this.route, { elite: Number(elite !== undefined), wolf: Number(actor.kind === this.rows.packKind), dog: Number(actor.kind === this.rows.dogKind), held: Number(actor.mem['ridden'] === 1 || actor.mem['owned'] === 1) });
    const route = this.author.project(this.rows.dispatch, this.route)['state'];
    if (route === 0) return;
    const context = this.context(actor, dt);
    if (route === 1) elite?.think(actor, context);
    else if (route === 2) { const pack = this.packs.get(actor); if (pack === undefined) actor.setMotion(actor.yaw, 0, 1); else { pack.tick(context); pack.drive(actor, context); context.confine(actor); } }
    else if (route === 3) this.dog(actor, dt);
    else if (route === 4) { const herd = this.herds.get(actor); if (herd === undefined) actor.setMotion(actor.yaw, 0, 1); else { herd.tick(context); herd.drive(actor, context); } }
    const herd = actor.herd >= 0 ? this.hunt.herds[actor.herd] : undefined; if (herd !== undefined) this.hunt.updateHerd(herd);
  }
  private takeStep(id: string, urgent: boolean): number {
    const actor = this.host.entities.get(id); if (actor === undefined) throw this.missing;
    const dt = this.host.brainDt(id, urgent);
    this.focused();
    if(this.always.has(actor.kind))return dt;
    const last = actor.mem['groupThinkAt'];
    if (dt <= 0 || (last !== undefined && this.host.clock.now-last < .1-1e-9)) return 0;
    actor.mem['groupThinkAt'] = this.host.clock.now; return last === undefined ? dt : this.host.clock.now-last;
  }
  /** Advance after world and riding observations, before the native body phase. */
  update(dt: number): void {
    this.cadence.observe(dt); this.manager.noise.prev.y = 0;
    this.manager.advance(dt); this.cadence.decide();
  }
  /** Did any player start a dodge? A cooldown only rises on one. A player who has not been seen has not dodged yet. */
  private dodged(): boolean {
    let any = false, first = true;
    for (const { id, dodge } of this.host.players.values()) {
      const was = first ? this.dodgeCd : this.otherDodges.get(id) ?? dodge.cd;
      if (dodge.cd > was) any = true;
      if (first) this.dodgeCd = dodge.cd; else this.otherDodges.set(id, dodge.cd);
      first = false;
    }
    return any;
  }
  snapshot(): number { return this.dodgeCd; }
  /** Other players' last cooldowns, saved beside the first's. */
  otherCooldowns(): Readonly<Record<string, number>> { return Object.fromEntries(this.otherDodges); }
  restoreOthers(rows: Readonly<Record<string, number>> | undefined): void { this.otherDodges.clear(); for (const [id, value] of Object.entries(rows ?? {})) this.otherDodges.set(id, value); }
  restore(value: number): void { if (!Number.isFinite(value) || value < 0) throw this.missing; this.dodgeCd = value; }
}

/** a directed kind's law (DirectedLaw) and the elite damage it multiplies in */
interface NativeDirected {
  readonly law: Pick<DirectedLaw, 'decide' | 'damageScale' | 'elite' | 'scalesDamage'>;
  readonly eliteDamage?: (actor: HuntBody, request: DamageRequest) => number;
}
interface WildlifeFrameState { init: boolean; x: number; z: number; v: number; at?: number }
/** A room player's saved gait. */
type WildlifeGait = Readonly<Required<Omit<WildlifeFrameState, 'init'>>>;
export interface NativeWildlifeRows {
  speed: string; alert: string; range: string; packRadius: number; scareSeconds: number; scareRadius: number; foragerRunSpeed: number;
  trample: { kinds: Readonly<Record<string, number>>; minSpeed: number; range: number; fullSpeed: number };
  knockdown: { speed: number; min: number; max: number; seconds: number };
}
/** Continuous world observations around the existing native group and crowd
 * owners. Placement and response decisions stay in their admitted guest. */
export class NativeWildlifeFrame {
  private reportedFrame = false;
  private readonly state: WildlifeFrameState = { init: false, x: 0, z: 0, v: 0, at: 0 };
  /** Every other player's gait, by id. It saves beside the first's only with company, so a lone save keeps its bytes. */
  private readonly company = new Map<string, WildlifeFrameState>();
  private readonly fields = { x: 0, z: 0, px: 0, pz: 0, dt: 0, speed: 0 };
  private readonly relations: PopulationRelations<AnimalSim>;
  constructor(private readonly host: SimHost, private readonly author: ReturnProgram, private readonly bodies: readonly HuntBody[],
    private readonly wildWolves: readonly HuntBody[], private readonly wolves: HuntBody[],
    packs: readonly PackBrain<AnimalSim>[], herds: readonly HerdBrain<AnimalSim>[], private readonly flocks: readonly FlockBrain[],
    private readonly foragers: ForagerPopulation, private readonly trample: TrampleField, private readonly rows: NativeWildlifeRows) {
    if (!(foragers instanceof ForagerPopulation) || !(trample instanceof TrampleField) || bodies.length > 64 || flocks.length > 4) throw new Error('Invalid native wildlife owners');
    this.relations = new PopulationRelations(author, { packs, herds, crowds: flocks }, { alert: rows.alert, range: rows.range, packRadius: rows.packRadius,
      disturbRadius: 0, disturbSeconds: 0, scareSeconds: rows.scareSeconds });
  }
  update(dt: number, crouched: boolean): void {
    try { this.updateFrame(dt, crouched); }
    catch (error) {
      if (!this.reportedFrame) { this.reportedFrame = true; emitFault({system: 'population.wildlife', error, verdict: 'retry'}); }
    }
  }
  /** Accepted native effects stay accepted; a refused frame is never replayed. */
  private updateFrame(dt: number, crouched: boolean): void {
    const host = this.host, company = this.company; let first = true;
    for (const id of company.keys()) if (!host.players.has(id)) company.delete(id);
    for (const body of host.players.values()) { this.pace(first ? this.state : this.gaitOf(body.id), body.position); first = false; }
    this.wolves.length = 0; for (const wolf of this.wildWolves) if (wolf.alive) this.wolves.push(wolf);
    const row = this.rows.trample;
    for (const actor of this.bodies) {
      const radius = row.kinds[actor.kind];
      if (radius === undefined || !actor.alive || actor.speed < row.minSpeed) continue;
      const player = host.nearestPlayer(actor.position).position;
      if (Math.hypot(actor.position.x-player.x, actor.position.z-player.z) > row.range) continue;
      this.trample.push(actor.position.x, actor.position.z, radius*actor.scale, Math.min(1,actor.speed/row.fullSpeed), Math.sin(actor.yaw)*actor.speed, Math.cos(actor.yaw)*actor.speed);
    }
    for (const flock of this.flocks) {
      const near = host.nearestPlayer({ x: flock.cx, y: host.playerFocus.y, z: flock.cz });
      flock.update(dt, host.clock.now, near.position, this.gaitOf(near.id).v, this.wolves);
    }
    const run = this.rows.foragerRunSpeed, focus = host.focusedPlayer;
    const alarm = this.foragers.update(dt, focus.position, this.gaitOf(focus.id).v > run, crouched, host.players.size === 1 ? undefined : (x, z) => {
      const near = host.nearestPlayer({ x, y: focus.position.y, z });
      return { viewer: near.position, fast: this.gaitOf(near.id).v > run, crouched: crouched && near === focus };
    });
    if (alarm !== null) this.relations.alert(alarm.x, alarm.z);
    this.relations.ripple();
  }
  /** How `player` moves: the host's first player keeps the frame's own `state`, the rest a row of `company`. */
  private gaitOf(player: string): WildlifeFrameState {
    if (this.host.players.size === 1) return this.state;
    const [first] = this.host.players.keys();
    if (first === player) return this.state;
    let gait = this.company.get(player);
    if (gait === undefined) { gait = { init: false, x: 0, z: 0, v: 0, at: this.host.clock.now }; this.company.set(player, gait); }
    return gait;
  }
  /** Measure one player's speed on the 10 Hz clock, through the guest's own projection. */
  private pace(state: WildlifeFrameState, player: { readonly x: number; readonly z: number }): void {
    if (!state.init) { state.x = player.x; state.z = player.z; state.init = true; }
    const elapsed = this.host.clock.now-(state.at ?? 0);
    if (elapsed < .1-1e-9) return;
    Object.assign(this.fields, { x: player.x, z: player.z, px: state.x, pz: state.z, dt: elapsed, speed: state.v });
    const speed = this.author.project(this.rows.speed, this.fields)['speed']; if (speed === undefined || !Number.isFinite(speed)) throw new Error('Invalid native wildlife speed');
    state.v = speed; state.x = player.x; state.z = player.z; state.at = this.host.clock.now;
  }
  scare(x: number, z: number, radius: number = this.rows.scareRadius): void { this.relations.scare(x, z, radius); this.host.events.emit('creature.signal', { name: 'scare', x, z }); }
  private readonly knocked={x:0,z:0};
  knockdown(x: number, z: number, strength: number): void {
    const row=this.rows.knockdown;knockdownVelocity(row,x,z,strength,this.knocked);
    this.host.nearestPlayer({x,y:this.host.playerFocus.y,z}).dashAt(this.knocked.x,this.knocked.z,row.seconds);
    this.host.events.emit('creature.knockdown',{x,z,strength});
  }
  snapshot(): { wild: { init: boolean; x: number; z: number; v: number; at: number; company?: Record<string, WildlifeGait> }; flocks: string[]; marmots: ReturnType<ForagerPopulation['snapshot']> } {
    const company = Object.fromEntries([...this.company].map(([id, { x, z, v: speed, at }]) => [id, { x, z, v: speed, at: at ?? 0 }]));
    return { wild: { ...this.state, at: this.state.at ?? 0, ...(this.company.size === 0 ? {} : { company }) }, flocks: this.flocks.map(flock => flock.snapshot()), marmots: this.foragers.snapshot() };
  }
  restore(saved: { wild: WildlifeFrameState & { readonly company?: Readonly<Record<string, WildlifeGait>> }; flocks: readonly string[]; marmots: unknown }): void {
    if (saved.flocks.length !== this.flocks.length || ![saved.wild.x,saved.wild.z,saved.wild.v,saved.wild.at ?? this.host.clock.now].every(Number.isFinite)) throw new Error('Invalid native wildlife continuation');
    const { company = {}, ...own } = saved.wild;
    Object.assign(this.state, own, { at: own.at ?? this.host.clock.now }); this.foragers.restore(saved.marmots);
    this.company.clear(); for (const [id, gait] of Object.entries(company)) this.company.set(id, { ...gait, init: true });
    saved.flocks.forEach((wire, index) => { this.flocks[index]?.restore(wire); });
  }
}

/** Native grass and weather observations are a concrete game service. Content
 * supplies numeric defaults; signal and knockdown effects bind only game owners. */
/** G600 L5: the grass-cover senses an entered page and a native world share: the player's state as the senses read it
 *  and the admitted senses guest's visibility, downwind and hearing over the owner's grass heights and wind. */
export abstract class WildSenses {
  abstract readonly wind: { readonly x: number; readonly z: number; readonly strength: number };
  playerFwdX = 0; playerFwdZ = -1; playerCrouched = false; playerMounted = false; playerHealth01 = 1;
  lastShotT = -1e9; light = 1; storm = false;
  /** The last hearing reading and all it was read from. */
  private heard: { readonly senses: ReturnProgram | null; readonly x: number; readonly z: number; readonly speed: number; readonly storm: boolean; readonly radii: readonly number[]; readonly value: number } | undefined;
  /** the admitted senses guest (null before an owner binds one) */
  protected abstract senses(): ReturnProgram | null;
  abstract grassStandingAt(x: number, z: number): number;
  abstract grassHeightAt(x: number, z: number): number;
  /** Standard grass-cover senses over this world's concrete field owners. */
  visibility(x: number, z: number, player: Vector3, speed: number, now: number): number {
    const dx = x-player.x, dz = z-player.z, distance = Math.hypot(dx,dz) || 1;
    const samples = [1.5,3,5].filter(step => step <= distance).map(step => ({ height: this.grassHeightAt(player.x+dx/distance*step,player.z+dz/distance*step) }));
    return v.parse(v.number(), this.senses()?.project('visibility', { height: this.grassStandingAt(player.x,player.z), crouched: Number(this.playerCrouched), speed, elapsed: now-this.lastShotT, light: this.light, count: samples.length }, undefined, samples)['fraction']);
  }
  downwind(x: number, z: number, player: Vector3): boolean {
    const dx = x-player.x, dz = z-player.z;
    return this.senses()?.project('downwind', { distance: Math.hypot(dx,dz), strength: this.wind.strength, dot: dx*this.wind.x+dz*this.wind.z })['accept'] === 1;
  }
  hearing(radii: readonly [number,number,number,number], player: Vector3, speed: number): number {
    // Every member of a herd asks this of one player in one tick, and the answer depends on nothing else: a program call each is 15 for one reading.
    const senses = this.senses(), { x, z } = player, { storm } = this, last = this.heard;
    if (last !== undefined && last.senses === senses && last.x === x && last.z === z && last.speed === speed && last.storm === storm && last.radii.every((radius, index) => radius === radii[index])) return last.value;
    const value = v.parse(v.number(), senses?.project('hearing', { speed, height: this.grassStandingAt(x,z), storm: Number(storm) }, undefined, radii.map(radius => ({ radius })))['radius']);
    this.heard = { senses, x, z, speed, storm, radii: [...radii], value };
    return value;
  }
}
export class NativeWildEnvironment extends WildSenses {
  readonly wind: { x: number; z: number; strength: number };
  private host: SimHost | null = null;
  private frame: NativeWildlifeFrame | null = null;
  constructor(readonly field: GrassField, readonly trampleField: TrampleField, private readonly rows: { wind: { x: number; z: number; strength: number }; flatten: number }, private readonly author: ReturnProgram) {
    super();
    if (!(field instanceof GrassField) || !(trampleField instanceof TrampleField)) throw new Error('Invalid native grass owners'); this.wind = { ...rows.wind };
  }
  protected senses(): ReturnProgram { return this.author; }
  bind(host: SimHost, frame: NativeWildlifeFrame): void {
    if (this.host !== null || !(frame instanceof NativeWildlifeFrame)) throw new Error('Invalid native world binding'); this.host = host; this.frame = frame;
    installPopulationSignals(host);
  }
  grassStandingAt(x: number, z: number): number { return this.field.baseHeightAt(x,z); }
  grassHeightAt(x: number, z: number): number { return this.field.baseHeightAt(x,z)*(1-this.rows.flatten*this.trampleField.amountAt(x,z)); }
  trample(x: number, z: number, radius: number, strength: number, vx: number, vz: number): void { this.trampleField.push(x,z,radius,strength,vx,vz); }
  onEvent(name: string, x: number, z: number): void {
    if (this.host === null) throw new Error('Unbound native world signal'); this.host.events.emit('creature.signal', { name,x,z });
  }
  onKnockdown(x: number, z: number, strength: number): void { if (this.frame === null) throw new Error('Unbound native knockdown'); this.frame.knockdown(x,z,strength); }
}
