import { MathUtils, Vector3 } from 'three';
import * as schema from 'valibot';
import type { AnimalState } from './AnimalSim';
import type { AnimalDims } from './species/registry';

/** Numeric inputs to the shipping gait/overlay law. The caller owns body motion and these sampled clocks. */
export interface AnimalPoseInput {
  speed: number; strafe: number; scale: number; seed: number; state: AnimalState; alive: boolean;
  position: Readonly<{x:number;y:number;z:number}>; lookTarget: Readonly<{x:number;y:number;z:number}>;
  yaw: number; lookWeight: number; flinch: number; flinchRoll: number; flinchPitch: number;
  brace: number; stunT: number; deathT: number; deathSide: number; attackT: number; attackDur: number;
  groundY: number; tiltRollT: number; levelGround: boolean; flying: boolean;
  advanceAttack: boolean; desiredSpeed: number; debugGait: {gait:string;phase:number}|undefined;
}
/** Existing authored dimensions and pose modifiers; no model, rig, scene or active world. */
export interface AnimalPoseRecipe {
  readonly dims: AnimalDims; readonly custom: boolean;
  readonly gait?: {readonly trot:number;readonly gallop:number};
  readonly pose?: {readonly grazeNeck:number;readonly gallopTail:number};
}
// pose parameter indices
const P_BODY_Y = 0, P_BODY_PITCH = 1, P_BODY_ROLL = 2;
const P_NECK1 = 4, P_NECK2 = 5, P_HEAD_P = 6, P_HEAD_Y = 7, P_NECK_Y = 8;
const P_EARL_P = 9, P_EARL_Y = 10, P_EARR_P = 11, P_EARR_Y = 12;
const P_TAIL_P = 13, P_TAIL_Y = 14;
const P_LEG = 15; // + leg*3 (0 upper, 1 mid, 2 lower)   legs: 0 FL, 1 FR, 2 BL, 3 BR
/** Width of the shipping numeric pose-channel buffer. */
export const P_COUNT = 27;

const G_IDLE = 0, G_GRAZE = 1, G_WALK = 2, G_TROT = 3, G_GALLOP = 4;
const GAIT_NAMES: readonly string[] = ['idle', 'graze', 'walk', 'trot', 'gallop'];

interface GaitDef { offsets: [number, number, number, number]; stance: number; amp: number; lift: number; bob: number; pitch: number }
type MovingGait = typeof G_WALK | typeof G_TROT | typeof G_GALLOP;
const MOVING_GAITS: readonly MovingGait[] = [G_WALK, G_TROT, G_GALLOP];
const GAITS: Record<MovingGait, GaitDef> = {
  [G_WALK]: { offsets: [0.25, 0.75, 0.0, 0.5], stance: 0.62, amp: 0.36, lift: 0.9, bob: 0.012, pitch: 0.01 },
  [G_TROT]: { offsets: [0.0, 0.5, 0.5, 0.0], stance: 0.48, amp: 0.45, lift: 1.1, bob: 0.03, pitch: 0.02 },
  [G_GALLOP]: { offsets: [0.55, 0.68, 0.0, 0.12], stance: 0.36, amp: 0.66, lift: 1.5, bob: 0.06, pitch: 0.09 },
};

const smooth01 = (t: number) => t * t * (3 - 2 * t);
const pulse = (t: number, period: number, seed: number, width = 0.12) => {
  // a short unit bump once per `period` seconds at a seeded phase
  const p = ((t + seed * 7.13) / period) % 1;
  return p < width ? Math.sin((p / width) * Math.PI) : 0;
};

const u32 = schema.pipe(schema.number(), schema.integer(), schema.minValue(0), schema.maxValue(0xffffffff));
const bits = (length: number) => schema.pipe(schema.array(u32), schema.length(length));
const PoseStateSchema = schema.strictObject({
  version: schema.literal(1), pose: bits(P_COUNT), tmp: bits(P_COUNT), gaitW: bits(5), gaitTarget: bits(5),
  lastFootPhase: bits(4), footDelta: bits(4), footDeltaT: bits(4), scalars: bits(10), poseFrozen: schema.boolean(),
});
function floats(buffer: Float32Array): number[] { return Array.from(new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.length)); }
function decoded(words: readonly number[]): Float32Array {
  const result = new Float32Array(Uint32Array.from(words).buffer);
  for (const value of result) if (!Number.isFinite(value)) throw new Error('Invalid animal pose continuation');
  return result;
}

/** Renderer-free shipping scalar pose law. Reuses its Float32 buffers; advancement allocates nothing. */
export class AnimalPoseLaw {
  readonly recipe: AnimalPoseRecipe;
  readonly input: AnimalPoseInput = {
    speed:0,strafe:0,scale:1,seed:0,state:'idle',alive:true,position:{x:0,y:0,z:0},lookTarget:{x:0,y:0,z:0},
    yaw:0,lookWeight:0,flinch:0,flinchRoll:0,flinchPitch:0,brace:0,stunT:0,deathT:-1,deathSide:1,
    attackT:-1,attackDur:1,groundY:0,tiltRollT:0,levelGround:false,flying:false,advanceAttack:true,desiredSpeed:0,debugGait:undefined,
  };
  readonly pose: Float32Array<ArrayBuffer>=new Float32Array(P_COUNT);
  private readonly tmp=new Float32Array(P_COUNT);
  readonly gaitW: Float32Array<ArrayBuffer>=new Float32Array(5);
  private readonly gaitTarget=new Float32Array(5);
  readonly lastFootPhase: Float32Array<ArrayBuffer>=new Float32Array(4);
  phase=0;lookAmt=0;tiltPitch=0;tiltRoll=0;tiltPitchT=0;
  readonly footDelta: Float32Array<ArrayBuffer>=new Float32Array(4);
  readonly footDeltaT: Float32Array<ArrayBuffer>=new Float32Array(4);
  poseFrozen=false;
  onFootfall: ((strength:number)=>void)|undefined;
  private readonly look=new Vector3();
  constructor(recipe:AnimalPoseRecipe) {this.recipe=recipe;this.gaitW[G_IDLE]=1;}
  /** Copy owned blend/terrain history, preserving Float32 and signed-zero bits. Actor clocks remain actor-owned. */
  snapshot(): string {
    const scalars: number[] = [], bytes = new DataView(new ArrayBuffer(8));
    for (const value of [this.phase, this.lookAmt, this.tiltPitch, this.tiltRoll, this.tiltPitchT]) {
      if (!Number.isFinite(value)) throw new Error('Invalid animal pose continuation');
      bytes.setFloat64(0, value); scalars.push(bytes.getUint32(0), bytes.getUint32(4));
    }
    return JSON.stringify({ version: 1, pose: floats(this.pose), tmp: floats(this.tmp), gaitW: floats(this.gaitW), gaitTarget: floats(this.gaitTarget),
      lastFootPhase: floats(this.lastFootPhase), footDelta: floats(this.footDelta), footDeltaT: floats(this.footDeltaT), scalars, poseFrozen: this.poseFrozen });
  }
  /** Strict bounded atomic restore. Does not sample terrain, advance clocks, emit footsteps or consume RNG. */
  restore(value: string): void {
    if (value.length > 8192) throw new Error('Invalid animal pose continuation');
    const raw: unknown = JSON.parse(value), state = schema.parse(PoseStateSchema, raw);
    const pose = decoded(state.pose), tmp = decoded(state.tmp), gaitW = decoded(state.gaitW), gaitTarget = decoded(state.gaitTarget),
      lastFootPhase = decoded(state.lastFootPhase), footDelta = decoded(state.footDelta), footDeltaT = decoded(state.footDeltaT),
      scalars: number[] = [], bytes = new DataView(new ArrayBuffer(8));
    for (let i = 0; i < state.scalars.length; i += 2) {
      const high = state.scalars[i], low = state.scalars[i + 1];
      if (high === undefined || low === undefined) throw new Error('Invalid animal pose continuation');
      bytes.setUint32(0, high); bytes.setUint32(4, low); const scalar = bytes.getFloat64(0);
      if (!Number.isFinite(scalar)) throw new Error('Invalid animal pose continuation'); scalars.push(scalar);
    }
    const [phase, lookAmt, tiltPitch, tiltRoll, tiltPitchT] = scalars;
    if (phase === undefined || lookAmt === undefined || tiltPitch === undefined || tiltRoll === undefined || tiltPitchT === undefined) throw new Error('Invalid animal pose continuation');
    this.pose.set(pose); this.tmp.set(tmp); this.gaitW.set(gaitW); this.gaitTarget.set(gaitTarget); this.lastFootPhase.set(lastFootPhase);
    this.footDelta.set(footDelta); this.footDeltaT.set(footDeltaT);
    this.phase = phase; this.lookAmt = lookAmt; this.tiltPitch = tiltPitch; this.tiltRoll = tiltRoll; this.tiltPitchT = tiltPitchT; this.poseFrozen = state.poseFrozen;
  }
  private get attackPhase():number{return this.input.attackT<0?-1:Math.min(1,this.input.attackT/this.input.attackDur);}

  /** Same ordering/rounding as AnimalView: gait, overlays, terrain; the caller applies bones afterward. */
  advance(dt:number,t:number,near:boolean):void {
    this.poseFrozen=false;
    const d=this.recipe.dims;
    // gait weights from speed
    const gw = this.gaitTarget;
    gw.fill(0);
    const s = Math.hypot(this.input.speed, this.input.strafe) / this.input.scale;
    if (this.input.debugGait) {
      const gi = GAIT_NAMES.indexOf(this.input.debugGait.gait);
      this.gaitW.fill(0); this.gaitW[Math.max(0, gi)] = 1; this.phase = this.input.debugGait.phase;
      if (this.input.advanceAttack) { this.input.speed = 0; this.input.desiredSpeed = 0; }
      gw.set(this.gaitW);
    } else if (!this.input.alive) { gw[G_IDLE] = 1; }
    else if (s < 0.15) { if (this.input.state === 'graze') gw[G_GRAZE] = 1; else gw[G_IDLE] = 1; }
    else if (s < (this.recipe.gait?.trot ?? 2.4)) { const k = MathUtils.clamp((s - 0.15) / 0.6, 0, 1); gw[G_WALK] = k; gw[this.input.state === 'graze' ? G_GRAZE : G_IDLE] = 1 - k; }
    else if (s < (this.recipe.gait?.gallop ?? 4.6)) { const k = MathUtils.clamp((s - (this.recipe.gait?.trot ?? 2.4)) / ((this.recipe.gait?.trot ?? 2.4) * 0.5), 0, 1); gw[G_TROT] = k; gw[G_WALK] = 1 - k; }
    else { const k = MathUtils.clamp((s - (this.recipe.gait?.gallop ?? 4.6)) / ((this.recipe.gait?.gallop ?? 4.6) * 0.3), 0, 1); gw[G_GALLOP] = k; gw[G_TROT] = 1 - k; }
    const bl = Math.min(1, dt * 6);
    const W = this.gaitW;
    let wsum = 0;
    for (let i = 0; i < 5; i++) { W[i] = (W[i] ?? 0) + ((gw[i] ?? 0) - (W[i] ?? 0)) * bl; wsum += W[i] ?? 0; }
    for (let i = 0; i < 5; i++) W[i] = (W[i] ?? 0) / wsum;

    // gait phase: stride frequency from speed so hooves don't slide
    const wWalk = W[G_WALK] ?? 0, wTrot = W[G_TROT] ?? 0, wGallop = W[G_GALLOP] ?? 0;
    const moving = wWalk + wTrot + wGallop;
    if (moving > 0.01 && this.input.alive && !this.input.debugGait) {
      const g = wGallop > 0.5 ? GAITS[G_GALLOP] : wTrot > 0.5 ? GAITS[G_TROT] : GAITS[G_WALK];
      const stride = 2 * d.legLen * Math.sin(g.amp) * this.input.scale * (g === GAITS[G_GALLOP] ? 1.9 : g === GAITS[G_TROT] ? 1.35 : 1.0);
      const freq = Math.max(0.6, Math.hypot(this.input.speed, this.input.strafe) * g.stance / stride);
      this.phase = (this.phase + freq * dt) % 1;
    }
    if (this.input.advanceAttack && this.input.attackT >= 0) this.input.attackT += dt;

    if (!near) {
      if (this.input.flying) this.easeTilt(Math.min(1,dt*5));
      this.poseFrozen=true; return;
    }
    if (this.recipe.custom) {
      // a custom rig: advance the shared timers, then the species poses its own bones
      if (this.input.flinch > 0.001) this.input.flinch *= Math.exp(-dt * 5.5);
      if (this.input.brace > 0.001 && this.input.stunT <= 0) this.input.brace *= Math.exp(-dt * 7);
      if (this.input.deathT >= 0) this.input.deathT = Math.min(1, this.input.deathT + dt / 0.8);
      this.lookAmt += ((this.input.alive ? this.input.lookWeight : 0) - this.lookAmt) * Math.min(1, dt * 4);
      this.applyTerrain(dt);
      return;
    }
    const pose = this.pose;
    pose.fill(0);
    const seed = this.input.seed;
    // ── blended base layers ──
    const wIdle = W[G_IDLE] ?? 0, wGraze = W[G_GRAZE] ?? 0;
    if (wIdle > 0.001) { this.poseIdle(t, seed); this.accumulate(wIdle); }
    if (wGraze > 0.001) { this.poseGraze(t, seed); this.accumulate(wGraze); }
    for (const g of MOVING_GAITS) { const w = W[g] ?? 0; if (w > 0.001) { this.poseGait(GAITS[g], t, seed); this.accumulate(w); } }

    // ── alert look-at (additive) ──
    const lookTarget = this.input.alive ? this.input.lookWeight : 0;
    this.lookAmt += (lookTarget - this.lookAmt) * Math.min(1, dt * 4);
    if (this.lookAmt > 0.001) {
      this.look.subVectors(this.input.lookTarget, this.input.position);
      let ly = Math.atan2(this.look.x, this.look.z) - this.input.yaw;
      ly = Math.atan2(Math.sin(ly), Math.cos(ly));
      ly = MathUtils.clamp(ly, -1.2, 1.2);
      const dist = Math.hypot(this.look.x, this.look.z);
      const lp = MathUtils.clamp(-Math.atan2(this.look.y - d.bodyY * 1.6, dist), -0.5, 0.5);
      this.add(P_NECK_Y, ly * 0.55 * this.lookAmt);
      this.add(P_HEAD_Y, ly * 0.45 * this.lookAmt);
      this.add(P_HEAD_P, lp * this.lookAmt);
      // head up (lifts out of a graze), ears pricked forward, neck raised
      this.blendTo(P_NECK1, -0.15, this.lookAmt); this.blendTo(P_NECK2, -0.05, this.lookAmt);
      this.add(P_HEAD_P, (0.12 - (pose[P_HEAD_P] ?? 0)) * this.lookAmt * 0.8);
      this.add(P_EARL_P, -0.35 * this.lookAmt); this.add(P_EARR_P, -0.35 * this.lookAmt);
      this.add(P_EARL_Y, 0.25 * this.lookAmt); this.add(P_EARR_Y, -0.25 * this.lookAmt);
    }

    // ── hit flinch (additive, decays) ──
    if (this.input.flinch > 0.001) {
      const f = this.input.flinch;
      this.add(P_BODY_ROLL, this.input.flinchRoll * f);
      this.add(P_BODY_PITCH, this.input.flinchPitch * f);
      this.add(P_BODY_Y, -0.06 * f * d.bodyY);
      this.add(P_HEAD_P, 0.35 * f); this.add(P_NECK1, -0.2 * f);
      this.add(P_EARL_P, 0.5 * f); this.add(P_EARR_P, 0.5 * f);
      this.add(P_TAIL_P, -0.6 * f);
      this.input.flinch *= Math.exp(-dt * 5.5);
    }
    // ── stagger brace (held for the stun, then released): hunkered low, nose down, ears pinned, tail clamped ──
    if (this.input.brace > 0.001) {
      const b = smooth01(this.input.brace);
      this.add(P_BODY_Y, -0.14 * b * d.bodyY);
      this.add(P_BODY_PITCH, 0.06 * b);
      this.add(P_NECK1, 0.28 * b); this.add(P_NECK2, 0.12 * b); this.add(P_HEAD_P, 0.25 * b);
      this.add(P_EARL_P, 0.6 * b); this.add(P_EARR_P, 0.6 * b);
      this.add(P_TAIL_P, -0.7 * b);
      for (let l = 0; l < 4; l++) this.add(P_LEG + l * 3 + 1, 0.16 * b);   // knees bent: legs take the shove
      if (this.input.stunT <= 0) this.input.brace *= Math.exp(-dt * 7);
    }

    // ── attack wind-up (the manager's charge telegraph on a melee shard): head down, front low, a front hoof paws ──
    if (this.input.alive && this.input.attackT >= 0) this.poseWindup(t);

    // ── death collapse ──
    if (this.input.deathT >= 0) {
      this.input.deathT = Math.min(1, this.input.deathT + dt / 0.8);
      const k = smooth01(this.input.deathT);
      const side = this.input.deathSide;
      // legs buckle first, then the body rolls onto its side
      const buckle = smooth01(Math.min(1, this.input.deathT * 1.8));
      const roll = smooth01(Math.max(0, (this.input.deathT - 0.25) / 0.75));
      const restY = d.halfWidth * 0.95 - d.bodyY;                 // body bone height when lying on its side
      this.blendTo(P_BODY_Y, restY, k);
      this.blendTo(P_BODY_ROLL, side * (Math.PI / 2 - 0.12), roll);
      this.blendTo(P_BODY_PITCH, 0.05, k);
      this.blendTo(P_NECK1, 0.55 - 0.25 * buckle, k); this.blendTo(P_NECK2, 0.35, k);
      this.blendTo(P_HEAD_P, 0.45, k); this.blendTo(P_HEAD_Y, side * 0.25, k); this.blendTo(P_NECK_Y, side * 0.2, k);
      this.blendTo(P_EARL_P, 0.6, k); this.blendTo(P_EARR_P, 0.6, k); this.blendTo(P_EARL_Y, 0, k); this.blendTo(P_EARR_Y, 0, k);
      this.blendTo(P_TAIL_P, 0.3, k); this.blendTo(P_TAIL_Y, 0, k);
      for (let l = 0; l < 4; l++) {
        const front = l < 2, down = (l % 2 === 0) === (side < 0); // legs on the ground side tuck, top legs drape
        this.blendTo(P_LEG + l * 3, (front ? -0.45 : 0.3) * (down ? 1 : 0.6) + 0.2 * buckle, k);
        this.blendTo(P_LEG + l * 3 + 1, (front ? 0.55 : 0.5) * (down ? 1 : 0.7) * buckle, k);
        this.blendTo(P_LEG + l * 3 + 2, (front ? 0.2 : -0.3) * buckle, k);
      }
    }

    this.applyTerrain(dt);
  }

  /** the charge telegraph, additive on the pose: eased in over the first 30 % of the attack, held, eased out in the last 15 % */
  private poseWindup(t: number): void {
    const ph = this.attackPhase;
    const env = smooth01(Math.min(1, ph / 0.3)) * smooth01(Math.min(1, (1 - ph) / 0.15));
    if (env <= 0.001) return;
    this.add(P_BODY_PITCH, 0.1 * env);                       // nose down, rump up
    this.add(P_BODY_Y, -0.05 * env * this.recipe.dims.bodyY);
    this.add(P_NECK1, 0.45 * env); this.add(P_NECK2, 0.15 * env); this.add(P_HEAD_P, 0.25 * env);
    this.add(P_EARL_P, 0.55 * env); this.add(P_EARR_P, 0.55 * env);  // ears pinned
    this.add(P_TAIL_P, 0.6 * env);                          // tail up
    const paw = Math.max(0, Math.sin(t * 13 + this.input.seed * 5));        // the front-right hoof scrapes back, twice a second
    this.add(P_LEG + 1 * 3, (-0.35 + 0.7 * paw) * env); this.add(P_LEG + 1 * 3 + 1, 0.45 * paw * env);
    this.add(P_LEG + 2 * 3 + 1, 0.12 * env); this.add(P_LEG + 3 * 3 + 1, 0.12 * env);  // hind legs load
  }

  // ── pose generators (write into this.tmp) ────────────────────────────────────────────

  private accumulate(w: number): void { const p = this.pose, t = this.tmp; for (let i = 0; i < P_COUNT; i++) p[i] = (p[i] ?? 0) + (t[i] ?? 0) * w; }
  private add(i: number, v: number): void { this.pose[i] = (this.pose[i] ?? 0) + v; }
  private blendTo(i: number, v: number, k: number): void { const cur = this.pose[i] ?? 0; this.pose[i] = cur + (v - cur) * k; }

  private poseIdle(t: number, seed: number): void {
    const p = this.tmp; p.fill(0);
    const br = Math.sin(t * 1.5 + seed * 3);                        // breathing
    p[P_BODY_Y] = 0.006 * br;
    p[P_BODY_PITCH] = 0.004 * br;
    // slow, wandering head + neck (perlin-ish from summed sines)
    const hy = Math.sin(t * 0.37 + seed) * 0.5 + Math.sin(t * 0.91 + seed * 2.3) * 0.3;
    p[P_NECK_Y] = hy * 0.25; p[P_HEAD_Y] = hy * 0.2;
    p[P_NECK1] = 0.02 * Math.sin(t * 0.53 + seed * 1.7) + 0.05;
    p[P_HEAD_P] = 0.1 + 0.06 * Math.sin(t * 0.71 + seed);
    // ear flicks
    const fl = pulse(t, 4.3, seed), fr = pulse(t, 5.7, seed + 0.5);
    p[P_EARL_Y] = 0.15 + fl * 0.6; p[P_EARR_Y] = -0.15 - fr * 0.6;
    p[P_EARL_P] = fl * 0.3 + 0.05 * Math.sin(t * 1.3 + seed); p[P_EARR_P] = fr * 0.3 + 0.05 * Math.cos(t * 1.1 + seed);
    // tail swish
    const sw = 0.5 + 0.5 * Math.sin(t * 0.29 + seed * 4);
    p[P_TAIL_Y] = Math.sin(t * 3.1 + seed) * 0.45 * sw; p[P_TAIL_P] = 0.08 * Math.sin(t * 1.9);
    // relaxed stance: one hind leg slightly cocked
    const cock = ((seed * 10) | 0) % 2 === 0 ? 2 : 3;
    p[P_LEG + cock * 3 + 1] = 0.12; p[P_LEG + cock * 3] = 0.06;
    p[P_LEG + 0 * 3] = 0.03; p[P_LEG + 1 * 3] = -0.03;
  }

  private poseGraze(t: number, seed: number): void {
    this.poseIdle(t, seed);
    const p = this.tmp;
    const gn = this.recipe.pose?.grazeNeck ?? 1;   // a species sets its own (SpeciesDef.pose: the kit boar's 0.3)
    // head to the ground; deer (grazeNeck 1) need the whole neck down, boars (0.3) only nose down a little
    p[P_NECK1] = 0.35 + 0.85 * gn; p[P_NECK2] = 0.2 + 0.75 * gn; p[P_HEAD_P] = 0.35 + 0.35 * gn;
    p[P_NECK_Y] = (p[P_NECK_Y] ?? 0) * 0.6; p[P_HEAD_Y] = (p[P_HEAD_Y] ?? 0) * 0.4;
    // nibbling
    const nib = Math.sin(t * 6 + seed) * 0.5 + 0.5;
    p[P_HEAD_P] += 0.05 * nib; p[P_HEAD_Y] += 0.08 * Math.sin(t * 2.2 + seed);
    // front legs a touch spread / one forward
    p[P_LEG + 0] = 0.1; p[P_LEG + 3] = -0.06;
    p[P_EARL_Y] = 0.5 + 0.3 * pulse(t, 3.1, seed); p[P_EARR_Y] = -0.5 - 0.3 * pulse(t, 4.4, seed + 0.3);
  }

  private poseGait(g: GaitDef, t: number, seed: number): void {
    const p = this.tmp; p.fill(0);
    const ph = this.phase;
    const gallop = g === GAITS[G_GALLOP], trot = g === GAITS[G_TROT];
    for (let l = 0; l < 4; l++) {
      const lp = (ph + (g.offsets[l] ?? 0)) % 1;
      const front = l < 2;
      let upper: number, mid: number, lower: number;
      if (lp < g.stance) {
        const u = lp / g.stance;
        upper = g.amp * (1 - 2 * u);                                 // foot on the ground sweeping back
        mid = 0.12 * g.lift * Math.sin(u * Math.PI) * 0.35;
        lower = 0.1 * Math.sin(u * Math.PI);
        if (u < 0.08 && (this.lastFootPhase[l] ?? 0) > 0.5) this.onFootfall?.(gallop ? 1 : trot ? 0.6 : 0.35);
        this.lastFootPhase[l] = 0;
      } else {
        const v = (lp - g.stance) / (1 - g.stance);
        upper = -g.amp + 2 * g.amp * smooth01(v);                    // swing forward
        const lift = Math.sin(v * Math.PI) * g.lift;
        mid = lift * (front ? 0.7 : 0.5);
        lower = lift * (front ? 0.3 : -0.35);
        this.lastFootPhase[l] = v;
      }
      // hind legs: hip drives the thigh; stifle/hock fold
      const amp = front ? 1 : 0.85;
      p[P_LEG + l * 3] = upper * amp;
      p[P_LEG + l * 3 + 1] = front ? mid : mid * 0.9;
      p[P_LEG + l * 3 + 2] = lower;
    }
    const beat = gallop ? Math.sin(ph * Math.PI * 2 + 0.6) : Math.sin(ph * Math.PI * 4);
    p[P_BODY_Y] = g.bob * beat;
    p[P_BODY_PITCH] = g.pitch * (gallop ? Math.sin(ph * Math.PI * 2 - 0.3) : beat) * (gallop ? 1 : 0.5);
    // neck counter-motion + head held forward when running
    p[P_NECK1] = (gallop ? 0.25 : trot ? 0.15 : 0.06) - beat * (gallop ? 0.12 : 0.03);
    p[P_NECK2] = gallop ? 0.1 : 0.03;
    p[P_HEAD_P] = (gallop ? -0.05 : 0.15) + beat * (gallop ? 0.08 : 0.02);
    p[P_HEAD_Y] = Math.sin(t * 0.7 + seed) * 0.08;
    // ears back at speed, tail up when fleeing
    p[P_EARL_P] = gallop ? 0.7 : 0.1; p[P_EARR_P] = gallop ? 0.7 : 0.1;
    p[P_EARL_Y] = 0.2; p[P_EARR_Y] = -0.2;
    p[P_TAIL_P] = gallop ? (this.recipe.pose?.gallopTail ?? 1.0) : 0.1 + 0.15 * beat;   // + = raised
    p[P_TAIL_Y] = Math.sin(ph * Math.PI * 2) * 0.15;
  }

  /** Sample the slope under the body (called by the manager at 10 Hz — heightAt is not free). */
  sampleTerrain(heightAt: (x:number,z:number)=>number): void {
    if (this.input.levelGround) { this.tiltPitchT = 0; this.input.tiltRollT = 0; this.footDeltaT.fill(0); return; }
    // a live flier's body follows its own turn (update), not the slope of the ground far below it
    if (this.input.flying && this.input.alive) { this.tiltPitchT = 0; this.footDeltaT.fill(0); return; }
    const d = this.recipe.dims;
    const sin = Math.sin(this.input.yaw), cos = Math.cos(this.input.yaw);
    const L = d.bodyHalfLen * 0.9 * this.input.scale, W = d.halfWidth * this.input.scale;
    const hf = heightAt(this.input.position.x + sin * L, this.input.position.z + cos * L);
    const hb = heightAt(this.input.position.x - sin * L, this.input.position.z - cos * L);
    const hl = heightAt(this.input.position.x + cos * W, this.input.position.z - sin * W);
    const hr = heightAt(this.input.position.x - cos * W, this.input.position.z + sin * W);
    this.tiltPitchT = Math.atan2(hb - hf, 2 * L);
    this.input.tiltRollT = Math.atan2(hl - hr, 2 * W);
    // per-foot delta vs the tilted body plane
    const feet = d.feet;
    for (let i = 0; i < Math.min(4, feet.length); i++) {
      const ft = feet[i];
      if (ft === undefined) continue;
      const fx = ft[0] * this.input.scale, fz = ft[1] * this.input.scale;
      const wx = this.input.position.x + cos * fx + sin * fz, wz = this.input.position.z - sin * fx + cos * fz;
      const planeY = this.input.groundY - Math.tan(this.tiltPitchT) * fz + Math.tan(this.input.tiltRollT) * fx;
      this.footDeltaT[i] = MathUtils.clamp(heightAt(wx, wz) - planeY, -0.35, 0.35);
    }
  }


  private easeTilt(k: number): void {
    this.tiltPitch += (this.tiltPitchT - this.tiltPitch) * k;
    this.tiltRoll += (this.input.tiltRollT - this.tiltRoll) * k;
  }
  private applyTerrain(dt: number): void {
    const k = Math.min(1, dt * 5);
    this.easeTilt(k);
    let minD = 0;
    for (let i = 0; i < 4; i++) {
      this.footDelta[i] = (this.footDelta[i] ?? 0) + ((this.footDeltaT[i] ?? 0) - (this.footDelta[i] ?? 0)) * k;
      minD = Math.min(minD, this.footDelta[i] ?? 0);
    }
    if (!this.input.alive || this.recipe.custom) return;
    const legLen = this.recipe.dims.legLen;
    const p = this.pose;
    // lower the body so the lowest hoof reaches the ground, flex knees for feet on higher ground
    p[P_BODY_Y] = (p[P_BODY_Y] ?? 0) + minD * 0.7;
    for (let i = 0; i < 4; i++) {
      const dlt = (this.footDelta[i] ?? 0) - minD * 0.7;
      if (dlt > 0.005) {
        const f = Math.min(1.2, dlt / legLen) * 1.6;
        this.add(P_LEG + i * 3 + 1, f);                 // knee/hock flex
        this.add(P_LEG + i * 3, (i < 2 ? 0.25 : -0.15) * f);
        this.add(P_LEG + i * 3 + 2, (i < 2 ? 0.2 : -0.35) * f);
      }
    }
  }

}
