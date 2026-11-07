import { Vector3 } from 'three';
import * as v from 'valibot';
import type { AnimalSim } from '../entities/AnimalSim';
import type { SimValue } from '../../../server/engine/sim';
import { inspectBrain } from './inspect';
import { StrikeRunner, type StrikeContext, type StrikeSpec } from './strikes';
import { readStrikeState } from './strikeState';
import { emitFault } from '../core/faults';

/** Circle, overhead stalk, telegraphed chest dive and rising rest tuning, in metres, seconds and m/s. */
export interface OrbitDiverSpec {
  circleSpeed: number; hangAltitude: number; stalkSpeed: number; diveSpeed: number; restSeconds: number;
  noticeRadius: number; giveUpRadius: number; initialRestSeconds: number; stalkMaxSeconds: number;
  riseMargin: number; targetHeight: number; alignRadius: number; alignTolerance: number;
}
/** One admitted orbit, bound by the loader; a restored actor must receive the same orbit. */
export interface OrbitDiverHome { x: number; z: number; r: number; y: number }
/** Trusted target observation, flight motion and contact authority for one fixed-step actor. */
export interface OrbitDiverPorts<A extends AnimalSim> {
  dt: number; player: A['position']; calm: boolean;
  mayAttack: (actor: A) => boolean; reach: (actor: A) => boolean; claim: (actor: A) => boolean;
  hurt: (damage: number) => void;
  flight: { steer: (actor: A, yaw: number, speed: number, altitude: number, turn: number) => void };
}

/** Player-circle and home-patrol tuning, including the chest swoop and timed climb, in world units. */
export interface PatrolDiverSpec {
  glideAltitude: number; glideSpeed: number; circleRadius: number; patrolRadius: number; patrolAltitude: number;
  noticeRadius: number; diveFrom: number; diveSpeed: number; climbAltitude: number; climbSeconds: number;
  diveMaxSeconds: number; restSeconds: number; targetHeight: number; diveSlope: number;
  climbSpeedBonus: number; orbitLead: number; heldField: string;
}
/** Trusted flight/contact authority; the actor's declared held field suppresses new dives. */
export interface PatrolDiverPorts<A extends AnimalSim> {
  dt: number; player: A['position']; calm: boolean; reach: (actor: A) => boolean; claim: (actor: A) => boolean;
  hurt: (damage: number) => void;
  flight: { steer: (actor: A, yaw: number, speed: number, altitude: number, turn: number) => void };
}

/** Small-circle flight, telegraphed chest dart and contact shove tuning, in metres, seconds and m/s. */
export interface BurstFlyerSpec {
  circleSpeed: number; dartSpeed: number; noticeRadius: number; shoveSpeed: number; liftSpeed: number; targetHeight: number;
}
/** Trusted flight, reach, token and player impulse authority; guest policy never moves the player directly. */
export interface BurstFlyerPorts<A extends AnimalSim> {
  dt: number; player: A['position']; calm: boolean; reach: (actor: A) => boolean; claim: (actor: A) => boolean;
  hurt: (damage: number) => void; shove: (yaw: number, speed: number, lift: number) => void;
  flight: { steer: (actor: A, yaw: number, speed: number, altitude: number, turn: number) => void };
}
/** Real terrain, wind, altitude, shared random, head/contact and entered tell authority for a wind-borne stooper. */
export interface WindDiverPorts<A extends AnimalSim> {
  readonly player: { readonly position: Vector3 }; readonly rock: { readonly x: number; readonly z: number; readonly top: number };
  readonly phase2: () => boolean; readonly heightAt: (x: number, z: number) => number;
  readonly wind: () => { readonly x: number; readonly z: number }; readonly random: () => number;
  readonly isHead: (a: A, p: Vector3) => boolean;
  readonly tell: { readonly setTime: (t: number) => void; readonly aim: (from: Vector3, to: Vector3, alpha: number) => void;
    readonly chevron: (point: Vector3 | null) => void; readonly hide: () => void };
  readonly hurt: (a: A, amount: number) => void; readonly knock: (dx: number, dz: number) => void;
  readonly grounded: () => void; readonly cry: (at: Vector3) => void; readonly signature: () => void;
}
const windScalar = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(600));
const windPositive = v.pipe(windScalar, v.minValue(Number.MIN_VALUE));
const windSpeed = v.pipe(windPositive, v.maxValue(40)), windTurn = v.pipe(windScalar, v.maxValue(30)), windFraction = v.pipe(windScalar, v.maxValue(1));
const windField = v.pipe(v.string(), v.regex(/^[a-z][a-zA-Z0-9._:-]{0,127}$/u));
const WindDiverSpecSchema: v.GenericSchema<BoundedDiverTuningInput, BoundedDiverTuning> = v.pipe(v.strictObject({
  initialCooldown: windScalar, lookTurn: windTurn,
  fields: v.strictObject({ altitude: windField, smoothed: windField, flap: windField, fold: windField, ground: windField, bank: windField }),
  cruise: v.strictObject({ home: windScalar, homePhase2: windScalar, player: windScalar, playerPhase2: windScalar, clearance: windScalar, wave: windScalar, waveFrequency: windScalar, ease: windPositive }),
  orbit: v.strictObject({ windScale: windScalar, ease: windPositive, radius: windPositive, speed: windSpeed, climbEase: windPositive, soarEase: windPositive, climbSpeed: windSpeed, arrival: windScalar }),
  pose: v.strictObject({ initialFlap: windFraction, climbFlap: windFraction, soarFlap: windFraction, waveFlap: windFraction, flapFrequency: windScalar, bank: windScalar, tellFlap: windFraction, tellFold: windFraction }),
  tell: v.strictObject({ seconds: windPositive, phase2Seconds: windPositive, targetHeight: windScalar, alpha: windFraction, alphaGrowth: windFraction }),
  stoop: v.strictObject({ targetHeight: windScalar, speed: windSpeed, arrival: windScalar, alpha: windFraction, range: windPositive, playerHeight: windScalar, damage: windScalar, climbHeight: windScalar,
    cooldown: windScalar, randomCooldown: windScalar, phaseCooldown: windScalar, phaseRandom: windScalar }),
  ground: v.strictObject({ onScale: windScalar, idleScale: windScalar, seconds: windPositive, damage: windScalar }),
}), v.check(s => new Set(Object.values(s.fields)).size === 6, 'Distinct altitude and pose fields'));
/** Strict declared orbit, wind, tell, stoop, weak-point and cooldown tuning. */
export type WindDiverSpec = v.InferOutput<typeof WindDiverSpecSchema>;
/** Validate and copy all tuning before a native actor can be mutated. */
export function readWindDiverSpec(input: unknown): WindDiverSpec { return v.parse(WindDiverSpecSchema, input); }

const windFinite = v.pipe(v.number(), v.finite()), windTriple = v.tuple([windFinite, windFinite, windFinite]);
const WindDiverSaved: v.GenericSchema<BoundedDiverSaveInput, BoundedDiverSave> = v.strictObject({ st: v.picklist(['soar', 'tell', 'stoop', 'ground', 'climb']), stT: windFinite, stoopT: windFinite,
  ang: windFinite, centre: windTriple, tgt: windTriple, overYou: v.boolean() });
/** One admitted flight pattern, immutable home and ordered attack contract. */
export type DiverProfile<A extends AnimalSim = AnimalSim> =
  | { pattern: 'wind'; spec: WindDiverSpec; ports: WindDiverPorts<A> }
  | { pattern: 'orbit'; spec: OrbitDiverSpec; home: OrbitDiverHome; strike: StrikeSpec }
  | { pattern: 'patrol'; spec: PatrolDiverSpec; home: { x: number; z: number }; strike: StrikeSpec }
  | { pattern: 'burst'; spec: BurstFlyerSpec; home: OrbitDiverHome; strike: StrikeSpec };
/** Pattern-specific body authority; a mismatched observation refuses before changing state. */
export type DiverObservation<A extends AnimalSim> =
  | (OrbitDiverPorts<A> & { pattern: 'orbit' })
  | (PatrolDiverPorts<A> & { pattern: 'patrol' })
  | (BurstFlyerPorts<A> & { pattern: 'burst' })
  | { pattern: 'wind'; actor: A; player: Vector3 };
/** Flight policy phases; strike windup/contact/recovery are owned by the shared strike runner. */
export type DiverState = 'circle' | 'stalk' | 'dive' | 'rise' | 'glide' | 'climb' | 'drift' | 'dart' | 'grounded' | 'soar' | 'tell' | 'stoop' | 'ground' | 'strike' | 'rest';
const finite = v.pipe(v.number(), v.finite());
const orbitContinuation = v.strictObject({ contract: v.string(), state: v.picklist(['circle', 'stalk', 'dive', 'rise']),
  angle: finite, rest: finite, timer: v.pipe(finite, v.minValue(0)), diving: v.pipe(finite, v.minValue(0)), strikes: v.unknown() });
const patrolContinuation = v.strictObject({ contract: v.string(), state: v.picklist(['glide', 'dive', 'climb']),
  clock: v.pipe(finite, v.minValue(0)), rest: finite, struck: v.boolean(), strikes: v.unknown() });
const burstContinuation = v.strictObject({ contract: v.string(), state: v.picklist(['drift', 'dart']),
  angle: finite, dart: v.pipe(finite, v.minValue(0)), strikes: v.unknown() });
function admitProfile<A extends AnimalSim>(profile: DiverProfile<A>): DiverProfile<A> {
  if (profile.pattern === 'wind') return { ...profile, spec: readWindDiverSpec(profile.spec) };
  if (profile.pattern === 'orbit') {
    const { spec, home, strike } = profile;
    const values = [spec.circleSpeed, spec.hangAltitude, spec.stalkSpeed, spec.diveSpeed, spec.restSeconds, spec.noticeRadius,
      spec.giveUpRadius, spec.initialRestSeconds, spec.stalkMaxSeconds, spec.riseMargin, spec.targetHeight, spec.alignRadius, spec.alignTolerance];
    if (values.some(value => !Number.isFinite(value) || value < 0 || value > 600) || spec.circleSpeed > 30 || spec.stalkSpeed > 30 || spec.diveSpeed > 30
      || spec.noticeRadius > spec.giveUpRadius || spec.stalkMaxSeconds <= 0 || spec.alignRadius <= 0 || spec.alignTolerance <= 0
      || ![home.x, home.z, home.r, home.y].every(Number.isFinite) || home.r <= 0 || home.r > 600
      || strike.shape.kind !== 'sphere' || strike.id.length === 0 || strike.id.length > 128
      || ![strike.windup, strike.active, strike.recover, strike.cooldown, strike.range, strike.damage, strike.shape.radius].every(value => Number.isFinite(value) && value >= 0)) throw new Error('Invalid orbit diver parameters');
  }
  if (profile.pattern === 'patrol') {
    const { spec, home, strike } = profile;
    const values = [spec.glideAltitude, spec.glideSpeed, spec.circleRadius, spec.patrolRadius, spec.patrolAltitude,
      spec.noticeRadius, spec.diveFrom, spec.diveSpeed, spec.climbAltitude, spec.climbSeconds, spec.diveMaxSeconds,
      spec.restSeconds, spec.targetHeight, spec.diveSlope, spec.climbSpeedBonus, spec.orbitLead];
    if (values.some(value => !Number.isFinite(value) || value < 0 || value > 600)
      || spec.glideSpeed + spec.climbSpeedBonus > 30 || spec.diveSpeed > 30 || spec.diveFrom > spec.noticeRadius
      || spec.circleRadius <= 0 || spec.patrolRadius <= 0 || spec.climbSeconds <= 0 || spec.diveMaxSeconds <= 0
      || !/^[a-z][a-z0-9._:-]{0,127}$/u.test(spec.heldField) || ![home.x, home.z].every(Number.isFinite)
      || strike.shape.kind !== 'sphere' || strike.id.length === 0 || strike.id.length > 128
      || ![strike.windup, strike.active, strike.recover, strike.cooldown, strike.range, strike.damage, strike.shape.radius].every(value => Number.isFinite(value) && value >= 0)) throw new Error('Invalid patrol diver parameters');
  }
  if (profile.pattern === 'burst') {
    const { spec, home, strike } = profile;
    const values = [spec.circleSpeed, spec.dartSpeed, spec.noticeRadius, spec.shoveSpeed, spec.liftSpeed, spec.targetHeight];
    if (values.some(value => !Number.isFinite(value) || value < 0 || value > 600)
      || spec.circleSpeed > 30 || spec.dartSpeed > 30 || spec.shoveSpeed > 30 || spec.liftSpeed > 30
      || ![home.x, home.z, home.r, home.y].every(Number.isFinite) || home.r <= 0 || home.r > 600
      || strike.shape.kind !== 'sphere' || strike.id.length === 0 || strike.id.length > 128
      || ![strike.windup, strike.active, strike.recover, strike.cooldown, strike.range, strike.damage, strike.shape.radius].every(value => Number.isFinite(value) && value >= 0)) throw new Error('Invalid burst flyer parameters');
  }
  const strike = { ...profile.strike, shape: { ...profile.strike.shape }, tags: [...profile.strike.tags] };
  if (profile.pattern === 'orbit') return { pattern: profile.pattern, spec: { ...profile.spec }, home: { ...profile.home }, strike };
  if (profile.pattern === 'patrol') return { pattern: profile.pattern, spec: { ...profile.spec }, home: { ...profile.home }, strike };
  return { pattern: profile.pattern, spec: { ...profile.spec }, home: { ...profile.home }, strike };
}

/** Parametric orbit/patrol/burst/wind policy with one contact runner and exact preset save contracts. */
export class DiverBrain<A extends AnimalSim> {
  private readonly boundActor: A | null;
  private get actor(): A { if (this.boundActor === null) throw new Error('Missing diver actor authority'); return this.boundActor; }
  private readonly profile: DiverProfile<A>;
  private reportedFrames: Set<string> | undefined;
  private rejectFrame(message: string): false {
    const reported = this.reportedFrames ??= new Set();
    if (!reported.has(message)) {reported.add(message); emitFault({system: 'ai.diver', error: new Error(message), verdict: 'retry'});}
    return false;
  }
  private readonly contract: string;
  private readonly strikes = new StrikeRunner();
  private readonly chest = new Vector3();
  private phaseValue: DiverState;
  private angle = 0;
  private rest = 0;
  private timer = 0;
  private diving = 0;
  private clock = 0;
  private struck = false;
  private dart = 0;
  constructor(actor: null, profile: Extract<DiverProfile<A>, { pattern: 'wind' }>);
  constructor(actor: A, profile: Exclude<DiverProfile<A>, { pattern: 'wind' }>);
  constructor(actor: A | null, profile: DiverProfile<A>) {
    if (actor === null && profile.pattern !== 'wind') throw new Error('Missing diver actor authority');
    this.boundActor = actor; this.profile = admitProfile(profile);
    const p = this.profile;
    if (p.pattern === 'wind') {
      this.phaseValue = 'soar'; this.windStoopT = p.spec.initialCooldown;
      this.contract = ''; return;
    }
    if (actor === null) throw new Error('Missing diver actor authority');
    this.phaseValue = p.pattern === 'orbit' ? 'circle' : p.pattern === 'patrol' ? 'glide' : 'drift';
    if (p.pattern === 'orbit') {
      this.angle = Math.atan2(actor.position.z - p.home.z, actor.position.x - p.home.x);
      this.rest = p.spec.initialRestSeconds;
    } else if (p.pattern === 'patrol') this.rest = p.spec.restSeconds;
    this.contract = JSON.stringify({ version: 1, actor: actor.entityId, spec: p.spec, home: p.home, strike: p.strike });
    inspectBrain(actor, () => ({ state: this.state, picks: [], brainHz: 20, pinned: false }));
  }
  /** Current pattern phase, separately scheduled from perception and body execution. */
  get state(): DiverState { return this.mode; }
  private get mode(): DiverState { return this.phaseValue; }
  private set mode(value: DiverState) { this.phaseValue = value; }
  /** Exact legacy clock/strike continuation, including each preset's JSON field order. */
  snapshot(): SimValue {
    if (this.profile.pattern === 'wind') return this.windSnapshot();
    if (this.profile.pattern === 'orbit') return JSON.stringify({ contract: this.contract, state: this.mode,
      angle: this.angle, rest: this.rest, timer: this.timer, diving: this.diving, strikes: this.strikes.snapshot() });
    if (this.profile.pattern === 'patrol') return JSON.stringify({ contract: this.contract, state: this.mode,
      clock: this.clock, rest: this.rest, struck: this.struck, strikes: this.strikes.snapshot() });
    return JSON.stringify({ contract: this.contract, state: this.mode, angle: this.angle, dart: this.dart, strikes: this.strikes.snapshot() });
  }
  /** Validate all clocks and immutable references before mutation; restoration publishes no body effects. */
  restore(saved: unknown): void {
    if (this.profile.pattern === 'wind') { this.restoreWind(saved); return; }
    const p = this.profile, name = p.pattern === 'burst' ? 'burst flyer' : `${p.pattern} diver`;
    if (typeof saved !== 'string') throw new Error(`Invalid ${name} continuation`);
    const parsed: unknown = JSON.parse(saved);
    if (p.pattern === 'orbit') {
      const value = v.parse(orbitContinuation, parsed);
      if (value.contract !== this.contract) throw new Error('Incompatible orbit diver continuation');
      const strikes = readStrikeState(value.strikes, [p.strike]);
      this.strikes.restore(strikes, [p.strike]);
      this.mode = value.state; this.angle = value.angle; this.rest = value.rest; this.timer = value.timer; this.diving = value.diving;
    } else if (p.pattern === 'patrol') {
      const value = v.parse(patrolContinuation, parsed);
      if (value.contract !== this.contract) throw new Error('Incompatible patrol diver continuation');
      const strikes = readStrikeState(value.strikes, [p.strike]);
      this.strikes.restore(strikes, [p.strike]);
      this.mode = value.state; this.clock = value.clock; this.rest = value.rest; this.struck = value.struck;
    } else {
      const value = v.parse(burstContinuation, parsed);
      if (value.contract !== this.contract) throw new Error('Incompatible burst flyer continuation');
      const strikes = readStrikeState(value.strikes, [p.strike]);
      this.strikes.restore(strikes, [p.strike]); this.mode = value.state; this.angle = value.angle; this.dart = value.dart;
    }
  }
  private context(c: OrbitDiverPorts<A> | PatrolDiverPorts<A> | BurstFlyerPorts<A>, p: Exclude<DiverProfile<A>, { pattern: 'wind' }>): StrikeContext {
    this.chest.copy(c.player); this.chest.y += p.spec.targetHeight;
    return { actor: this.actor, target: this.chest, canReach: () => c.reach(this.actor), hit: value => {
      if (p.pattern === 'patrol') this.struck = true;
      c.hurt(value.damage);
      if (p.pattern === 'burst' && 'shove' in c) c.shove(Math.atan2(c.player.x - this.actor.position.x,
        c.player.z - this.actor.position.z), p.spec.shoveSpeed, p.spec.liftSpeed);
    } };
  }
  // Zero is an interrupt's second wake in the same frame, not an invalid simulation step.
  private step(c: DiverObservation<A>): boolean {
    if (c.pattern !== this.profile.pattern) return this.rejectFrame('Incompatible diver observation');
    if (c.pattern !== 'wind' && (!Number.isFinite(c.dt) || c.dt < 0 || c.dt > 1)) {
      return this.rejectFrame(`Invalid ${c.pattern === 'burst' ? 'burst flyer' : `${c.pattern} diver`} step`);
    }
    return true;
  }
  /** Observe using the preset's original distance, calm reset, token and held-field laws. */
  think(c: DiverObservation<A>): void {
    if (!this.step(c)) return; const p = this.profile;
    if (p.pattern === 'orbit' && c.pattern === 'orbit') this.thinkOrbit(c, p);
    else if (p.pattern === 'patrol' && c.pattern === 'patrol') this.thinkPatrol(c, p);
    else if (p.pattern === 'burst' && c.pattern === 'burst') this.thinkBurst(c, p);
    else if (p.pattern === 'wind' && c.pattern === 'wind') this.decideWind(c.actor, c);
  }
  /** Advance one body tick; the host retains flight, reach, damage and impulse authority. */
  act(c: DiverObservation<A>): void {
    if (!this.step(c)) return; const p = this.profile;
    if (p.pattern === 'orbit' && c.pattern === 'orbit') this.actOrbit(c, p);
    else if (p.pattern === 'patrol' && c.pattern === 'patrol') this.actPatrol(c, p);
    else if (p.pattern === 'burst' && c.pattern === 'burst') this.actBurst(c, p);
    else if (p.pattern === 'wind') this.rejectFrame('Wind motion uses the explicit encounter frame');
  }
  private thinkOrbit(c: OrbitDiverPorts<A>, profile: Extract<DiverProfile, { pattern: 'orbit' }>): void {
    const a = this.actor; if (!a.alive) return;
    if (c.calm) { if (this.state !== 'circle') { this.strikes.cancel(); a.cancelAttack(); this.mode = 'circle'; } return; }
    this.rest -= c.dt; this.timer += c.dt;
    const d = Math.hypot(c.player.x - a.position.x, c.player.z - a.position.z);
    if (this.state === 'circle' && this.rest <= 0 && d < profile.spec.noticeRadius && c.mayAttack(a)) { this.timer = 0; this.mode = 'stalk'; }
    else if (this.state === 'stalk' && (d > profile.spec.giveUpRadius || this.timer > profile.spec.stalkMaxSeconds)) this.mode = 'rise';
    else if (this.state === 'rise' && a.position.y > profile.home.y - profile.spec.riseMargin) this.mode = 'circle';
  }
  private actOrbit(c: OrbitDiverPorts<A>, profile: Extract<DiverProfile, { pattern: 'orbit' }>): void {
    const a = this.actor; if (!a.alive) return;
    const p = c.player, dx = p.x - a.position.x, dz = p.z - a.position.z, d = Math.hypot(dx, dz), toPlayer = Math.atan2(dx, dz);
    const strike = this.context(c, profile);
    if (this.state === 'circle') {
      this.angle += (c.dt * profile.spec.circleSpeed) / profile.home.r;
     const tx = profile.home.x + Math.cos(this.angle) * profile.home.r, tz = profile.home.z + Math.sin(this.angle) * profile.home.r;
      c.flight.steer(a, Math.atan2(tx - a.position.x, tz - a.position.z), profile.spec.circleSpeed, profile.home.y, 1.6);
    } else if (this.state === 'stalk') {
     const over = p.y + profile.spec.hangAltitude;
      c.flight.steer(a, toPlayer, Math.min(profile.spec.stalkSpeed, d * 1.5), over, 3);
      if (d < profile.spec.alignRadius && Math.abs(a.position.y - over) < profile.spec.alignTolerance && !this.strikes.busy && c.reach(a) && c.claim(a)) {
        this.strikes.start(profile.strike, a, this.chest); this.diving = 0; this.mode = 'dive';
      }
    } else if (this.state === 'dive') {
      this.diving += c.dt;
      if (this.diving < profile.strike.windup) c.flight.steer(a, toPlayer, 0, p.y + profile.spec.hangAltitude, 3);
      else c.flight.steer(a, toPlayer, profile.spec.diveSpeed, this.chest.y, 4);
      this.strikes.update(c.dt, strike);
      if (!this.strikes.busy) { this.rest = profile.spec.restSeconds; this.mode = 'rise'; }
    } else c.flight.steer(a, toPlayer + Math.PI, profile.spec.circleSpeed, profile.home.y, 2);
  }
  private thinkPatrol(c: PatrolDiverPorts<A>, profile: Extract<DiverProfile, { pattern: 'patrol' }>): void {
    const a = this.actor; if (!a.alive) return;
    if (c.calm || a.mem[profile.spec.heldField] === 1) { if (this.state !== 'glide') this.mode = 'glide'; return; }
    const dh = Math.hypot(c.player.x - a.position.x, c.player.z - a.position.z);
    if (this.state === 'glide' && this.rest <= 0 && dh < profile.spec.diveFrom && c.reach(a) && c.claim(a)) { this.mode = 'dive'; this.clock = 0; this.struck = false; }
  }
  private actPatrol(c: PatrolDiverPorts<A>, profile: Extract<DiverProfile, { pattern: 'patrol' }>): void {
    const a = this.actor; if (!a.alive) return;
    const s = profile.spec; this.clock += c.dt; this.rest -= c.dt;
    const strike = this.context(c, profile);
    this.strikes.update(c.dt, strike);
    const toYaw = (x: number, z: number): number => Math.atan2(x - a.position.x, z - a.position.z);
    if (this.state === 'dive') {
     const d3 = a.position.distanceTo(this.chest), passed = this.struck && !this.strikes.busy;
      c.flight.steer(a, toYaw(this.chest.x, this.chest.z), s.diveSpeed, Math.max(s.targetHeight, Math.min(s.glideAltitude, d3 * s.diveSlope)), 3);
      if (!this.strikes.busy && !this.struck) { const next = this.strikes.pick([profile.strike], strike); if (next !== null) this.strikes.start(next, a, this.chest); }
      if (passed || this.clock > s.diveMaxSeconds || c.calm) { this.mode = 'climb'; this.clock = 0; }
      return;
    }
    if (this.state === 'climb') {
      c.flight.steer(a, a.yaw, s.glideSpeed + s.climbSpeedBonus, s.climbAltitude, 1.2);
      if (this.clock > s.climbSeconds) { this.mode = 'glide'; this.rest = s.restSeconds; }
      return;
    }
    const near = !c.calm && a.mem[s.heldField] !== 1 && Math.hypot(c.player.x - a.position.x, c.player.z - a.position.z) < s.noticeRadius;
    const cx = near ? c.player.x : profile.home.x, cz = near ? c.player.z : profile.home.z;
    const r = near ? s.circleRadius : s.patrolRadius, alt = near ? s.glideAltitude : s.patrolAltitude;
    const around = Math.atan2(a.position.x - cx, a.position.z - cz) + s.orbitLead;
    c.flight.steer(a, toYaw(cx + Math.sin(around) * r, cz + Math.cos(around) * r), s.glideSpeed, alt, 1.4);
  }
  private thinkBurst(c: BurstFlyerPorts<A>, profile: Extract<DiverProfile, { pattern: 'burst' }>): void {
    const a = this.actor; if (!a.alive || this.state === 'dart') return;
    if (!c.calm && a.position.distanceTo(c.player) < profile.spec.noticeRadius && !this.strikes.busy && c.claim(a)) {
      this.context(c, profile); this.strikes.start(profile.strike, a, this.chest); this.dart = 0; this.mode = 'dart';
    }
  }
  private actBurst(c: BurstFlyerPorts<A>, profile: Extract<DiverProfile, { pattern: 'burst' }>): void {
    const a = this.actor; if (!a.alive) return;
    if (this.state === 'dart') {
     const strike = this.context(c, profile); this.dart += c.dt;
      c.flight.steer(a, Math.atan2(this.chest.x - a.position.x, this.chest.z - a.position.z), this.dart < profile.strike.windup ? 0 : profile.spec.dartSpeed, this.chest.y, 6);
      this.strikes.update(c.dt, strike); if (!this.strikes.busy) this.mode = 'drift'; return;
    }
    this.angle += (c.dt * profile.spec.circleSpeed) / profile.home.r;
    c.flight.steer(a, Math.atan2(profile.home.x + Math.cos(this.angle) * profile.home.r - a.position.x,
      profile.home.z + Math.sin(this.angle) * profile.home.r - a.position.z), profile.spec.circleSpeed, profile.home.y, 3);
  }
  private windStT = 0;
  private windStoopT = 0;
  private readonly windCentre = new Vector3(); private readonly windTarget = new Vector3();
  private readonly windFrom = new Vector3(); private readonly windDelta = new Vector3();
  private windOverPlayer = false;
  private requireWind(): void { if (this.profile.pattern !== 'wind') throw new Error('Incompatible wind diver pattern'); }
  private get windSpec(): WindDiverSpec { const p = this.profile; if (p.pattern !== 'wind') throw new Error('Incompatible wind diver pattern'); return p.spec; }
  private get windPorts(): WindDiverPorts<A> { const p = this.profile; if (p.pattern !== 'wind') throw new Error('Incompatible wind diver pattern'); return p.ports; }
  private windPhase(): v.InferOutput<typeof WindDiverSaved>['st'] {
    const phase = this.mode;
    if (phase === 'soar' || phase === 'tell' || phase === 'stoop' || phase === 'ground' || phase === 'climb') return phase;
    throw new Error('Incompatible wind diver phase');
  }
  private get windP2(): boolean { return this.windPorts.phase2(); }
  /** Return to the climb phase without resetting retained clocks. */
  resetWind(): void { this.requireWind(); this.mode = 'climb'; this.windPorts.tell.hide(); }
  /** Release transient entered tells without changing the body law. */
  disposeWindTell(): void { this.requireWind(); this.windPorts.tell.hide(); this.windPorts.tell.chevron(null); }
  private windCruise(a: A | null): number {
    if (!this.windOverPlayer) return this.windPorts.rock.top + (this.windP2 ? this.windSpec.cruise.homePhase2 : this.windSpec.cruise.home);
    // over you — but never inside the rock's flank the orbit swings across: 18 m clear of the ground under him
    const over = a !== null ? this.windPorts.heightAt(a.position.x, a.position.z) + this.windSpec.cruise.clearance : -Infinity;
    return Math.max(this.windPorts.player.position.y + (this.windP2 ? this.windSpec.cruise.playerPhase2 : this.windSpec.cruise.player), over);
  }
  /** Initialize a real deferred body at its declared home altitude. */
  spawnWind(a: A): void { this.requireWind();
    this.windCentre.set(this.windPorts.rock.x, 0, this.windPorts.rock.z);
    a.mem[this.windSpec.fields.altitude] = this.windCruise(a); a.mem[this.windSpec.fields.flap] = this.windSpec.pose.initialFlap;
    this.mode = 'soar'; this.windStoopT = this.windSpec.initialCooldown;
  }
  /** Resolve the grounded weak point with the authoritative head query. */
  windDamage(a: A, p: Vector3): number { this.requireWind();
    if (this.mode === 'ground') return this.windPorts.isHead(a, p) ? 1 : this.windSpec.ground.damage;       // grounded: every hit a headshot
    return 1;
  }
  /** Preserve the manager decision cadence without taking frame motion authority. */
  decideWind(a: A, c: { readonly player: Vector3 }): void { this.requireWind(); a.lookTarget.copy(c.player); a.lookWeight = 1; a.setMotion(a.yaw, 0, this.windSpec.lookTurn); }
  /** Advance the frame law; query actual terrain, wind and shared random only on their original frames. */
  advanceWind(a: A | null, dt: number, t: number, engaged: boolean, leashing: boolean): void { this.requireWind();
    if (a === null) return;
    const wind = this.windPorts.wind();
    this.windPorts.tell.setTime(t);
    this.windStT += dt;
    const p = this.windPorts.player.position, m = a.mem;
    // the orbit centre: over you while engaged, back over the rock otherwise; always drifting downwind
    const home = leashing || !engaged;
    this.windOverPlayer = !home;
    const cx = home ? this.windPorts.rock.x : p.x, cz = home ? this.windPorts.rock.z : p.z;
    this.windCentre.x += (cx + wind.x * this.windSpec.orbit.windScale - this.windCentre.x) * Math.min(1, dt * this.windSpec.orbit.ease);
    this.windCentre.z += (cz + wind.z * this.windSpec.orbit.windScale - this.windCentre.z) * Math.min(1, dt * this.windSpec.orbit.ease);
    const R = this.windSpec.orbit.radius;
    switch (this.windPhase()) {
      case 'soar': case 'climb': {
        this.angle += dt * this.windSpec.orbit.speed / R;
        const tx = this.windCentre.x + Math.cos(this.angle) * R, tz = this.windCentre.z + Math.sin(this.angle) * R;
        const k = this.mode === 'climb' ? this.windSpec.orbit.climbEase : this.windSpec.orbit.soarEase;
        a.position.x += (tx - a.position.x) * Math.min(1, dt * k); a.position.z += (tz - a.position.z) * Math.min(1, dt * k);
        a.yaw = a.desiredYaw = Math.atan2(-Math.sin(this.angle), Math.cos(this.angle));
        const cruise = this.windCruise(a);
        const alt = m[this.windSpec.fields.altitude] ?? cruise;
        m[this.windSpec.fields.altitude] = this.mode === 'climb' ? Math.min(cruise, alt + this.windSpec.orbit.climbSpeed * dt) : alt + (cruise + this.windSpec.cruise.wave * Math.sin(t * this.windSpec.cruise.waveFrequency) - alt) * Math.min(1, dt * this.windSpec.cruise.ease);
        m[this.windSpec.fields.flap] = this.mode === 'climb' ? this.windSpec.pose.climbFlap : this.windSpec.pose.soarFlap + this.windSpec.pose.waveFlap * Math.max(0, Math.sin(t * this.windSpec.pose.flapFrequency)); m[this.windSpec.fields.fold] = 0; m[this.windSpec.fields.ground] = 0; m[this.windSpec.fields.bank] = this.windSpec.pose.bank;
        if (this.mode === 'climb' && (m[this.windSpec.fields.altitude] ?? 0) >= cruise - this.windSpec.orbit.arrival) this.mode = 'soar';
        if (engaged && this.mode === 'soar') { this.windStoopT -= dt; if (this.windStoopT <= 0) { this.mode = 'tell'; this.windStT = 0; this.windPorts.signature(); this.windPorts.cry(a.position); } }
        break;
    }
      case 'tell': {
        // hangs on the wind, wings half folding; a gold line streaks from it to you, the chevron at the screen edge
        const T = this.windP2 ? this.windSpec.tell.phase2Seconds : this.windSpec.tell.seconds;
        m[this.windSpec.fields.flap] = this.windSpec.pose.tellFlap; m[this.windSpec.fields.fold] = this.windSpec.pose.tellFold * (this.windStT / T); m[this.windSpec.fields.bank] = 0;
        a.yaw = a.desiredYaw = Math.atan2(p.x - a.position.x, p.z - a.position.z);
        a.headWorld(this.windFrom);
        this.windDelta.set(p.x, p.y + this.windSpec.tell.targetHeight, p.z);
        this.windPorts.tell.aim(this.windFrom, this.windDelta, this.windSpec.tell.alpha + this.windSpec.tell.alphaGrowth * (this.windStT / T));
        this.windPorts.tell.chevron(this.windFrom);
        if (this.windStT >= T) { this.mode = 'stoop'; this.windStT = 0; this.windTarget.set(p.x, p.y + this.windSpec.stoop.targetHeight, p.z); }
        break;
    }
      case 'stoop': {
        m[this.windSpec.fields.fold] = 1; m[this.windSpec.fields.flap] = 0;
        this.windFrom.set(a.position.x, m[this.windSpec.fields.altitude] ?? 0, a.position.z);
        this.windDelta.copy(this.windTarget).sub(this.windFrom);
        const L = this.windDelta.length(), step = this.windSpec.stoop.speed * dt;
        this.windPorts.tell.aim(this.windFrom, this.windTarget, this.windSpec.stoop.alpha);
        this.windPorts.tell.chevron(this.windFrom);
        if (L <= step + this.windSpec.stoop.arrival) {
          this.windPorts.tell.hide(); this.windPorts.tell.chevron(null);
          a.position.x = this.windTarget.x; a.position.z = this.windTarget.z;
          if (Math.hypot(p.x - this.windTarget.x, p.z - this.windTarget.z) < this.windSpec.stoop.range && p.y - this.windPorts.heightAt(p.x, p.z) < this.windSpec.stoop.playerHeight) {
            this.windPorts.hurt(a, this.windSpec.stoop.damage); this.windPorts.knock(p.x - this.windFrom.x, p.z - this.windFrom.z);
            this.mode = 'climb'; m[this.windSpec.fields.altitude] = this.windTarget.y + this.windSpec.stoop.climbHeight;
          } else { this.mode = 'ground'; this.windStT = 0; m[this.windSpec.fields.altitude] = this.windPorts.heightAt(a.position.x, a.position.z) + this.windSpec.ground.onScale * a.scale; this.windPorts.grounded(); }
          this.windStoopT = this.windP2 ? this.windSpec.stoop.phaseCooldown + this.windPorts.random() * this.windSpec.stoop.phaseRandom : this.windSpec.stoop.cooldown + this.windPorts.random() * this.windSpec.stoop.randomCooldown;
        } else {
          this.windDelta.multiplyScalar(step / L);
          a.position.x += this.windDelta.x; a.position.z += this.windDelta.z; const altitude = (m[this.windSpec.fields.altitude] ?? 0) + this.windDelta.y; m[this.windSpec.fields.altitude] = altitude; m[this.windSpec.fields.smoothed] = altitude;
          a.yaw = a.desiredYaw = Math.atan2(this.windDelta.x, this.windDelta.z);
      }
        break;
    }
      case 'ground': {
        m[this.windSpec.fields.ground] = 1; m[this.windSpec.fields.fold] = 0; m[this.windSpec.fields.flap] = 0;
        m[this.windSpec.fields.altitude] = this.windPorts.heightAt(a.position.x, a.position.z) + this.windSpec.ground.idleScale * a.scale;
        if (this.windStT > this.windSpec.ground.seconds) { this.mode = 'climb'; m[this.windSpec.fields.ground] = 0; }
        break;
    }
      default: break;
  }
    if (this.mode !== 'tell' && this.mode !== 'stoop') { this.windPorts.tell.hide(); this.windPorts.tell.chevron(null); }
  }
  /** Capture every custom clock and fixed target without events or draws. */
  windSnapshot(): v.InferOutput<typeof WindDiverSaved> { this.requireWind(); return { st: this.windPhase(), stT: this.windStT, stoopT: this.windStoopT, ang: this.angle, centre: [this.windCentre.x, this.windCentre.y, this.windCentre.z], tgt: [this.windTarget.x, this.windTarget.y, this.windTarget.z], overYou: this.windOverPlayer }; }
  /** Validate the complete continuation atomically before mutation. */
  private restoreWind(input: unknown): void { const s = v.parse(WindDiverSaved, input); this.mode = s.st; this.windStT = s.stT; this.windStoopT = s.stoopT; this.angle = s.ang; this.windCentre.fromArray(s.centre); this.windTarget.fromArray(s.tgt); this.windOverPlayer = s.overYou; }
}

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedDiverTuningInput = BoundedDiverTuning;
interface BoundedDiverTuningFields {
    initialCooldown: number;
    lookTurn: number;
    fields: {
        altitude: string;
        smoothed: string;
        flap: string;
        fold: string;
        ground: string;
        bank: string;
    };
    cruise: {
        home: number;
        homePhase2: number;
        player: number;
        playerPhase2: number;
        clearance: number;
        wave: number;
        waveFrequency: number;
        ease: number;
    };
    orbit: {
        windScale: number;
        ease: number;
        radius: number;
        speed: number;
        climbEase: number;
        soarEase: number;
        climbSpeed: number;
        arrival: number;
    };
    pose: {
        initialFlap: number;
        climbFlap: number;
        soarFlap: number;
        waveFlap: number;
        flapFrequency: number;
        bank: number;
        tellFlap: number;
        tellFold: number;
    };
    tell: {
        seconds: number;
        phase2Seconds: number;
        targetHeight: number;
        alpha: number;
        alphaGrowth: number;
    };
    stoop: {
        targetHeight: number;
        speed: number;
        arrival: number;
        alpha: number;
        range: number;
        playerHeight: number;
        damage: number;
        climbHeight: number;
        cooldown: number;
        randomCooldown: number;
        phaseCooldown: number;
        phaseRandom: number;
    };
    ground: {
        onScale: number;
        idleScale: number;
        seconds: number;
        damage: number;
    };
}
type BoundedDiverTuning = { [Key in keyof BoundedDiverTuningFields]: BoundedDiverTuningFields[Key] };
type BoundedDiverSaveInput = BoundedDiverSave;
interface BoundedDiverSaveFields {
    st: "ground" | "tell" | "stoop" | "soar" | "climb";
    stT: number;
    stoopT: number;
    ang: number;
    centre: [
        number,
        number,
        number
    ];
    tgt: [
        number,
        number,
        number
    ];
    overYou: boolean;
}
type BoundedDiverSave = { [Key in keyof BoundedDiverSaveFields]: BoundedDiverSaveFields[Key] };
