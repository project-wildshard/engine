import {HERD_DRIVE_PLAN_FIELDS,GUARDED_STALLION_STATES,GuardedHerdGuestSchema,type GuardedHerdGuestRows} from '@wildshard/format/groupBrains';
import * as v from 'valibot';
import { MathUtils, Vector3 } from 'three';
import { GroupBrain, type GroupGuestPublicationV2, type GroupGuestProjectionV2, type GroupGuestBindingsV2, type GroupGuestFrameV2 } from '../../../shared/engine/ai/GroupBrain';
import type { GroupBankValueV2, GroupBankReferenceV2 } from '@wildshard/format/scriptGroupBankV2';
import type { Scope } from '../../../shared/engine/app/scope';
import { GroupBankV2 } from '../../../shared/engine/script/groupBankV2';
import type { GroupStepNativeResultV2 } from '../../../shared/engine/script/groupStepV2';
import { isJsonData } from '@wildshard/format/json';
import type { AnimalSim } from '../../../shared/engine/entities/AnimalSim';
import type { Rng } from '../../../shared/engine/core/rng';
import { emitFault } from '../../../shared/engine/core/faults';
import type { SimValue } from '../sim';
import { inspectBrain } from '../../../shared/engine/ai/inspect';
import { StrikeRunner, type StrikeSpec, type StrikeContext } from '../../../shared/engine/ai/strikes';
import { readStrikeState } from '../../../shared/engine/ai/strikeState';

/** One native call owns this scratch; nested calls receive independent rows. */
interface HerdGuestColumns<A extends AnimalSim> {
  scope: Scope; self: {group:string;slot:number;identity:string;actor:A};
  player: {position:Vector3}; observed: Map<number,AnimalSim>;
  references: Map<string,(GroupBankReferenceV2 & {readonly body:A}) | null>;
  results: {foal:number;mother:number;reply:number} & Record<string,number>;
  t:number;dt:number;context?:GuardedHerdContext<A>;
}

/** One call depth's bodies and the reference rows lent for them. */
interface HerdGuestLoan<A extends AnimalSim> {
  readonly binding: object; readonly pool: readonly A[]; readonly members: readonly A[]; readonly bodies: readonly A[];
  readonly references: (GroupBankReferenceV2 & {group:string;slot:number;body:A})[];
  readonly byBody: ReadonlyMap<A,GroupBankReferenceV2 & {group:string;slot:number;body:A}>;
  readonly byWire: ReadonlyMap<string,GroupBankReferenceV2 & {group:string;slot:number;body:A}>;
}

/** Rim, fall and random grazing parameters for a committed ram. */
export interface WanderGrazerSpec {
  grazeSpeed: number; ramSpeed: number; noticeRadius: number; rimMargin: number; fallDrop: number;
  levelTolerance: number; threatSpeed: number; wanderMinSeconds: number; wanderMaxSeconds: number; rampRate: number;
}
/** Circular home, timed challenge and distance-weighted strike parameters. */
export interface CircleGrazerSpec {
  noticeRadius: number; chargeRadius: number; loseRadius: number; walkSpeed: number; approachSpeed: number;
  homeRadius: number; faceSeconds: number; circleRate: number;
  farPreferenceRadius: number; farWeight: number; nearWeight: number; closeWeight: number;
  windupField: string; recoveryField: string;
}
/** Trusted current home, target, contact and random stream for wandering grazers. */
export interface WanderGrazerPorts<A extends AnimalSim> {
  dt: number; player: A['position']; calm: boolean; rng: Pick<Rng, 'range'>;
  home: { x: number; z: number; r: number; y: number };
  reach: (actor: A) => boolean; claim: (actor: A) => boolean; hurt: (damage: number) => void;
  /** Optional exact selected-strike filing; absent preserves the legacy damage-only callback. */
  strikeHit?: (strike: StrikeSpec) => void;
}
/** Trusted stable circle phase, target, navigation and contact for challenging grazers. */
export interface CircleGrazerPorts<A extends AnimalSim> {
  dt: number; t: number; player: A['position']; calm: boolean; phaseOffset: number;
  reach: (actor: A) => boolean; claim: (actor: A) => boolean; hurt: (damage: number) => void;
  /** Optional exact selected-strike filing; absent preserves the legacy damage-only callback. */
  strikeHit?: (strike: StrikeSpec) => void;
  steer: (actor: A, yaw: number, speed: number, turn: number) => void;
}
/** Shared grazing, alert and flight modes of a guarded herd. */
export type GuardedHerdMode = 'graze' | 'drift' | 'alert' | 'flee' | 'settle';
/** Guard animal decisions; riding and taming remain host-owned recipes. */

export type GuardedStallionState = typeof GUARDED_STALLION_STATES[number];
/** Declared guarded-herd tuning, independent of any particular species rig. */
export interface GuardedHerdSpec {
  walkSpeed: number; trotSpeed: number; gallopSpeed: number; chargeSpeed: number;
  sightRadius: number; grazingSightRadius: number; coneAngle: number; hearing: readonly [number, number, number, number];
  alertThreshold: number; flightMinDistance: number; flightMaxDistance: number;
  stallionVariant: string; foalPrefix: string; snortCue: string; neighCue: string; squealCue: string;
}
/** Host-owned clock, steering and player observations for one AI or body tick. */
export interface GuardedHerdContext<A extends AnimalSim> {
  dt: number; t: number; player: Vector3; playerSpeed: number; calm: boolean; rng: Rng;
  sound: (cue: string) => void; hurt: (damage: number) => void;
  steer: (actor: A, yaw: number, speed: number, turn: number) => void;
  pathYaw: (actor: A, x: number, z: number, every?: number) => number; confine: (actor: A) => void;
}
/** Native sensing, terrain, pass-through, contact and shared-RNG recipes; no renderer or app singleton. */
export interface GuardedHerdPorts<A extends AnimalSim> {
  sharedRng: () => Rng; environment: () => { playerMounted: boolean; playerCrouched: boolean };
  visibility: (x: number, z: number, player: Vector3, speed: number, time: number) => number;
  hearing: (radii: readonly [number, number, number, number], player: Vector3, speed: number) => number;
  downwind: (x: number, z: number, player: Vector3) => boolean;
  inBounds: (x: number, z: number, margin: number) => boolean; normalY: (x: number, z: number) => number;
  /** the standing grass height at a point, for a guest that keeps its herd in cover (absent: no grass query) */
  grassHeightAt?: (x: number, z: number) => number;
  passThrough: (actor: A, player: boolean) => void; chargeContact: (actor: A, context: GuardedHerdContext<A>, radius: number) => void;
  scarePack: (actor: A, radius: number) => boolean; resolveActor?: (id: string) => A | null;
  onEvent?: (event: string, x: number, z: number) => void; onKnockdown?: (x: number, z: number, strength: number) => void;
}
const _t = new Vector3();
const angDiff = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));
function validateHerd(spec: GuardedHerdSpec): GuardedHerdSpec {
  const numbers = [spec.walkSpeed, spec.trotSpeed, spec.gallopSpeed, spec.chargeSpeed, spec.sightRadius, spec.grazingSightRadius,
    spec.coneAngle, ...spec.hearing, spec.alertThreshold, spec.flightMinDistance, spec.flightMaxDistance];
  if (numbers.some(value => !Number.isFinite(value) || value < 0 || value > 600) || Math.max(spec.walkSpeed, spec.trotSpeed, spec.gallopSpeed, spec.chargeSpeed) > 15
    || spec.walkSpeed > spec.trotSpeed || spec.trotSpeed > spec.gallopSpeed || spec.grazingSightRadius > spec.sightRadius
    || spec.coneAngle > Math.PI || spec.alertThreshold <= 0 || spec.alertThreshold > 1 || spec.flightMinDistance > spec.flightMaxDistance
    || [spec.stallionVariant, spec.foalPrefix, spec.snortCue, spec.neighCue, spec.squealCue].some(value => value.length === 0 || value.length > 128)) throw new Error('Invalid herd parameters');
  return { ...spec, hearing: [...spec.hearing] };
}
const herdFinite = v.pipe(v.number(), v.finite());
const herdContinuation: v.StrictObjectSchema<{ readonly [Key in Exclude<keyof HerdContinuationData, 'state'>]: v.GenericSchema<HerdContinuationDataInput[Key], HerdContinuationData[Key]> } & { readonly state: v.StrictObjectSchema<{ readonly [Key in keyof HerdContinuationData['state']]: v.GenericSchema<HerdContinuationDataInput['state'][Key], HerdContinuationData['state'][Key]> }, undefined> }, undefined> = v.strictObject({ contract: v.string(), group: v.string(), lead: v.nullable(v.string()), stallion: v.nullable(v.string()),
  ridden: v.nullable(v.string()), chargeTarget: v.nullable(v.string()), foals: v.array(v.string()), mothers: v.array(v.tuple([v.string(), v.string()])),
  state: v.strictObject({ initialized: v.boolean(), mode: v.picklist(['graze', 'drift', 'alert', 'flee', 'settle']), stampeding: v.boolean(),
    stallionState: v.picklist(GUARDED_STALLION_STATES), trust: herdFinite, alert: herdFinite,
    alertOwned: v.boolean(), cx: herdFinite, cz: herdFinite, spotX: herdFinite, spotZ: herdFinite, spotT: herdFinite, fleeX: herdFinite, fleeZ: herdFinite,
    fleeRun: herdFinite, fleeLen: herdFinite, fleeFromX: herdFinite, fleeFromZ: herdFinite, modeT: herdFinite, sT: herdFinite, chargeCd: herdFinite,
    beatenT: herdFinite, beaten: v.boolean(), knockCd: herdFinite }) });
const herdGuestStorage = [...Object.keys(herdContinuation.entries.state.entries),'lead','stallion','ridden','chargeTarget','groupTime'];
const herdStateNames = Object.keys(herdContinuation.entries.state.entries);
/** Every bank field `prepareHerdGuestState` publishes to the owner. */
const herdGuestPublished = [...herdStateNames,'lead','stallion','ridden','chargeTarget','groupTimePresent','groupTime'];
const herdFlags = new Set(['initialized','stampeding','alertOwned','beaten']);
/** The scalar schema's own answer for a well-formed candidate, without its per-segment parse. Anything else returns
 * undefined, and the schema reads it and says why. */
function readHerdScalars(candidate: Readonly<Record<string,unknown>>, entries: readonly [string,unknown][]): HerdContinuationData['state'] | undefined {
  const next: Record<string,unknown> = {};
  return entries.length === herdStateNames.length && copyHerdScalars(candidate, entries, next) ? next : undefined;
}
function copyHerdScalars(candidate: Readonly<Record<string,unknown>>, entries: readonly [string,unknown][], next: Record<string,unknown>): next is HerdContinuationData['state'] {
  for (let index = 0; index < herdStateNames.length; index++) {
    const name = herdStateNames[index];
    if (name === undefined || entries[index]?.[0] !== name) return false;
    const value = candidate[name];
    if (name === 'mode' ? value !== 'graze' && value !== 'drift' && value !== 'alert' && value !== 'flee' && value !== 'settle'
      : name === 'stallionState' ? !GUARDED_STALLION_STATES.some(state => state === value)
      : herdFlags.has(name) ? typeof value !== 'boolean' : typeof value !== 'number' || !Number.isFinite(value)) return false;
    next[name] = value;
  }
  return true;
}


/** A movement/attack pattern; old row names select these presets without changing their save contract. */
export type GrazerProfile<A extends AnimalSim = AnimalSim> =
  | { pattern: 'herd'; spec: GuardedHerdSpec; ports: GuardedHerdPorts<A> }
  | { pattern: 'wander-ram'; spec: WanderGrazerSpec; strike: StrikeSpec }
  | { pattern: 'circle-challenge'; spec: CircleGrazerSpec; charge: StrikeSpec; close: StrikeSpec };
/** Pattern-specific authority supplied by the owning body; a different pattern refuses before ticking. */
export type GrazerObservation<A extends AnimalSim> =
  | (WanderGrazerPorts<A> & { pattern: 'wander-ram' })
  | (CircleGrazerPorts<A> & { pattern: 'circle-challenge' });
/** The policy phase, distinct from the strike runner's own windup/contact/recovery. */
export type GrazerState = 'graze' | 'threat' | 'ram' | 'fall' | 'notice' | 'fight';
const finite = v.pipe(v.number(), v.finite());
const ramContinuation = v.strictObject({
  contract: v.string(), state: v.picklist(['graze', 'threat', 'ram', 'fall']),
  wanderYaw: finite, wanderT: finite, ramYaw: finite, strikes: v.unknown(),
});
const circleContinuation = v.strictObject({
  contract: v.string(), state: v.picklist(['graze', 'notice', 'fight']),
  clock: v.pipe(finite, v.minValue(0)), homeX: finite, homeZ: finite, strikes: v.unknown(),
});
function copyStrike(strike: StrikeSpec): StrikeSpec {
  const copy = { ...strike, shape: { ...strike.shape }, tags: [...strike.tags] };
  if (strike.motion !== undefined) copy.motion = { ...strike.motion };
  return copy;
}
function admitProfile<A extends AnimalSim>(profile: GrazerProfile<A>): GrazerProfile<A> {
  if (profile.pattern === 'herd') return { ...profile, spec: validateHerd(profile.spec) };
  if (profile.pattern === 'wander-ram') {
    const { spec, strike } = profile;
    const values = [spec.grazeSpeed, spec.ramSpeed, spec.noticeRadius, spec.rimMargin, spec.fallDrop,
      spec.levelTolerance, spec.threatSpeed, spec.wanderMinSeconds, spec.wanderMaxSeconds, spec.rampRate];
    if (values.some(value => !Number.isFinite(value) || value < 0 || value > 600)
      || spec.grazeSpeed > 10 || spec.ramSpeed > 15 || spec.threatSpeed > 15 || spec.wanderMinSeconds <= 0
      || spec.wanderMinSeconds > spec.wanderMaxSeconds || spec.rampRate <= 0 || spec.levelTolerance <= 0
      || strike.shape.kind !== 'lane' || strike.windup <= 0 || strike.range <= 0
      || ![strike.windup, strike.active, strike.recover, strike.cooldown, strike.range, strike.damage, strike.shape.length, strike.shape.width].every(value => Number.isFinite(value) && value >= 0)
      || strike.id.length === 0 || strike.id.length > 128) throw new Error('Invalid ram grazer parameters');
    return { pattern: profile.pattern, spec: { ...spec }, strike: copyStrike(strike) };
  }
  {
    const { spec, charge, close } = profile;
    const values = [spec.noticeRadius, spec.chargeRadius, spec.loseRadius, spec.walkSpeed, spec.approachSpeed,
      spec.homeRadius, spec.faceSeconds, spec.circleRate, spec.farPreferenceRadius, spec.farWeight, spec.nearWeight, spec.closeWeight];
    if (values.some(value => !Number.isFinite(value) || value < 0 || value > 600) || spec.walkSpeed > 15 || spec.approachSpeed > 15
      || spec.noticeRadius > spec.loseRadius || spec.faceSeconds <= 0 || spec.chargeRadius <= 0
      || [spec.windupField, spec.recoveryField].some(key => !/^[a-z][a-z0-9._:-]*$/u.test(key) || key.length > 128)
      || spec.windupField === spec.recoveryField || charge.shape.kind !== 'lane' || close.shape.kind !== 'arc'
      || charge.id === close.id || [charge, close].some(strike => strike.id.length === 0 || strike.id.length > 128
        || ![strike.windup, strike.active, strike.recover, strike.cooldown, strike.range, strike.damage].every(value => Number.isFinite(value) && value >= 0))) throw new Error('Invalid challenge grazer parameters');
    const tuning = { ...spec }, charged = copyStrike(charge), closed = copyStrike(close);
    charged.weight = context => Math.hypot(context.target.x - context.actor.position.x,
      context.target.z - context.actor.position.z) > tuning.farPreferenceRadius ? tuning.farWeight : tuning.nearWeight;
    closed.weight = () => tuning.closeWeight;
    return { pattern: profile.pattern, spec: tuning, charge: charged, close: closed };
  }
}

/** Parametric grazing/challenge policy with one strike owner, atomic restoration and native body authority. */
export class GrazerBrain<A extends AnimalSim> extends GroupBrain<A> {
  private readonly boundActor: A | null;
  private get actor(): A { if (this.boundActor === null) throw new Error('Missing single grazer actor authority'); return this.boundActor; }
  private readonly profile: GrazerProfile<A>;
  private readonly contract: string;
  private reportedFrames: Set<string> | undefined;
  private rejectFrame(message: string): false {
    const reported = this.reportedFrames ??= new Set();
    if (!reported.has(message)) {reported.add(message); emitFault({system: 'ai.grazer', error: new Error(message), verdict: 'retry'});}
    return false;
  }
  private readonly strikes = new StrikeRunner();
  private phase: GrazerState = 'graze';
  private wanderYaw = 0;
  private wanderT = 0;
  private ramYaw = 0;
  private clock = 0;
  private homeX: number;
  private homeZ: number;
  constructor(actor: A, profile: Exclude<GrazerProfile<A>, { pattern: 'herd' }>);
  constructor(members: A[], profile: Extract<GrazerProfile<A>, { pattern: 'herd' }>);
  constructor(actor: A | A[], profile: GrazerProfile<A>) {
    super(Array.isArray(actor) ? actor : [actor]);
    this.boundActor = Array.isArray(actor) ? null : actor; this.profile = admitProfile(profile);
    this.homeX = Array.isArray(actor) ? 0 : actor.position.x; this.homeZ = Array.isArray(actor) ? 0 : actor.position.z;
    const p = this.profile;
    if (p.pattern === 'herd') {
      if (!Array.isArray(actor)) throw new Error('Missing grazer herd roster');
      this.contract = JSON.stringify(p.spec);
      const members = actor;
      if (members.length === 0 || members.length > 128 || new Set(members.map(member => member.entityId)).size !== members.length) throw new Error('Invalid herd roster');
      for (const h of members) {
        if (h.variant === this.herdSpec.stallionVariant) this.stallion = h;
        else if (h.variant.startsWith(this.herdSpec.foalPrefix)) this.foals.push(h);
      }
      // the lead mare: the biggest adult mare
      for (const h of members) if (h !== this.stallion && !this.foals.includes(h) && (this.lead === null || h.scale > this.lead.scale)) this.lead = h;
      // each foal gets the nearest adult mare as its mother
      for (const f of this.foals) {
        let best: A | null = null, bd = Infinity;
        for (const h of members) {
          if (h === this.stallion || this.foals.includes(h)) continue;
          if ([...this.mothers.values()].includes(h)) continue;
          const d = h.position.distanceToSquared(f.position);
          if (d < bd) { bd = d; best = h; }
        }
        if (best !== null) this.mothers.set(f, best);
      }
      this.centre();
      this.spotX = this.cx; this.spotZ = this.cz; this.spotT = 0;
      return;
    }
    if (Array.isArray(actor)) throw new Error('Missing single grazer actor authority');
    this.contract = JSON.stringify(p.pattern === 'wander-ram'
      ? { version: 1, actor: actor.entityId, spec: p.spec, strike: p.strike }
      : { version: 1, actor: actor.entityId, spec: p.spec, charge: p.charge, close: p.close });
    inspectBrain(actor, () => ({ state: this.state, picks: [], brainHz: 20, pinned: false }));
  }
  /** Current pattern phase; observations and body execution remain separately scheduled. */
  get state(): GrazerState { return this.phase; }
  /** Preserve the selected legacy pattern's complete continuation, including exact JSON field order. */
  snapshot(): SimValue {
    if (this.profile.pattern === 'herd') return this.snapshotHerd();
    return JSON.stringify(this.profile.pattern === 'wander-ram'
      ? { contract: this.contract, state: this.phase, wanderYaw: this.wanderYaw,
        wanderT: this.wanderT, ramYaw: this.ramYaw, strikes: this.strikes.snapshot() }
      : { contract: this.contract, state: this.phase, clock: this.clock,
        homeX: this.homeX, homeZ: this.homeZ, strikes: this.strikes.snapshot() });
  }
  /** Validate every field and strike identity before mutation; no motion, contact or random draw executes. */
  restore(saved: SimValue): void {
    if (this.profile.pattern === 'herd') { if (typeof saved !== 'string') throw new Error('Invalid herd continuation'); this.restoreHerd(saved); return; }
    const p = this.profile, name = p.pattern === 'wander-ram' ? 'ram' : 'challenge';
    if (typeof saved !== 'string') throw new Error(`Invalid ${name} grazer continuation`);
    const parsed: unknown = JSON.parse(saved);
    if (p.pattern === 'wander-ram') {
      const value = v.parse(ramContinuation, parsed);
      if (value.contract !== this.contract) throw new Error('Incompatible ram grazer continuation');
      const strikes = readStrikeState(value.strikes, [p.strike]);
      if ((value.state === 'ram') !== (strikes.phase !== 'idle')) throw new Error('Invalid ram grazer strike phase');
      this.strikes.restore(strikes, [p.strike]);
      this.phase = value.state; this.wanderYaw = value.wanderYaw; this.wanderT = value.wanderT; this.ramYaw = value.ramYaw;
    } else {
      const value = v.parse(circleContinuation, parsed);
      if (value.contract !== this.contract) throw new Error('Incompatible challenge grazer continuation');
      const strikes = readStrikeState(value.strikes, [p.charge, p.close]);
      this.strikes.restore(strikes, [p.charge, p.close]);
      this.phase = value.state; this.clock = value.clock; this.homeX = value.homeX; this.homeZ = value.homeZ;
    }
  }
  private context(c: WanderGrazerPorts<A> | CircleGrazerPorts<A>): StrikeContext {
    return { actor: this.actor, target: c.player, canReach: () => c.reach(this.actor), hit: spec => { if (c.strikeHit === undefined) c.hurt(spec.damage); else c.strikeHit(spec); } };
  }
  // A zero step is an interrupt's second wake in a frame; it is an ordinary admitted observation.
  private step(c: GrazerObservation<A>): boolean {
    if (this.profile.pattern === 'herd') return this.rejectFrame('Herd motion uses its shared roster cadence');
    if (c.pattern !== this.profile.pattern) return this.rejectFrame('Incompatible grazer observation');
    if (!Number.isFinite(c.dt) || c.dt < 0 || c.dt > 1) {
      return this.rejectFrame(`Invalid ${c.pattern === 'wander-ram' ? 'ram' : 'challenge'} grazer step`);
    }
    if (c.pattern === 'circle-challenge' && (!Number.isFinite(c.t) || !Number.isFinite(c.phaseOffset))) return this.rejectFrame('Invalid challenge grazer observation');
    return true;
  }
  /** Scheduled perception: the pattern preserves distance metric, RNG order and strike tie order. */
  think(c: GrazerObservation<A>): void {
    if (!this.step(c)) return;
    const p = this.profile;
    if (p.pattern === 'wander-ram' && c.pattern === 'wander-ram') this.thinkWander(c, p);
    else if (p.pattern === 'circle-challenge' && c.pattern === 'circle-challenge') this.thinkCircle(c, p);
  }
  /** One fixed body tick: the owning host still executes movement, ballistic impulses and contacts. */
  act(c: GrazerObservation<A>): void {
    if (!this.step(c)) return;
    const p = this.profile;
    if (p.pattern === 'wander-ram' && c.pattern === 'wander-ram') this.actWander(c, p);
    else if (p.pattern === 'circle-challenge' && c.pattern === 'circle-challenge') this.actCircle(c, p);
  }
  private thinkWander(c: WanderGrazerPorts<A>, p: Extract<GrazerProfile, { pattern: 'wander-ram' }>): void {
    const a = this.actor; if (!a.alive) return;
    const d = a.position.distanceTo(c.player), level = Math.abs(c.player.y - a.position.y) < p.spec.levelTolerance;
    if (this.state === 'ram' || this.state === 'fall') return;
    this.phase = !c.calm && level && d < p.spec.noticeRadius ? 'threat' : 'graze';
    this.wanderT -= c.dt;
    if (this.wanderT <= 0) { this.wanderT = c.rng.range(p.spec.wanderMinSeconds, p.spec.wanderMaxSeconds); this.wanderYaw = c.rng.range(-Math.PI, Math.PI); }
    if (this.state === 'threat' && !this.strikes.busy && d < p.strike.range && c.claim(a)) {
      this.ramYaw = Math.atan2(c.player.x - a.position.x, c.player.z - a.position.z);
      this.strikes.start(p.strike, a, c.player); this.phase = 'ram';
    }
  }
  private actWander(c: WanderGrazerPorts<A>, p: Extract<GrazerProfile, { pattern: 'wander-ram' }>): void {
    const a = this.actor; if (!a.alive) return;
    const home = c.home, from = Math.hypot(a.position.x - home.x, a.position.z - home.z);
    if (this.state !== 'fall' && a.position.y < home.y - p.spec.fallDrop) { this.strikes.cancel(); a.cancelAttack(); this.phase = 'fall'; }
    if (this.state === 'fall') { a.setMotion(a.yaw, 0); return; }
    if (a.hasImpulse) return;
    const out = from > home.r - p.spec.rimMargin;
    if (this.state === 'ram') {
      this.strikes.update(c.dt, this.context(c));
      a.setMotion(this.ramYaw, this.strikes.busy && !out ? p.spec.ramSpeed * Math.min(1, Math.max(0, this.strikes.time - p.strike.windup) * p.spec.rampRate) : 0, 6);
      if (!this.strikes.busy) this.phase = 'graze';
      return;
    }
    const toHome = Math.atan2(home.x - a.position.x, home.z - a.position.z);
    if (out) a.setMotion(toHome, p.spec.grazeSpeed * 1.5, 3);
    else if (this.state === 'threat') a.setMotion(Math.atan2(c.player.x - a.position.x, c.player.z - a.position.z), p.spec.threatSpeed, 3);
    else a.setMotion(this.wanderYaw, p.spec.grazeSpeed, 1.5);
  }
  private thinkCircle(c: CircleGrazerPorts<A>, p: Extract<GrazerProfile, { pattern: 'circle-challenge' }>): void {
    const a = this.actor; if (!a.alive) return;
    const d = Math.hypot(c.player.x - a.position.x, c.player.z - a.position.z);
    if (c.calm || (this.state !== 'graze' && d > p.spec.loseRadius)) { if (this.state !== 'graze') this.phase = 'graze'; return; }
    if (this.state === 'graze' && (d < p.spec.noticeRadius || a.hp < a.maxHp)) { this.phase = 'notice'; this.clock = 0; }
    if (this.state === 'fight' && !this.strikes.busy && c.reach(a) && c.claim(a)) {
      const pick = this.strikes.pick([p.charge, p.close], this.context(c)); if (pick) this.strikes.start(pick, a, c.player);
    }
  }
  private actCircle(c: CircleGrazerPorts<A>, p: Extract<GrazerProfile, { pattern: 'circle-challenge' }>): void {
    const a = this.actor; if (!a.alive) return;
    this.clock += c.dt; this.strikes.update(c.dt, this.context(c));
    const toPlayer = Math.atan2(c.player.x - a.position.x, c.player.z - a.position.z);
    a.mem[p.spec.windupField] = this.strikes.state === 'windup' && this.strikes.spec?.id === p.charge.id ? 1 : 0;
    a.mem[p.spec.recoveryField] = this.strikes.state === 'recover' && this.strikes.spec?.id === p.charge.id ? 1 : 0;
    if (this.strikes.busy && this.strikes.state !== 'cooldown') return;
    if (this.state === 'graze') {
      const ang = c.t * p.spec.circleRate + c.phaseOffset,
        tx = this.homeX + Math.sin(ang) * p.spec.homeRadius, tz = this.homeZ + Math.cos(ang) * p.spec.homeRadius;
      c.steer(a, Math.atan2(tx - a.position.x, tz - a.position.z), p.spec.walkSpeed, 0.8); return;
    }
    if (this.state === 'notice') {
      c.steer(a, toPlayer, 0, 2.2);
      if (this.clock > p.spec.faceSeconds) this.phase = 'fight'; return;
    }
    const d = Math.hypot(c.player.x - a.position.x, c.player.z - a.position.z);
    c.steer(a, toPlayer, d > p.spec.chargeRadius * 0.8 ? p.spec.approachSpeed : 0, 2);
  }
  private requireHerd(): void { if (this.profile.pattern !== 'herd') throw new Error('Incompatible herd grazer pattern'); }
  private get herdSpec(): GuardedHerdSpec { const p = this.profile; if (p.pattern !== 'herd') throw new Error('Incompatible herd grazer pattern'); return p.spec; }
  private get herdPorts(): GuardedHerdPorts<A> { const p = this.profile; if (p.pattern !== 'herd') throw new Error('Incompatible herd grazer pattern'); return p.ports; }
  /** The original guarded native authorities lent to a prepared group step. */
  get groupPorts(): GuardedHerdPorts<A> { return this.herdPorts; }
  private initialized = false;
  lead: A | null = null;
  stallion: A | null = null;
  readonly foals: A[] = [];
  mode: GuardedHerdMode = 'graze';
  stampeding = false;
  stallionState: GuardedStallionState = 'watch';
  /** taming (B8): 0..100 */
  trust = 0;
  /** the stallion's ALERT, 0..100 */
  alert = 0;
  /** true while taming (B8, src/shards/nalati-grasslands/ride/Taming.ts) owns `alert` — the herd stops writing it */
  alertOwned = false;
  get calm(): number { return 1 - this.alert / 100; }
  ridden: A | null = null;
  onBeaten?: ((stallion: A, herd: GrazerBrain<A>) => void) | undefined;
  onStallionState?: ((state: GuardedStallionState, herd: GrazerBrain<A>) => void) | undefined;
  onFlight?: ((stampede: boolean, herd: GrazerBrain<A>) => void) | undefined;
  /** nearest living threat to (x, z) within r (Wildlife wires it to the packs) */
  findThreat?: ((x: number, z: number, r: number) => A | null) | undefined;

  cx = 0; cz = 0;
  private spotX = 0; private spotZ = 0; private spotT = 0;
  private fleeX = 0; private fleeZ = 1; private fleeRun = 0; private fleeLen = 100; private fleeFromX = 0; private fleeFromZ = 0;
  private modeT = 0;
  private mothers = new Map<A, A>();
  private sT = 0; private chargeCd = 0; private beatenT = 0; private beaten = false; private chargeTarget: A | null = null;
  private knockCd = 0;

  private guest: {
    readonly program: GroupGuestProjectionV2;
    readonly prepare: GroupGuestProjectionV2['prepareGroup'];
    readonly bindings: GroupGuestBindingsV2;
    readonly shape: GroupGuestBindingsV2 | NonNullable<GroupGuestBindingsV2['profiles']>[number];
    readonly rows: GuardedHerdGuestRows;
    readonly scope: Scope; readonly group: string; readonly handle: number; readonly player: Vector3;
    readonly actors: Map<string,A> | readonly A[];
    readonly codec: GroupBankV2;
    /** every native result channel the profile declares as a member result column (always `reply`); a guest may ask
     *  several native queries in one segment, each answering on its own channel */
    readonly replyChannels: readonly string[];
    readonly contextFields: readonly string[];
    readonly referenceFields: readonly (readonly [string,string])[];
    /** Only frozen, plain admitted declarations can keep their reset plan. */
    readonly resets: readonly { readonly name: string; readonly value: GroupBankValueV2 }[] | undefined;
  } | undefined;
  private readonly guestPlans=new Map<A,{readonly values:readonly number[];applied:boolean}>();
  private readonly guestLoans:(HerdGuestLoan<A>|undefined)[]=[];
  private readonly guestBanks: {bank:Float64Array;values:Readonly<Record<string,GroupBankValueV2>>;bodies:readonly A[]}[]=[];
  private guestDepth=0;
  private guestCandidateDepth=0;
  private readonly guestCandidates:({readonly names:readonly string[];readonly input:Record<string,unknown>}|undefined)[]=[];
  private guestCall: {
    readonly binding: NonNullable<GrazerBrain<A>['guest']>;
    readonly context: GuardedHerdContext<A> | undefined;
    readonly signal: string; readonly bank: Float64Array; readonly slot:number;
    readonly references: (GroupBankReferenceV2 & {group:string;slot:number;body:A})[];
    /** `references` by body: the same rows, looked up once per member per segment */
    readonly bodies: ReadonlyMap<A,GroupBankReferenceV2 & {group:string;slot:number;body:A}>;
    readonly wires: ReadonlyMap<string,GroupBankReferenceV2 & {group:string;slot:number;body:A}>;
    readonly members: HerdGuestColumns<A>[];
    readonly random: Rng;
    readonly arguments: Readonly<Record<string,number>>;
    parameters?: Record<string,number>;
    changes?: Record<string,GroupBankValueV2>;
    reply: number;
    /** the latest answer on each declared reply channel, kept across this call's segments like `reply` */
    replies: Record<string,number>;
    fresh: boolean;
    values: Readonly<Record<string,GroupBankValueV2>>;
  } | undefined;
  /** Select a profile on the SAME admitted programme. Scope, bodies, player and
   * random owners remain concrete native loans; rows contain only bindings. */
  bindGuest(program: GroupGuestProjectionV2, input: unknown, loans: {
    readonly scope: Scope; readonly group: string; readonly handle: number;
    readonly player: Vector3; readonly actors: Map<string,A> | readonly A[];
  }): void {
    this.requireHerd();
    if (this.guest !== undefined || this.initialized || loans.scope.disposed || loans.scope.disposing
      || loans.group.length === 0 || !Number.isSafeInteger(loans.handle) || loans.handle < 1) throw new Error('Invalid herd guest binding owner');
    if (!isJsonData(input)) throw new Error('Herd guest binding requires JSON rows');
    const rows = v.parse(GuardedHerdGuestSchema,input), bindings = program.groupBindings;
    if (bindings === undefined || typeof program.prepareGroup !== 'function') throw new Error('Missing herd guest executable');
    const shape = rows.profile === 'main' ? bindings : bindings.profiles?.find(row => row.id === rows.profile);
    if (shape === undefined || this.members.length > shape.members || shape.bank.some(row => row.kind === 'nullable-number' || row.kind === 'references')
      || ['drive','tick','initialize','stampede','leadAway','addTrust','setRidden','adopt','release','disturb'].some(name => !shape.signals.includes(name))
      || Object.entries(rows.references??{}).some(([name,field]) => ['self','target','threat'].includes(name) || !shape.bank.some(row=>row.name===field&&(row.kind==='number'||row.kind==='reference')))
      || rows.plans===true&&Array.from({length:8},(_,part)=>part).some(part=>!shape.actions.some(action=>action.native?.kind==='locomotion-plan'&&action.native.part===part))
      || !shape.bank.some(row => row.name === rows.resume.field && row.kind === 'number')
      || rows.capture!==undefined&&(rows.capture.common.some(name=>!shape.columns.some(row=>row.name===name))
        ||rows.capture.slots.some(name=>!shape.bank.some(row=>row.name===name&&row.kind==='number'))
        ||rows.capture.references.some(name=>!shape.bank.some(row=>row.name===name&&(row.kind==='number'||row.kind==='reference'))))
      || Object.keys(rows.parameters).some(name => !name.startsWith('context.') || !shape.bank.some(row => row.name === name && row.kind === 'number')))
      throw new Error('Incompatible herd guest profile');
    Object.freeze(rows.resume.values);Object.freeze(rows.resume);
    this.guest = {program,prepare:program.prepareGroup,bindings,shape,rows,scope:loans.scope,group:loans.group,handle:loans.handle,
      player:loans.player,actors:loans.actors,codec:new GroupBankV2(shape.bank),
      replyChannels:[...new Set(['reply',...shape.columns.flatMap(row=>row.source.kind==='result'&&row.source.channel!=='foal'&&row.source.channel!=='mother'?[row.source.channel]:[])])],
      contextFields:shape.bank.filter(row=>row.name.startsWith('context.')).map(row=>row.name),referenceFields:Object.entries(rows.references??{}),
      resets:Object.getPrototypeOf(shape.bank)===Array.prototype&&Object.isFrozen(shape.bank)&&isJsonData(shape.bank)
        &&shape.bank.every(row=>Object.isFrozen(row)&&(row.kind!=='enum'||Object.isFrozen(row.values)))
        ?shape.bank.filter(row=>!herdGuestPublished.includes(row.name)&&!row.name.startsWith('context.')&&row.name!=='slot'&&row.name!=='body')
          .map(row=>({name:row.name,value:row.kind==='boolean'?false:row.kind==='reference'?null:row.kind==='enum'?row.values[0]??'':0}))
        :undefined};
  }
  private validateHerdGuest():void {
    const binding=this.guest;
    if(binding===undefined||binding.scope.disposed||binding.scope.disposing||binding.program.prepareGroup!==binding.prepare
      ||binding.program.groupBindings!==binding.bindings)throw new Error('Replaced herd guest binding');
  }
  /** The rows lent for this roster. A herd asks every tick and its bodies rarely change, so a same-roster call keeps them
   * (one per call depth: a nested call must not share an outer call's rows) and only walks the bodies to prove it. */
  private herdGuestLoan(binding: NonNullable<GrazerBrain<A>['guest']>, depth: number): HerdGuestLoan<A> {
    const actors=binding.actors,count=actors instanceof Map?actors.size:actors.length,members=this.members,known=this.guestLoans[depth];
    if(known?.binding===binding&&known.pool.length===count&&known.members.length===members.length){
      let same=true,index=0;
      for(const body of actors instanceof Map?actors.values():actors)if(known.pool[index++]!==body){same=false;break;}
      for(index=0;same&&index<members.length;index++)same=known.members[index]===members[index];
      for(index=0;same&&index<known.bodies.length;index++)same=known.references[index]?.identity===known.bodies[index]?.entityId;
      if(same)return known;
    }
    const pool = actors instanceof Map ? [...actors.values()] : actors.slice(), lent=new Set(pool), own=new Map(members.map((member,slot)=>[member,slot] as const));
    if (members.some(member=>!lent.has(member))) throw new Error('Foreign herd guest actor');
    const bodies = [...members,...pool.filter(candidate => !own.has(candidate))];
    if (bodies.length > 1024 || new Set(bodies).size !== bodies.length || new Set(bodies.map(member => member.entityId)).size !== bodies.length) throw new Error('Ambiguous herd guest references');
    const references = bodies.map((member,index) => {
      const slot=own.get(member);
      return {group:slot===undefined?`${binding.group}:external`:binding.group,slot:slot??index,identity:member.entityId,wire:member.entityId,handle:index+1,body:member};
    });
    const loan={binding,pool,members:members.slice(),bodies,references,byBody:new Map(references.map(row=>[row.body,row])),byWire:new Map(references.map(row=>[row.wire,row]))};
    this.guestLoans[depth]=loan;return loan;
  }
  private runHerdGuest(signal: string, context?: GuardedHerdContext<A>, actor?: A, body = false,
    arguments_: Readonly<Record<string,number>> = {}): boolean {
    const binding = this.guest;
    if (binding === undefined) return false;
    if (binding.scope.disposed || binding.scope.disposing || binding.program.prepareGroup !== binding.prepare
      || binding.program.groupBindings !== binding.bindings) throw new Error('Replaced herd guest binding');
    const depth=this.guestDepth,previous=this.guestCall,{bodies,references,byBody,byWire}=this.herdGuestLoan(binding,depth);
    if (actor !== undefined && !byBody.has(actor)) throw new Error('Foreign herd guest actor');
    const slot = actor === undefined ? 0 : this.members.indexOf(actor);
    let buffer=this.guestBanks[depth];
    if(buffer===undefined||buffer.bodies!==bodies&&(buffer.bodies.length!==bodies.length||buffer.bodies.some((member,index)=>member!==bodies[index]))){
      const initial:Record<string,GroupBankValueV2>=Object.fromEntries(binding.shape.bank.map(row=>
        [row.name,row.kind==='boolean'?false:row.kind==='reference'?null:row.kind==='enum'?row.values[0]??'':0]));
      Object.assign(initial,this.captureHerdGuestState());
      buffer={bank:binding.codec.encode(initial,binding.group,references),values:initial,bodies};
      this.guestBanks[depth]=buffer;
    }
    const argumentHandle=actor===undefined?0:byBody.get(actor)?.handle;
    if(argumentHandle===undefined)throw new Error('Missing herd guest argument');
    const reset:Record<string,GroupBankValueV2>={slot:Math.max(0,slot),body};
    // These names belong to the admitted bank, not the changing world. Avoid
    // capturing every native scalar just to ask which temporary words reset.
    // Custom readers and mutable declarations retain their original live path.
    if(binding.resets!==undefined&&this.captureHerdGuestState===GrazerBrain.prototype.captureHerdGuestState
      &&this.herdGuestScalars===GrazerBrain.prototype.herdGuestScalars){
      for(const row of binding.resets)if(!Object.is(buffer.values[row.name],row.value))reset[row.name]=row.value;
    }else{
      const native=this.captureHerdGuestState();
      for(const row of binding.shape.bank)if(!Object.hasOwn(native,row.name)&&!row.name.startsWith('context.')&&row.name!=='slot'&&row.name!=='body'){
        const value=row.kind==='boolean'?false:row.kind==='reference'?null:row.kind==='enum'?row.values[0]??'':0;
        if(!Object.is(buffer.values[row.name],value))reset[row.name]=value;
      }
    }
    binding.codec.update(buffer.bank,reset,binding.group,references);
    const random=this.herdPorts.sharedRng();
    this.guestDepth=depth+1;
    this.guestCall={binding,context,signal,slot:Math.max(0,slot),bank:buffer.bank,values:buffer.values,references,bodies:byBody,wires:byWire,
      random,arguments:{...arguments_,'context.argHandle':argumentHandle},reply:0,replies:Object.fromEntries(binding.replyChannels.map(channel=>[channel,0])),fresh:true,members:[]};
    try{this.runGuest(binding.program);}
    finally{buffer.values=this.guestCall.values;this.guestCall=previous;this.guestDepth=depth;}
    return true;
  }
  protected override captureGuest(replies: readonly GroupStepNativeResultV2[], settled?: {readonly after:object;readonly touched:readonly number[]}): GroupGuestFrameV2<A> {
    const call = this.guestCall;
    if (call === undefined || call.binding !== this.guest) throw new Error('Missing herd guest call');
    const {binding,context,references} = call, player = context?.player ?? binding.player;
    if (binding.scope.disposed || binding.scope.disposing || binding.program.prepareGroup !== binding.prepare
      || binding.program.groupBindings !== binding.bindings) throw new Error('Replaced herd guest binding');
    for (const reply of replies) {
      if (!Object.hasOwn(call.replies, reply.channel)) throw new Error('Unknown herd guest result');
      call.replies[reply.channel] = reply.value;if (reply.channel === 'reply') call.reply = reply.value;
    }
    const bodies=call.bodies;
    for (let slot=0;slot<this.members.length;slot++) {
      const actor=this.members[slot];
      const reference = actor===undefined?undefined:bodies.get(actor);
      if (reference === undefined) throw new Error('Unknown appended herd member');
      if(reference.group!==binding.group)reference.group = binding.group;
      if(reference.slot!==slot)reference.slot = slot;
    }
    const retained = call.values, current = settled===undefined?this.captureHerdGuestState():retained;
    const target = (this.chargeTarget===null?undefined:bodies.get(this.chargeTarget)) ?? null;
    /** Handles are positions in this roster (see `herdGuestLoan`). */
    const atHandle=(handle:unknown)=>{const row=typeof handle==='number'?references[handle-1]:undefined;return row?.handle===handle?row:undefined;};
    const named = binding.referenceFields.map(([name,field]):[string,typeof references[number]|null]=>{
      const value=call.fresh?0:retained[field];if(value===null||value===0)return[name,null];
      const reference=typeof value==='number'?atHandle(value):typeof value==='string'?call.wires.get(value):undefined;
      if(reference===undefined)throw new Error('Unresolved herd guest capture reference');return[name,reference];
    });
    const threat = atHandle(call.reply) ?? null, spec = this.herdSpec;
    // Numeric marshalling belongs to this call only; every native read stays
    // fresh and ordered at its original continuation slot, including reentry.
    // A settled segment moved no player and no clock, so the marshalled numbers stand.
    const stands=settled!==undefined&&call.parameters!==undefined;
    const parameters=call.parameters??={...binding.rows.parameters,...call.arguments};
    if(!stands){
    parameters['context.walk']=spec.walkSpeed; parameters['context.trot']=spec.trotSpeed;
    parameters['context.gallop']=spec.gallopSpeed; parameters['context.charge']=spec.chargeSpeed;
    parameters['context.sight']=spec.sightRadius; parameters['context.grazingSight']=spec.grazingSightRadius;
    parameters['context.cone']=spec.coneAngle; parameters['context.alertThreshold']=spec.alertThreshold;
    parameters['context.flightMin']=spec.flightMinDistance; parameters['context.flightMax']=spec.flightMaxDistance;
    parameters['context.dt']=context?.dt ?? 0; parameters['context.time']=context?.t ?? 0;
    parameters['context.calm']=Number(context?.calm ?? false); parameters['context.playerSpeed']=context?.playerSpeed ?? 0;
    parameters['context.px']=player.x; parameters['context.py']=player.y;
    parameters['context.pz']=player.z;
    }
    const changes=call.changes??={};
    for(const name of Object.keys(changes))delete changes[name];
    // A settled segment wrote no scalar after its commit published `retained`, so there is nothing to diff.
    if(settled===undefined)for(const name of Object.keys(current)){const value=current[name];if(!Object.is(retained[name],value)){if(value===undefined)throw new Error('Missing herd guest capture value');changes[name]=value;}}
    for(const name of binding.contextFields){
      const value=parameters[name]??0;if(!Object.is(retained[name],value))changes[name]=value;
    }
    binding.codec.update(call.bank,changes,binding.group,references);
    const members=call.members,roster=this.members,count=roster.length;members.length=count;
    for(let slot=0;slot<count;slot++){
      const actor=roster[slot];if(actor===undefined)throw new Error('Missing herd member capture');
      const held=settled===undefined?undefined:members[slot];
      if(held!==undefined){
        // A settled segment moved no body and no role: this member's loans keep their keys, so only what a reply can repoint is set.
        for(let index=0;index<named.length;index++){const entry=named[index];if(entry===undefined)throw new Error('Missing herd capture reference');held.references.set(entry[0],entry[1]);}
        held.references.set('target',target);held.references.set('threat',threat);held.results.reply=call.reply;
        for(const channel of binding.replyChannels)if(channel!=='reply')held.results[channel]=call.replies[channel]??0;
        continue;
      }
      const member=members[slot]??={scope:binding.scope,self:{group:'',slot:0,identity:'',actor},player:{position:player},
        observed:new Map(),references:new Map(),results:{foal:0,mother:0,reply:0},t:0,dt:0};
      member.self.group=binding.group;member.self.slot=slot;member.self.identity=actor.entityId;member.self.actor=actor;
      member.player.position=player;member.observed.clear();member.t=context?.t??0;member.dt=context?.dt??0;
      if(context===undefined)delete member.context;else member.context=context;
      member.references.clear();
      for(let index=0;index<named.length;index++){
        const entry=named[index];if(entry===undefined)throw new Error('Missing herd capture reference');
        member.references.set(entry[0],entry[1]);
      }
      member.references.set('self',bodies.get(actor)??null);member.references.set('target',target);member.references.set('threat',threat);
      this.captureHerdGuestRoles(actor,member.results);member.results.reply=call.reply;
      for(const channel of binding.replyChannels)if(channel!=='reply')member.results[channel]=call.replies[channel]??0;
    }
    const selection=binding.rows.capture,slots=new Set<number>([0,call.slot]);
    if(call.signal==='tick'&&(retained[binding.rows.resume.field]===170||retained[binding.rows.resume.field]===171))for(let index=0;index<members.length;index++)slots.add(index);
    if(selection!==undefined){
      for(const name of selection.slots){const value=retained[name];if(typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<members.length)slots.add(value);}
      for(const name of selection.references){
        const value=Object.hasOwn(current,name)?current[name]:retained[name],ref=typeof value==='number'?atHandle(value):typeof value==='string'?call.wires.get(value):undefined;
        if(ref!==undefined&&ref.group===binding.group)slots.add(ref.slot);
      }
    }
    return {input:{group:binding.group,handle:binding.handle,profile:binding.rows.profile,signal:call.signal,tick:0,state:call.bank,members,references,
      random:call.random,...(selection===undefined?{}:{capture:{common:selection.common,slots:[...slots]}}),...(context === undefined ? {} : {contextRandom:context.rng}),...(settled===undefined?{}:{settled})},
      native:{scope:binding.scope,members,references,group:{kind:'herd',owner:this},ground:this.herdPorts,
        ...(this.herdPorts.grassHeightAt === undefined ? {} : {grass:{grassHeightAt:this.herdPorts.grassHeightAt}}),
        ...(context === undefined ? {} : {contexts:members.map(() => context)})},resume:binding.rows.resume};
  }
  protected override prepareGuestCommit(frame: GroupGuestFrameV2<A>,values: Readonly<Record<string,GroupBankValueV2>>): GroupGuestPublicationV2 {
    const call = this.guestCall;
    if (call === undefined || call.binding !== this.guest || frame.input.state !== call.bank || frame.input.references !== call.references)
      throw new Error('Foreign herd guest publication');
    // A settled segment that left every scalar and role where it found them has nothing to assign: the guest's own words
    // (its continuation and scratch) only have to reach the next segment, so the owner's fields are compared, not pinned.
    const held=frame.input.settled!==undefined&&herdGuestPublished.every(name=>Object.is(values[name],call.values[name]));
    const publication = held?{validate:():void=>undefined,commit:():void=>{
      const current=this.captureHerdGuestState();
      for(const name of herdGuestPublished)if(!Object.is(current[name],values[name]))throw new Error('Changed herd guest storage');
    }}:this.prepareHerdGuestState(values,call.references,call.binding.scope);
    const validate = (): void => {
      if (this.guestCall !== call || this.guest !== call.binding || call.binding.program.prepareGroup !== call.binding.prepare
        || call.binding.program.groupBindings !== call.binding.bindings) throw new Error('Replaced herd guest call');
      publication.validate();
    };
    return {validate,commit:() => {validate();publication.commit();call.values=values;call.fresh=false;

    }};
  }

  /** Perform only the shipping initial graze-timer draw, exactly once after complete controller preflight. */
  initialize(): void { this.requireHerd();
    if (this.initialized) throw new Error('Herd already initialized');
    if (this.runHerdGuest('initialize')) return;
    this.spotT = 20 + this.herdPorts.sharedRng().next() * 40; this.initialized = true;
  }

  /** Snapshot shared boids/taming timers and stable actor references; the world owner snapshots actors and RNG separately. */
  snapshotHerd(): string { this.requireHerd();
    const id = (actor: A | null): string | null => actor?.entityId ?? null;
    return JSON.stringify({ contract: this.contract, group: this.snapshotGroup(actor => actor.entityId), lead: id(this.lead),
      stallion: id(this.stallion), ridden: id(this.ridden), chargeTarget: id(this.chargeTarget), foals: this.foals.map(actor => actor.entityId),
      mothers: [...this.mothers].map(([foal, mother]) => [foal.entityId, mother.entityId]), state: {
  ...this.herdGuestScalars() } });
  }
  /** Read the original saved scalar fields without rebuilding its roster,
   * director books, JSON continuation or clock. The guest owns no second save. */
  protected herdGuestScalars(): v.InferOutput<typeof herdContinuation.entries.state> {
    return {
      initialized: this.initialized, mode: this.mode, stampeding: this.stampeding, stallionState: this.stallionState, trust: this.trust, alert: this.alert,
        alertOwned: this.alertOwned, cx: this.cx, cz: this.cz, spotX: this.spotX, spotZ: this.spotZ, spotT: this.spotT,
        fleeX: this.fleeX, fleeZ: this.fleeZ, fleeRun: this.fleeRun, fleeLen: this.fleeLen, fleeFromX: this.fleeFromX,
        fleeFromZ: this.fleeFromZ, modeT: this.modeT, sT: this.sT, chargeCd: this.chargeCd, beatenT: this.beatenT,
        beaten: this.beaten, knockCd: this.knockCd
    };
  }
  /** Capture only existing scalar/role owners; the returned data is per-call
   * scratch. It does not serialize or restore the group's director book. */
  protected captureHerdGuestState(): Readonly<Record<string, GroupBankValueV2>> {
    this.requireHerd();
    return { ...this.herdGuestScalars(), lead: this.lead?.entityId ?? null, stallion: this.stallion?.entityId ?? null,
      ridden: this.ridden?.entityId ?? null, chargeTarget: this.chargeTarget?.entityId ?? null,
      groupTimePresent: this.groupTime !== -Infinity, groupTime: this.groupTime === -Infinity ? 0 : this.groupTime };
  }
  /** The existing foal/mother identity map at this member's current slot. */
  protected captureHerdGuestRoles(actor: A, output?: {foal:number;mother:number}): { readonly foal: number; readonly mother: number } {
    this.requireHerd();
    const mother = this.mothers.get(actor), foal = Number(this.foals.includes(actor)), slot = mother === undefined ? -1 : this.members.indexOf(mother);
    const result=output??{foal:0,mother:0};result.foal=foal;result.mother=slot;return result;
  }
  /** Only parser input is reusable: the schema returns a detached scalar record.
   * Clear successful input; discard failures whose error may expose the record. */
  private readHerdGuestCandidate(entries:readonly [string,unknown][],values:Readonly<Record<string,GroupBankValueV2>>):v.InferOutput<typeof herdContinuation.entries.state>{
    const depth=this.guestCandidateDepth++;
    let slot=this.guestCandidates[depth],same=slot!==undefined&&slot.names.length===entries.length;
    if(slot!==undefined)for(let index=0;same&&index<entries.length;index++)same=slot.names[index]===entries[index]?.[0];
    if(!same||slot===undefined)this.guestCandidates[depth]=slot={names:entries.map(entry=>entry[0]),input:Object.fromEntries(entries)};
    const candidate=slot.input;let parsed=false;
    try{
      for(let index=0;index<entries.length;index++){
        const name=entries[index]?.[0];if(name===undefined)throw new Error('Missing herd scalar name');
        const value=values[name];
        if(name==='__proto__')Object.defineProperty(candidate,name,{value,writable:true,configurable:true,enumerable:true});
        else candidate[name]=value;
      }
      const next=readHerdScalars(candidate,entries)??v.parse(herdContinuation.entries.state,candidate);parsed=true;return next;
    }finally{
      if(parsed)for(let index=0;index<entries.length;index++){const name=entries[index]?.[0];if(name!==undefined)candidate[name]=undefined;}
      else this.guestCandidates[depth]=undefined; // A schema error may expose its input record; never recycle it.
      this.guestCandidateDepth=depth;
    }
  }
  /** Validate the complete guest scalar/role candidate before RNG acceptance.
   * Commit performs assignments only; notifications and body effects retain
   * their original native drain positions. Per-call scratch never enters save. */
  protected prepareHerdGuestState(values: Readonly<Record<string, GroupBankValueV2>>,
    references: readonly (GroupBankReferenceV2 & { readonly body: A })[], scope: Scope): GroupGuestPublicationV2 {
    this.requireHerd();
    if (scope.disposed || scope.disposing) throw new Error('Retired herd guest owner');
    const storage = herdGuestStorage.map(name => Object.getOwnPropertyDescriptor(this,name));
    for(let index=0;index<storage.length;index++){
      const descriptor=storage[index];
      if(descriptor===undefined||!Object.hasOwn(descriptor,'value')||descriptor.writable!==true)throw new Error('Invalid herd guest storage');
    }
    const entries: [string,unknown][] = Object.entries(this.herdGuestScalars()),roster=this.members,members=roster.slice();
    const beforeRoles = [this.lead,this.stallion,this.ridden,this.chargeTarget], beforeTime = this.groupTime;
    const source = references.map(row => ({ row, body: row.body, group: row.group, slot: row.slot,
      identity: row.identity, wire: row.wire, handle: row.handle }));
    const next=this.readHerdGuestCandidate(entries,values);
    const role = (name: string, own: boolean): A | null => {
      const wire = values[name];
      if (wire === null) return null;
      if (typeof wire !== 'string') throw new Error('Invalid herd guest role');
      const reference = source.find(row => row.wire === wire);
      if (reference === undefined || reference.body.entityId !== reference.identity
        || own && !members.includes(reference.body)) throw new Error('Foreign herd guest role');
      return reference.body;
    };
    const lead = role('lead',true), stallion = role('stallion',true), ridden = role('ridden',true), target = role('chargeTarget',false);
    const present = v.parse(v.boolean(),values['groupTimePresent']), time = v.parse(herdFinite,values['groupTime']);
    if (!present && !Object.is(time,0)) throw new Error('Nonzero absent herd clock');
    let accepted = false;
    const validate = (): void => {
      // These pins cover every scalar as well as roles/time; no second snapshot is needed.
      for(let index=0;index<storage.length;index++){
        const name=herdGuestStorage[index],descriptor=storage[index];
        const current=name===undefined?undefined:Object.getOwnPropertyDescriptor(this,name);
        if(current===undefined||descriptor===undefined||!Object.hasOwn(current,'value')||current.writable!==true||!Object.is(current.value,descriptor.value))throw new Error('Changed herd guest storage');
      }
      if(accepted||scope.disposed||scope.disposing||this.members!==roster||members.length!==roster.length)throw new Error('Changed herd guest publication owner');
      for(let index=0;index<members.length;index++)if(index in members){
        const body=members[index];if(roster[index]!==body)throw new Error('Changed herd guest publication owner');
      }
      if(!Object.is(this.groupTime,beforeTime))throw new Error('Changed herd guest publication owner');
      // Read the whole role batch before comparing, as the original array did.
      const currentLead=this.lead,currentStallion=this.stallion,currentRidden=this.ridden,currentTarget=this.chargeTarget;
      if(currentLead!==beforeRoles[0]||currentStallion!==beforeRoles[1]||currentRidden!==beforeRoles[2]||currentTarget!==beforeRoles[3]
        ||references.length!==source.length)throw new Error('Changed herd guest publication owner');
      for(let index=0;index<source.length;index++){
        const pin=source[index];
        if(pin!==undefined&&(references[index]!==pin.row||pin.row.body!==pin.body
          ||pin.row.group!==pin.group||pin.row.slot!==pin.slot||pin.row.identity!==pin.identity||pin.row.wire!==pin.wire||pin.row.handle!==pin.handle
          ||pin.body.entityId!==pin.identity))throw new Error('Changed herd guest publication owner');
      }
    };
    return { validate, commit: () => {
      validate();accepted = true;Object.assign(this,next);
      this.lead = lead;this.stallion = stallion;this.ridden = ridden;this.chargeTarget = target;
      this.groupTime = present ? time : -Infinity;
    } };
  }

  /** Preflight tuning, roster, mothers and external threats before restoring; no body, taming callback or RNG executes. */
  private restoreHerd(saved: string): void {
    const data = v.parse(herdContinuation, JSON.parse(saved));
    if (data.contract !== this.contract) throw new Error('Incompatible herd continuation');
    const member = (id: string | null): A | null => {
      if (id === null) return null;
      const actor = this.members.find(value => value.entityId === id);
      if (actor === undefined) throw new Error('Unresolved herd member'); return actor;
    };
    const lead = member(data.lead), stallion = member(data.stallion), ridden = member(data.ridden);
    const foals = data.foals.map(id => member(id)), mothers = new Map<A, A>();
    if (new Set(data.foals).size !== data.foals.length || data.mothers.length > foals.length) throw new Error('Invalid herd roles');
    for (const [foalId, motherId] of data.mothers) {
      const foal = member(foalId), mother = member(motherId);
      if (foal === null || mother === null || !foals.includes(foal) || foals.includes(mother) || mothers.has(foal)
        || [...mothers.values()].includes(mother)) throw new Error('Invalid herd mothers'); mothers.set(foal, mother);
    }
    const chargeTarget = data.chargeTarget === null ? null : this.members.find(actor => actor.entityId === data.chargeTarget) ?? this.herdPorts.resolveActor?.(data.chargeTarget);
    if (chargeTarget === undefined || (data.chargeTarget !== null && (chargeTarget === null || chargeTarget.entityId !== data.chargeTarget))) throw new Error('Unresolved herd threat');
    this.restoreGroup(data.group, actor => actor.entityId);
    this.lead = lead; this.stallion = stallion; this.ridden = ridden; this.chargeTarget = chargeTarget;
    this.foals.length = 0; for (const foal of foals) if (foal !== null) this.foals.push(foal);
    this.mothers = mothers; Object.assign(this, data.state);this.guestPlans.clear();
  }

  /** B7: this horse is being ridden — the herd lets go of it (null hands it back) */
  setRidden(a: A | null): void { this.requireHerd();
    if (this.runHerdGuest('setRidden',undefined,a??undefined)) return;
    if (this.ridden !== null) this.ridden.mem['ridden'] = 0;
    this.ridden = a;
    if (a !== null) { a.mem['ridden'] = 1; if (a === this.stallion) this.setStallion('ridden'); }
    else if (this.stallionState === 'ridden') this.setStallion('watch');
  }
  addTrust(n: number): void { this.requireHerd(); if (this.runHerdGuest('addTrust',undefined,undefined,false,{'context.argument':n})) return; this.trust = MathUtils.clamp(this.trust + n, 0, 100); }

  /** a shot / a loud thing landed at (x, z): within 15 m of a horse → stampede, within 40 m → heads up */
  disturb(x: number, z: number): void { this.requireHerd();
    if (this.runHerdGuest('disturb',undefined,undefined,false,{'context.argX':x,'context.argZ':z})) return;
    let near = Infinity;
    for (const h of this.members) if (h.alive) near = Math.min(near, Math.hypot(h.position.x - x, h.position.z - z));
    if (near < 15) this.stampede(x, z);
    else if (near < 40) for (const h of this.members) h.mem['aw'] = Math.max(h.mem['aw'] ?? 0, this.herdSpec.alertThreshold);
  }

  /** the flight becomes a stampede, away from (x, z) */
  stampede(x: number, z: number): void { this.requireHerd(); if (this.runHerdGuest('stampede',undefined,undefined,false,{'context.argX':x,'context.argZ':z})) return; this.startFlight(x, z, true); }
  /** Original guard identity and state borrowed by native and entered elites. */
  get leaderState(): GuardedStallionState { return this.stallionState; }
  get leader(): A | null { return this.stallion; }

  /** the stallion leads the herd away from (x, z) at a gallop (taming: ALERT maxed with some trust) — not a stampede */
  leadAway(x: number, z: number): void { this.requireHerd(); if (this.runHerdGuest('leadAway',undefined,undefined,false,{'context.argX':x,'context.argZ':z})) return; this.startFlight(x, z, false); }
  /** the stallion leaves the herd for good (tamed): the herd grazes on without a guard */
  /** a stallion of another kind joins this herd as its stallion (the elite Argymaq, src/shards/nalati-grasslands/combat/elites.ts). Without the
   *  registration his brain (thinkHorse → forThink) found no herd and built a fresh one every tick — he was never BEATEN
   *  and the mares were re-homed into throwaway herds (GrazerBrain<A>.all grew at 10 Hz) */
  adoptStallion(a: A): void { this.requireHerd(); if (this.runHerdGuest('adopt',undefined,a)) return; if (!this.members.includes(a)) this.members.push(a); this.stallion = a; this.setStallion('watch'); }
  releaseStallion(): void {
    this.requireHerd();
    const tamed = this.stallion;
    if (tamed !== null) this.onTamed?.(tamed, this.cx, this.cz); // J108: its herd will have a new one, later
    if (this.runHerdGuest('release')) return;
    if (this.stallion !== null) { this.stallion.mem['ridden'] = 1; this.stallion = null; }
    this.alertOwned = false;
  }
  /** A stallion left this herd for good (J108); the group's owner tells the population. */
  onTamed: ((a: A, x: number, z: number) => void) | null = null;

  private centre(): void {
    let x = 0, z = 0, n = 0;
    for (const h of this.members) if (h.alive && h !== this.stallion && h !== this.ridden) { x += h.position.x; z += h.position.z; n++; }
    if (n > 0) { this.cx = x / n; this.cz = z / n; }
  }

  private setStallion(s: GuardedStallionState): void {
    if (s === this.stallionState) return;
    this.stallionState = s; this.sT = 0;
    this.onStallionState?.(s, this);
    if (s === 'display' && this.stallion !== null) this.herdPorts.onEvent?.('stallion-display', this.stallion.position.x, this.stallion.position.z);
  }

  private startFlight(fromX: number, fromZ: number, stampede: boolean): void {
    if (this.mode === 'flee' && (!stampede || this.stampeding)) return;
    let dx = this.cx - fromX, dz = this.cz - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    this.fleeX = dx; this.fleeZ = dz; this.fleeFromX = fromX; this.fleeFromZ = fromZ;
    this.fleeRun = 0; this.fleeLen = this.herdSpec.flightMinDistance + this.herdPorts.sharedRng().next() * (this.herdSpec.flightMaxDistance - this.herdSpec.flightMinDistance);
    this.mode = 'flee'; this.modeT = 0; this.stampeding = stampede;
    this.trust = Math.max(0, this.trust - 30);
    for (const h of this.members) { h.mem['hitP'] = 0; h.mem['aw'] = 1; }
    if (this.stallionState !== 'beaten' && this.stallionState !== 'ridden') this.setStallion('lead');
    this.onFlight?.(stampede, this);
    if (stampede) this.herdPorts.onEvent?.('stampede', this.cx, this.cz);
  }

  /** the herd-level tick: senses, alarms, mode changes (once per AI tick) */
  tick(c: GuardedHerdContext<A>): void {
    try{ this.requireHerd();
    if (!this.initialized) throw new Error('Herd is not initialized');
    if(this.guest!==undefined&&Math.abs(c.t-this.groupTime)<1e-8){this.validateHerdGuest();return;}
    if (this.runHerdGuest('tick',c)) return;
    const dt = this.groupDelta(c.t, c.dt);
    if (dt <= 0) return;
    this.modeT += dt; this.sT += dt; this.chargeCd = Math.max(0, this.chargeCd - dt); this.knockCd = Math.max(0, this.knockCd - dt);
    const prevX = this.cx, prevZ = this.cz;
    this.centre();
    const moved = Math.hypot(this.cx - prevX, this.cz - prevZ);
    const player = c.player;
    const dCentre = Math.hypot(player.x - this.cx, player.z - this.cz);

    // ── senses ──
    let maxAw = 0, bolt = false;
    for (const h of this.members) {
      if (!h.alive || h === this.ridden) continue;
      let aw = h.mem['aw'] ?? 0;
      if (h.lastHitT > (h.mem['hitT'] ?? -Infinity)) { h.mem['hitT'] = h.lastHitT; this.startFlight(player.x, player.z, true); aw = 1; }
      let rate = 0;
      if (!c.calm) {
        const dx = player.x - h.position.x, dz = player.z - h.position.z, d = Math.hypot(dx, dz);
        const V = this.herdPorts.visibility(h.position.x, h.position.z, player, c.playerSpeed, c.t);
        const sight = (h.state === 'graze' ? this.herdSpec.grazingSightRadius : this.herdSpec.sightRadius) * V;
        if (d < sight && Math.abs(angDiff(Math.atan2(dx, dz), h.yaw)) < this.herdSpec.coneAngle) rate = Math.max(rate, 0.4 * (2 - d / sight));
        const hear = this.herdPorts.hearing(this.herdSpec.hearing, player, c.playerSpeed);
        if (d < hear) rate = Math.max(rate, 0.5 * (2 - d / hear));
        if (h === this.stallion && d < 40 && this.herdPorts.downwind(h.position.x, h.position.z, player)) rate = Math.max(rate, 0.3 * (2 - d / 40));
        // a rider galloping into the herd: stampede
        if (this.herdPorts.environment().playerMounted && c.playerSpeed > 10 && d < 8) this.startFlight(player.x, player.z, true);
        // trust calms them: at 60+ they tolerate you close, at 100 they barely care
        rate *= 1 - this.trust / 125;
        if (d < 10 && this.trust < 60 && h !== this.stallion && c.playerSpeed > 0.5) bolt = true;
      }
      aw = rate > 0 ? Math.min(1, aw + rate * dt) : Math.max(0, aw - 0.12 * dt);
      // the alarm spreads: a head up nudges the neighbours within 20 m after 0.2–0.8 s
      if (aw >= this.herdSpec.alertThreshold && (h.mem['alarm'] ?? 0) === 0) {
        h.mem['alarm'] = 1;
        for (const o of this.members) if (o !== h && o.alive && o.position.distanceTo(h.position) < 20) o.mem['alarmT'] = Math.max(o.mem['alarmT'] ?? 0, 0.2 + this.herdPorts.sharedRng().next() * 0.6);
      }
      if (aw < this.herdSpec.alertThreshold * 0.5) h.mem['alarm'] = 0;
      const at = h.mem['alarmT'] ?? 0;
      if (at > 0) { h.mem['alarmT'] = at - dt; if (at - dt <= 0) aw = Math.max(aw, this.herdSpec.alertThreshold); }
      h.mem['aw'] = aw;
      if (h !== this.stallion) maxAw = Math.max(maxAw, aw);
      if (aw >= 1 && h !== this.stallion) bolt = true;
    }
    // the stallion's ALERT (0..100): his senses, pushed up by his warnings
    const st = this.stallion;
    if (st?.alive === true && !this.alertOwned) {
      const base = (st.mem['aw'] ?? 0) * 70 + (this.stallionState === 'warn' ? 20 : this.stallionState === 'display' || this.stallionState === 'charge' ? 30 : 0);
      this.alert += (MathUtils.clamp(base, 0, 100) - this.alert) * Math.min(1, dt * 2);
    }

    // ── wolves ──
    const threat = this.findThreat?.(this.cx, this.cz, 45) ?? null;
    if (threat !== null) {
      const wd = Math.hypot(threat.position.x - this.cx, threat.position.z - this.cz);
      if (wd < 25 && this.mode !== 'flee') this.startFlight(threat.position.x, threat.position.z, false);
      // the stallion goes for a threat near a foal (or himself)
      if (st !== null && st.alive && this.stallionState !== 'beaten' && this.stallionState !== 'ridden' && this.stallionState !== 'charge') {
        let threatened = false;
        for (const f of this.foals) if (f.alive && f.position.distanceTo(threat.position) < 15) threatened = true;
        if (threatened || st.position.distanceTo(threat.position) < 8) { this.chargeTarget = threat; this.setStallion('charge'); }
      }
    }

    // ── modes ──
    switch (this.mode) {
      case 'graze': case 'drift': {
        if (bolt) { this.startFlight(player.x, player.z, false); break; }
        if (maxAw >= this.herdSpec.alertThreshold) { this.mode = 'alert'; this.modeT = 0; break; }
        this.spotT -= dt;
        if (this.spotT <= 0) this.pickSpot(c);
        const lead = this.lead;
        if (lead?.alive === true) this.mode = Math.hypot(this.spotX - lead.position.x, this.spotZ - lead.position.z) > 6 ? 'drift' : 'graze';
        break;
      }
      case 'alert':
        if (bolt) { this.startFlight(player.x, player.z, false); break; }
        if (maxAw < this.herdSpec.alertThreshold * 0.6 && this.modeT > 3) { this.mode = 'graze'; this.modeT = 0; }
        break;
      case 'flee': {
        this.fleeRun += moved;
        // bend off the slab edge / steep ground: look 30 m ahead of the herd
        for (let k = 0; k < 6; k++) {
          const ax = this.cx + this.fleeX * 30, az = this.cz + this.fleeZ * 30;
          if (this.herdPorts.inBounds(ax, az, 28) && this.herdPorts.normalY(ax, az) > 0.72) break;
          // turn toward the side that swings us toward the chunk centre
          const toC = Math.atan2(-this.cx, -this.cz), cur = Math.atan2(this.fleeX, this.fleeZ);
          const nu = cur + Math.sign(angDiff(toC, cur) || 1) * 0.35;
          this.fleeX = Math.sin(nu); this.fleeZ = Math.cos(nu);
        }
        if (this.fleeRun > this.fleeLen || this.modeT > 16) { this.mode = 'settle'; this.modeT = 0; this.stampeding = false; }
        break;
      }
      case 'settle':
        if (this.modeT > 7) {
          this.mode = 'graze'; this.modeT = 0; this.pickSpot(c);
          for (const h of this.members) h.mem['aw'] = Math.min(h.mem['aw'] ?? 0, 0.2);
          if (this.stallionState === 'lead') this.setStallion('watch');
        }
        break;
      // no default
    }
    // stallion state machine (distance to the player, standing / crouched, trust)
    if (st?.alive === true) this.stallionTick(c, dt, dCentre);
    }catch(error){if(this.guest===undefined)throw error;this.skipGuestFrame(error);}
  }

  private pickSpot(c: GuardedHerdContext<A>): void {
    const lead = this.lead ?? this.members[0];
    if (lead === undefined) return;
    for (let i = 0; i < 16; i++) {
      const ang = c.rng.range(0, Math.PI * 2), r = c.rng.range(30, 60);
      const x = lead.position.x + Math.cos(ang) * r, z = lead.position.z + Math.sin(ang) * r;
      if (!this.herdPorts.inBounds(x, z, 35) || this.herdPorts.normalY(x, z) < 0.85) continue;
      if (Math.hypot(x - c.player.x, z - c.player.z) < 40) continue;
      this.spotX = x; this.spotZ = z; break;
    }
    this.spotT = c.rng.range(60, 120);
  }

  private stallionTick(c: GuardedHerdContext<A>, dt: number, _dCentre: number): void {
    const st = this.stallion;
    if (st === null) return;
    if (this.stallionState === 'ridden') return;
    if (this.stallionState === 'charge' && this.sT > 4.5) { this.chargeCd = 5; this.chargeTarget = null; this.setStallion('wheel'); }
    // beaten: under 25 % hp he stops fighting
    if (!this.beaten && st.hp < st.maxHp * 0.25) {
      this.beaten = true; this.beatenT = 90; this.setStallion('beaten');
      this.onBeaten?.(st, this);
      this.herdPorts.onEvent?.('stallion-beaten', st.position.x, st.position.z);
    }
    if (this.stallionState === 'beaten') {
      this.beatenT -= dt;
      if (this.beatenT <= 0) { this.beaten = false; st.hp = Math.max(st.hp, st.maxHp * 0.3); this.setStallion('watch'); }
      return;
    }
    if (this.mode === 'flee') { if (this.stallionState !== 'charge') this.setStallion('lead'); return; }
    const d = st.position.distanceTo(c.player);
    const standing = !this.herdPorts.environment().playerCrouched;
    switch (this.stallionState) {
      case 'watch': case 'lead':
        if (d < 30 && (st.mem['aw'] ?? 0) > 0.25) this.setStallion('warn');
        else if (this.stallionState === 'lead') this.setStallion('watch');
        break;
      case 'warn':
        if (d > 36) { this.setStallion('watch'); break; }
        if (d < 20 && standing && this.sT > 1.2) this.setStallion('display');
        break;
      case 'display':
        if (this.sT > 2.2) {
          if (d < 10 && this.trust < 20 && this.chargeCd <= 0) { this.chargeTarget = null; this.setStallion('charge'); }
          else if (d < 20 && this.trust >= 20) this.startFlight(c.player.x, c.player.z, false);   // he leads them away
          else this.setStallion(d < 30 ? 'warn' : 'watch');
        }
        break;
      case 'charge': break;
      case 'wheel':
        if (this.sT > 2.2) this.setStallion('watch');
        break;
      default: break;
    }
  }

  /** Preflight one complete fixed locomotion output on this SAME native owner.
   * The group dispatcher assembles all eight parts before any plan publishes. */
  prepareDrivePlan(actor:A,input:readonly number[]):{validate:()=>void;accept:()=>void} {
    this.validateHerdGuest();
    const binding=this.guest,roster=this.members,slot=roster.indexOf(actor);
    if(binding?.rows.plans!==true||slot=== -1||input.length!==24||input.some(value=>!Number.isFinite(value)))throw new Error('Invalid herd locomotion output');
    const values=Object.freeze(input.slice());
    for(const[index,min,max]of [[0,0,5],[1,0,4],[11,0,2],[15,0,1023],[16,0,255],[23,-1,2]]){
      if(index===undefined||min===undefined||max===undefined)throw new Error('Invalid locomotion bounds');
      const value=values[index];if(value===undefined||!Number.isInteger(value)||value<min||value>max)throw new Error('Invalid herd locomotion flags');
    }
    if(((values[15]??0)&~895)!==0||(values[3]??-1)<0||(values[4]??-1)<0||(values[7]??-1)<0
      ||(values[14]??-2)< -1||(values[14]??2)>1)throw new Error('Invalid herd locomotion tuning');
    let used=false;
    const validate=():void=>{this.validateHerdGuest();if(used||this.guest!==binding||this.members!==roster||roster[slot]!==actor)throw new Error('Changed herd locomotion owner');};
    validate();return{validate,accept:()=>{validate();used=true;this.guestPlans.set(actor,{values,applied:false});}};
  }

  /** Consume one group's committed plan at the original member/body slot.
   * Planning is amortized across the roster; pathing, motion and contacts still
   * use this call's actual native services. Plans never enter the save wire. */
  private applyHerdGuestDrive(a:A,c:GuardedHerdContext<A>):boolean {
    const binding=this.guest,plan=this.guestPlans.get(a);
    if(binding===undefined||plan===undefined)return false;
    const read=(name:typeof HERD_DRIVE_PLAN_FIELDS[number]):number=>{
      const value=plan.values[HERD_DRIVE_PLAN_FIELDS.indexOf(name)];
      if(value===undefined)throw new Error('Missing herd drive plan value');return value;
    };
    const kind=read('kind'),flags=read('flags'),mask=read('memoryMask'),state=read('state'),look=read('lookKind'),sound=read('sound');
    if(!Number.isInteger(kind)||kind<0||kind>5||!Number.isInteger(flags)||flags<0||flags>1023
      ||!Number.isInteger(mask)||mask<0||mask>255||!Number.isInteger(state)||state<0||state>4
      ||!Number.isInteger(look)||look<0||look>2||!Number.isInteger(sound)||sound< -1||sound>2)
      throw new Error('Invalid herd drive plan flags');
    for(const name of HERD_DRIVE_PLAN_FIELDS)read(name);
    const mem=a.mem,position=a.position,steer=c.steer,path=c.pathYaw,confine=c.confine,soundCall=c.sound,player=c.player;
    const motion:unknown=Reflect.get(a,'setMotion');
    const ports=this.herdPorts,environment=ports.environment,pass=ports.passThrough;
    if([motion,steer,path,confine,environment,pass,c.sound].some(value=>typeof value!=='function'))throw new Error('Missing herd drive authority');
    const live=():void=>{this.validateHerdGuest();if(this.guest!==binding||a.mem!==mem||a.position!==position||a.setMotion!==motion
      ||c.steer!==steer||c.pathYaw!==path||c.confine!==confine||c.sound!==soundCall||c.player!==player||this.herdPorts!==ports||ports.environment!==environment||ports.passThrough!==pass
      ||!this.members.includes(a))throw new Error('Changed herd drive authority');};
    live();
    // Charge/contact is a body-rate native barrier, never a future tick target.
    const committed=a===this.stallion&&this.stallionState==='charge';
    const through=!environment.call(ports).playerMounted&&((this.stampeding&&this.mode==='flee')||committed);live();
    pass.call(ports,a,through);live();
    if(committed){this.driveStallion(a,c);live();confine.call(c,a);return true;}
    if(kind===0)return true;
    // Taming may have changed ownership while the original environment/pass
    // service ran. Never let a cached plan take a mounted actor back.
    if(a===this.ridden||(mem['ridden']??0)===1)return true;
    if((flags&16)!==0&&this.stampeding&&a.speed>6){this.trample(a,c);live();}
    const first=!plan.applied;plan.applied=true;
    if(first&&(mask&1)!==0)mem['gt']=read('gt');
    if(first&&(mask&2)!==0)mem['gyaw']=read('gyaw');
    if(first&&(mask&4)!==0)mem['gs']=read('gs');
    if((flags&512)!==0){mem['headUp']=read('headUp');mem['pin']=0;mem['rear']=0;a.lookTarget.copy(c.player);a.lookWeight=0;}
    if((flags&6)===0){if((mask&64)!==0)mem['pin']=read('pin');if((mask&128)!==0)mem['rear']=read('rear');}
    if(look===1)a.lookTarget.copy(c.player);else if(look===2)a.lookTarget.set(read('lookX'),a.position.y,read('lookZ'));
    if(read('lookWeight')>=0)a.lookWeight=read('lookWeight');
    const states=['graze','wander','alert','flee','charge'] as const,next=states[state];
    if(next===undefined)throw new Error('Unknown herd drive state');a.state=next;
    let yaw=read('yaw');
    if(kind===3||kind===4){
      yaw=path.call(c,a,read('targetX'),read('targetZ'),read('pathEvery'));live();
      if(kind===3)yaw=Math.atan2(Math.sin(yaw)+read('blendX'),Math.cos(yaw)+read('blendZ'));
    }
    const speed=read('speed')*((flags&64)!==0?a.mods.speed:1);
    if(kind===1)a.setMotion(yaw,speed,read('turn'));
    else steer.call(c,a,yaw,speed,read('turn'));
    live();
    if((flags&32)!==0&&this.stampeding&&a.speed>6){this.trample(a,c);live();}
    if((flags&6)!==0){if((mask&64)!==0)mem['pin']=read('pin');if((mask&128)!==0)mem['rear']=read('rear');}
    if(first&&(mask&8)!==0)mem['snT']=read('snT');
    if(first&&(mask&16)!==0)mem['stamp']=1;if(first&&(mask&32)!==0)mem['toss']=1;
    if(first&&sound>=0){const cues=[this.herdSpec.snortCue,this.herdSpec.neighCue,this.herdSpec.squealCue],cue=cues[sound];
      if(cue===undefined)throw new Error('Unknown herd drive cue');c.sound(cue);live();}
    if((flags&1)!==0){
      if(kind===1&&this.mode==='graze')a.lookWeight=(mem['aw']??0)>.15?.6:0;
      if((this.mode==='graze'||this.mode==='drift')&&(mem['aw']??0)>.2){a.lookTarget.copy(c.player);a.lookWeight=.7;}
    }
    if((flags&8)!==0)mem['toss']=0;
    mem['headUp']=read('headUp');confine.call(c,a);live();return true;
  }

  /** steer one horse for this tick (after `tick`) */
  drive(a: A, c: GuardedHerdContext<A>, body = false): void {
    try{ this.requireHerd();
    if (!this.initialized) throw new Error('Herd is not initialized');
    if(this.guest!==undefined){
      this.validateHerdGuest();
      const committed=a===this.stallion&&this.stallionState==='charge';
      if(body!==committed||a===this.ridden||(a.mem['ridden']??0)===1)return;
    }
    if(this.guest?.rows.plans!==undefined){if(this.applyHerdGuestDrive(a,c))return;}
    else if (this.runHerdGuest('drive',c,a,body)) return;
    const m = a.mem;
    const committed = a === this.stallion && this.stallionState === 'charge';
    if (body !== committed) return;
    if (a === this.ridden || (m['ridden'] ?? 0) === 1) return;
    // R3 (D8 (c)): a stampede — and the stallion's charge — runs THROUGH a player on foot (the knock-down in `trample` /
    // the charge is the hit, not a pile-up against his capsule), but a rider's horse is a body it collides with (Mount
    // jostles the rider, or throws him at a gallop)
    const through = !this.herdPorts.environment().playerMounted && ((this.stampeding && this.mode === 'flee') || (a === this.stallion && this.stallionState === 'charge'));
    this.herdPorts.passThrough(a, through);
    if (a === this.stallion) { this.driveStallion(a, c); c.confine(a); return; }
    const foal = this.foals.includes(a);
    const mother = this.mothers.get(a);
    let vx = 0, vz = 0, speed = 0;
    let headUp = 0;
    const px = a.position.x, pz = a.position.z;
    // boids terms
    let sepX = 0, sepZ = 0, aliX = 0, aliZ = 0, nAli = 0;
    for (const o of this.members) {
      if (o === a || !o.alive || o === this.ridden) continue;
      const ox = px - o.position.x, oz = pz - o.position.z, d = Math.hypot(ox, oz);
      if (d < 2.5 && d > 1e-3) { const f = (2.5 - d) / 2.5; sepX += (ox / d) * f; sepZ += (oz / d) * f; }
      if (d < 8 && o.speed > 0.5) { aliX += Math.sin(o.yaw); aliZ += Math.cos(o.yaw); nAli++; }
    }
    const cdx = this.cx - px, cdz = this.cz - pz, cd = Math.hypot(cdx, cdz);
    const coh = cd > 12 ? Math.min(1, (cd - 12) / 10) : 0;
    switch (this.mode) {
      case 'graze': case 'drift': {
        // a foal sticks to its mother
        if (foal && mother?.alive === true) {
          const md = a.position.distanceTo(mother.position);
          if (md > 4) { vx = mother.position.x - px; vz = mother.position.z - pz; speed = md > 10 ? this.herdSpec.trotSpeed : this.herdSpec.walkSpeed * 1.1; break; }
        }
        if (this.mode === 'drift') {
          const lead = this.lead;
          let tx = this.spotX, tz = this.spotZ;
          if (a !== lead && lead?.alive === true) { tx = lead.position.x - Math.sin(lead.yaw) * 4; tz = lead.position.z - Math.cos(lead.yaw) * 4; }
          const td = Math.hypot(tx - px, tz - pz);
          if (a === lead || td > 6 || coh > 0) { const y = td > 8 ? c.pathYaw(a, tx, tz, 2) : Math.atan2(tx - px, tz - pz); vx = Math.sin(y) + sepX * 1.5 + (nAli > 0 ? aliX / nAli * 0.4 : 0); vz = Math.cos(y) + sepZ * 1.5 + (nAli > 0 ? aliZ / nAli * 0.4 : 0); speed = td > 30 ? this.herdSpec.trotSpeed * 0.8 : this.herdSpec.walkSpeed; }
          break;
        }
        // grazing: stand and eat, with the odd step; drift back if too far from the herd, step away if crowded
        m['gt'] = (m['gt'] ?? this.herdPorts.sharedRng().next() * 6) - c.dt;
        if (coh > 0) { vx = cdx / cd; vz = cdz / cd; speed = this.herdSpec.walkSpeed * (0.6 + coh * 0.6); break; }
        if (Math.hypot(sepX, sepZ) > 0.35) { vx = sepX; vz = sepZ; speed = 0.8; break; }
        if ((m['gt'] ?? 0) <= 0) { m['gt'] = 4 + this.herdPorts.sharedRng().next() * 10; m['gyaw'] = a.yaw + (this.herdPorts.sharedRng().next() - 0.5) * 2; m['gs'] = 1.2 + this.herdPorts.sharedRng().next() * 1.5; }
        if ((m['gs'] ?? 0) > 0) { m['gs'] = (m['gs'] ?? 0) - c.dt; vx = Math.sin(m['gyaw'] ?? a.yaw); vz = Math.cos(m['gyaw'] ?? a.yaw); speed = 0.7; }
        break;
      }
      case 'alert':
        headUp = 1;
        a.lookTarget.copy(c.player); a.lookWeight = 1;
        if (foal && mother !== undefined && mother.alive && a.position.distanceTo(mother.position) > 2.5) { vx = mother.position.x - px; vz = mother.position.z - pz; speed = this.herdSpec.trotSpeed * 0.7; }
        break;
      case 'flee': {
        vx = this.fleeX + sepX * 0.8 + cdx / (cd || 1) * coh * 0.6;
        vz = this.fleeZ + sepZ * 0.8 + cdz / (cd || 1) * coh * 0.6;
        const k = this.stampeding ? 1.04 : 0.96;
        speed = this.herdSpec.gallopSpeed * k * (0.96 + 0.08 * ((a.seed * 13) % 1)) * (foal ? 0.85 : 1);
        if (this.fleeRun > this.fleeLen - 20) speed = this.herdSpec.trotSpeed * 1.3;
        headUp = 0.3;
        // the stampede runs things down
        if (this.stampeding && a.speed > 6) this.trample(a, c);
        break;
      }
      case 'settle':
        headUp = 1;
        if (this.modeT < 2.5) { vx = this.fleeX; vz = this.fleeZ; speed = this.herdSpec.trotSpeed * (1 - this.modeT / 3); }
        a.lookTarget.set(this.fleeFromX, a.position.y, this.fleeFromZ); a.lookWeight = 1;
        break;
      // no default
    }
    if (speed > 0.05 && Math.hypot(vx, vz) > 1e-3) {
      a.state = this.mode === 'flee' ? 'flee' : 'wander';
      c.steer(a, Math.atan2(vx, vz), speed * a.mods.speed, this.mode === 'flee' ? 3 : 1.6);
    } else {
      a.state = this.mode === 'graze' ? 'graze' : 'alert';
      a.setMotion(a.yaw, 0, 1.5);
      if (this.mode === 'graze') a.lookWeight = (m['aw'] ?? 0) > 0.15 ? 0.6 : 0;
    }
    if ((this.mode === 'graze' || this.mode === 'drift') && (m['aw'] ?? 0) > 0.2) { a.lookTarget.copy(c.player); a.lookWeight = 0.7; }
    m['headUp'] = headUp;
    c.confine(a);
    }catch(error){if(this.guest===undefined)throw error;this.skipGuestFrame(error);}
  }

  private driveStallion(a: A, c: GuardedHerdContext<A>): void {
    const m = a.mem;
    const player = c.player;
    const toP = Math.atan2(player.x - a.position.x, player.z - a.position.z);
    m['headUp'] = 0; m['pin'] = 0; m['rear'] = 0;
    a.lookTarget.copy(player); a.lookWeight = 0;
    switch (this.stallionState) {
      case 'watch': case 'warn': {
        // the guard point: between the herd and you, 6–10 m out from the herd centre, inside its cover (QB19)
        const tx0 = player.x - this.cx, tz0 = player.z - this.cz, td0 = Math.hypot(tx0, tz0) || 1;
        const out = MathUtils.clamp(td0 * 0.3, 6, 10);
        const gx = this.cx + (tx0 / td0) * out, gz = this.cz + (tz0 / td0) * out;
        const gd = Math.hypot(gx - a.position.x, gz - a.position.z);
        m['headUp'] = 1; a.lookWeight = 1;
        if (gd > 3) { a.state = 'wander'; c.steer(a, c.pathYaw(a, gx, gz, 1.5), gd > 15 ? this.herdSpec.trotSpeed : this.herdSpec.walkSpeed, 1.8); }
        else { a.state = 'alert'; a.setMotion(toP, 0, 1.2); }
        if (this.stallionState === 'warn') {
          m['pin'] = 0.6;
          // a snort and a stamp every 2–4 s
          m['snT'] = (m['snT'] ?? 0) - c.dt;
          if ((m['snT'] ?? 0) <= 0) { m['snT'] = 2 + this.herdPorts.sharedRng().next() * 2; m['stamp'] = 1; m['toss'] = 1; c.sound(this.herdSpec.snortCue); }
        }
        break;
      }
      case 'display':
        a.state = 'alert'; a.setMotion(toP, 0, 3);
        m['rear'] = this.sT < 1.6 ? 1 : 0; m['pin'] = 1; a.lookWeight = 1;
        if (this.sT < 0.15) c.sound(this.herdSpec.neighCue);
        break;
      case 'charge': {
        const ct = this.chargeTarget;
        const tgt = ct?.alive === true ? ct.position : player;
        const tx = tgt.x - a.position.x, tz = tgt.z - a.position.z, td = Math.hypot(tx, tz);
        a.state = 'charge'; m['pin'] = 1;
        c.steer(a, td > 6 ? c.pathYaw(a, tgt.x, tgt.z, 0.5) : Math.atan2(tx, tz), this.herdSpec.chargeSpeed * a.mods.speed, 4.5);
        if (td < 1.9 * a.scale) {
          _t.set(tx, 0, tz).normalize();
          if (ct?.alive === true) {
            const w = ct;
            w.applyDamage(25, w.position, _t);if(this.guest!==undefined)this.validateHerdGuest(); w.stagger(_t, 1);if(this.guest!==undefined)this.validateHerdGuest();
            m['kicks'] = (m['kicks'] ?? 0) + 1;
            if ((m['kicks'] ?? 0) >= 2 && this.herdPorts.scarePack(w, 40)) { this.herdPorts.onEvent?.('pack-driven-off', w.position.x, w.position.z); m['kicks'] = 0; }
          } else if (this.knockCd <= 0) {
            this.herdPorts.chargeContact(a, c, 1.9 * a.scale);if(this.guest!==undefined)this.validateHerdGuest(); this.knockCd = 1.5;
            this.herdPorts.onKnockdown?.(_t.x, _t.z, 1);
          }
          m['kick'] = 1; c.sound(this.herdSpec.squealCue);
          this.chargeCd = 5; this.chargeTarget = null; this.setStallion('wheel');
        }
        break;
      }
      case 'wheel':
        a.state = 'flee';
        c.steer(a, toP + Math.PI + 0.6, this.herdSpec.trotSpeed * 1.6, 3);
        break;
      case 'lead': {
        // run the flight at the herd's flank, between it and what it runs from
        const lx = this.cx - this.fleeX * 5 + this.fleeZ * 6, lz = this.cz - this.fleeZ * 5 - this.fleeX * 6;
        const ld = Math.hypot(lx - a.position.x, lz - a.position.z);
        a.state = 'flee';
        const speed = this.mode === 'flee' ? this.herdSpec.gallopSpeed * (ld > 6 ? 1.08 : 0.98) : this.herdSpec.trotSpeed;
        c.steer(a, Math.atan2(lx - a.position.x + this.fleeX * 10, lz - a.position.z + this.fleeZ * 10), speed, 3);
        if (this.stampeding && a.speed > 6) this.trample(a, c);
        break;
      }
      case 'beaten':
        a.state = 'graze'; a.setMotion(a.yaw, 0, 1);   // head down, spent
        m['headUp'] = 0; m['toss'] = 0;
        break;
      case 'ridden': break;
      // no default
    }
  }

  /** a stampeding horse runs down the player / wolves in its path */
  private trample(a: A, c: GuardedHerdContext<A>): void {
    const m = a.mem;
    if ((m['hitP'] ?? 0) === 0 && this.knockCd <= 0 && a.position.distanceTo(c.player) < 1.7 * a.scale && !this.herdPorts.environment().playerMounted) {
      m['hitP'] = 1; this.knockCd = 1.2;
      c.hurt(30);if(this.guest!==undefined)this.validateHerdGuest();
      _t.set(Math.sin(a.yaw), 0, Math.cos(a.yaw));
      this.herdPorts.onKnockdown?.(_t.x, _t.z, 1);
    }
    const w = this.findThreat?.(a.position.x, a.position.z, 1.8) ?? null;
    if (w !== null) { _t.set(Math.sin(a.yaw), 0, Math.cos(a.yaw)); w.applyDamage(30, w.position, _t);if(this.guest!==undefined)this.validateHerdGuest(); w.stagger(_t, 1);if(this.guest!==undefined)this.validateHerdGuest(); }
  }
}

/** Complete admitted continuation, independent of validator implementation metadata. */
type HerdContinuationDataInput = HerdContinuationData;
interface HerdContinuationDataFields {
    contract: string;
    group: string;
    lead: string | null;
    stallion: string | null;
    ridden: string | null;
    chargeTarget: string | null;
    foals: string[];
    mothers: [
        string,
        string
    ][];
    state: {
        initialized: boolean;
        mode: "graze" | "drift" | "alert" | "flee" | "settle";
        stampeding: boolean;
        stallionState: "lead" | "ridden" | "watch" | "warn" | "display" | "charge" | "wheel" | "beaten";
        trust: number;
        alert: number;
        alertOwned: boolean;
        cx: number;
        cz: number;
        spotX: number;
        spotZ: number;
        spotT: number;
        fleeX: number;
        fleeZ: number;
        fleeRun: number;
        fleeLen: number;
        fleeFromX: number;
        fleeFromZ: number;
        modeT: number;
        sT: number;
        chargeCd: number;
        beatenT: number;
        beaten: boolean;
        knockCd: number;
    };
}
type HerdContinuationData = { [Key in keyof HerdContinuationDataFields]: HerdContinuationDataFields[Key] };
