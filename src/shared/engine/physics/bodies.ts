/**
 * Items as bodies (PHYSICS.md P7): the small dynamic-body service. Coconuts, the puzzle barrel and whatever else
 * lies about and gets knocked around is a Rapier dynamic body spawned here, with a shape, a material and an owner
 * (queries and plates read the owner back through `tagOf`).
 *
 *   const b = app.bodies?.spawn({ shape: { ball: 0.13 }, material: 'wood', owner: this, expendable: true }, from, vel);
 *   b.pose(bodies.alpha, pos, quat);        // the render pose, interpolated between the last two fixed steps
 *   bodies.remove(b);
 *
 * The service runs in `Game`'s fixed phases (`attach(game)`, wired in bootstrap next to `setActivePhysics`): `pre`
 * keeps each body's last pose (for interpolation) and applies the water's lift to floating things; the world steps;
 * `post` reads the new poses, each body's `impact` (a landing / a knock) and enforces the per-tier cap on AWAKE
 * dynamic bodies (the plan's budget: phone ≤ 40, desktop ≤ 150). Past the cap the body farthest from the player goes
 * first (the older one on a tie): an `expendable` one is removed (its `onRemoved` fires), any other is put to sleep —
 * it wakes again when something touches it. `keep` bodies (the puzzle barrel) are never culled.
 *
 * Sleeping is Rapier's own: a body at rest sleeps and costs nothing until it is touched. Water is not a fluid
 * (§Architecture): a body with `float` gets an upward force per step from how deep it sits under the surface its
 * owner describes (still level + the swell), and a drag while wet.
 */
import type { Collider, RigidBody } from '@dimforge/rapier3d-simd';
import type { Physics } from './Physics';
import { groups } from './groups';
import { tagCollider, untagCollider, type Material } from './surface';
import { floorBelow } from './query';
import { Euler, Quaternion } from 'three';
import { BodySlotsSchema, type BodySlotsData } from '@wildshard/format/bodySlots';
import { parse } from 'valibot';
import type { SimHost } from '../../../server/engine/sim';
import type { Rng } from '../core/rng';
import { terrainHeight, terrainWaterLevel } from '../world/terrainHeight';
import { waveHeight } from '../world/waves';

interface Vec3 { x: number; y: number; z: number }
interface Quat { x: number; y: number; z: number; w: number }

/** Numeric launch laws for aimed bodies and radial loot. Random phases are lent as data by their existing stream owner. */
export type BodyLaunchRow =
  | { readonly kind: 'target'; readonly speed: number; readonly time: readonly [number, number]; readonly gravity: number; readonly rotation: readonly [number, number, number] }
  | { readonly kind: 'radial'; readonly horizontal: number; readonly up: number };

export type BodyShape =
  | { ball: number }
  | { cylinder: { radius: number; halfHeight: number } }
  | { cuboid: Vec3 };

export interface FloatSpec {
  /** the water surface's height at (x, z) now, or undefined where there is no water (dry land, off the sea) */
  surface: (x: number, z: number) => number | undefined;
  /** lift when fully under, in multiples of the body's weight (> 1 floats) */
  buoyancy: number;
  /** extra linear drag while wet (1/s) */
  drag: number;
}

export interface BodySpec {
  shape: BodyShape;
  material: Material;
  owner: unknown;
  /** ITEM (default: the player pushes it, plates feel it) or DEBRIS (the world only) */
  group?: 'ITEM' | 'DEBRIS';
  /** kg/m³ (default 500) */
  density?: number;
  friction?: number;
  restitution?: number;
  linearDamping?: number;
  angularDamping?: number;
  /** rolling resistance (0‥1, like a tyre's): a round body stops rolling on slopes gentler than atan(this) and slows
   *  on the flat — Rapier has none, so a ball or a barrel on its side would otherwise roll forever (sand ~0.1) */
  rolling?: number;
  /** continuous collision (fast, small things: a thrown coconut) */
  ccd?: boolean;
  /** never culled by the cap */
  keep?: boolean;
  /** over the cap it is removed, not put to sleep */
  expendable?: boolean;
  float?: FloatSpec;
  onRemoved?: (b: Body) => void;
}

const GRAVITY = 9.81;
/** the per-tier cap on awake dynamic bodies (PHYSICS.md §Budgets) */
export const BODY_CAP = { phone: 40, desktop: 150 } as const;

export class Body {
  /** the pose at the previous and at the latest fixed step (render interpolates between them) */
  readonly prev = { x: 0, y: 0, z: 0 };
  readonly curr = { x: 0, y: 0, z: 0 };
  readonly prevRot = { x: 0, y: 0, z: 0, w: 1 };
  readonly currRot = { x: 0, y: 0, z: 0, w: 1 };
  /** how hard the last step knocked it: the change of velocity beyond gravity (m/s). A landing, a wall, a kick. */
  impact = 0;
  /** the hardest knock since the owner last called `takeImpact()` (a frame can hold several steps) */
  private peak = 0;
  /** 0 dry … 1 fully under the surface (bodies with `float`) */
  wet = 0;
  alive = true;
  private readonly lastVel = { x: 0, y: 0, z: 0 };
  /** the half extent below the centre (for the water line) */
  readonly bottom: number;
  /** the angular deceleration (rad/s²) its `rolling` resistance works out to: 0 for none, and for a box */
  readonly rollDecel: number;

  readonly rb: RigidBody;
  readonly collider: Collider;
  readonly spec: BodySpec;
  readonly born: number;
  constructor(rb: RigidBody, collider: Collider, spec: BodySpec, born: number) {
    this.rb = rb; this.collider = collider; this.spec = spec; this.born = born;
    const s = spec.shape;
    this.bottom = 'ball' in s ? s.ball : 'cylinder' in s ? s.cylinder.halfHeight : s.cuboid.y;
    // rolling without slip, a constant spin-down k gives the body a stopping slope of sinθ = k·(I/m r²)·r / g: so for
    // sinθ = c, k = c·g / ((I/m r²)·r) — a solid ball's I/m r² is 0.4, a cylinder's about its axis 0.5
    const c = spec.rolling ?? 0;
    this.rollDecel = c <= 0 ? 0 : 'ball' in s ? c * GRAVITY / (0.4 * s.ball) : 'cylinder' in s ? c * GRAVITY / (0.5 * s.cylinder.radius) : 0;
    this.snap();
  }

  /** the render pose `alpha` (0‥1) of the way from the previous step to the latest one */
  pose(alpha: number, pos: Vec3, rot?: Quat): void {
    const a = this.prev, b = this.curr;
    pos.x = a.x + (b.x - a.x) * alpha; pos.y = a.y + (b.y - a.y) * alpha; pos.z = a.z + (b.z - a.z) * alpha;
    if (rot === undefined) return;
    const p = this.prevRot, q = this.currRot;
    const s = p.x * q.x + p.y * q.y + p.z * q.z + p.w * q.w < 0 ? -1 : 1; // the short way round
    const x = p.x + (q.x * s - p.x) * alpha, y = p.y + (q.y * s - p.y) * alpha, z = p.z + (q.z * s - p.z) * alpha, w = p.w + (q.w * s - p.w) * alpha;
    const n = Math.hypot(x, y, z, w) || 1;
    rot.x = x / n; rot.y = y / n; rot.z = z / n; rot.w = w / n;
  }

  /** put it somewhere, at rest (a leash reset, a key dropped where an enemy fell) — no interpolated slide there */
  teleport(p: Vec3, rot?: Quat): void {
    this.rb.setTranslation(p, true);
    if (rot) this.rb.setRotation(rot, true);
    this.rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.snap();
  }

  /** set its velocity (a throw, a bounce off the player) */
  launch(v: Vec3): void { this.rb.setLinvel(v, true); this.lastVel.x = v.x; this.lastVel.y = v.y; this.lastVel.z = v.z; }

  /** ITEM (the player pushes it, plates feel it) ↔ DEBRIS (the world only: a coconut in flight) */
  setGroup(kind: 'ITEM' | 'DEBRIS'): void { this.collider.setCollisionGroups(groups(kind)); }

  /** hidden rows leave the world (the barrel behind a `showWhen`) */
  setEnabled(on: boolean): void { if (this.rb.isEnabled() !== on) this.rb.setEnabled(on); }

  /** the hardest knock since the last call (m/s), then forget it: a landing sound, a splash */
  takeImpact(): number { const p = this.peak; this.peak = 0; return p; }

  get speed(): number { const v = this.rb.linvel(); return Math.hypot(v.x, v.y, v.z); }

  /** @internal its rolling resistance: the spin it rolls on loses `rollDecel`·dt (to 0, never past it). A cylinder
   *  rolls about its own axis, so only that part of the spin — tipping over and turning are left alone. */
  rollResist(dt: number): void {
    const w = this.rb.angvel(), d = this.rollDecel * dt;
    if ('ball' in this.spec.shape) {
      const n = Math.hypot(w.x, w.y, w.z), k = n <= d ? 0 : 1 - d / n;
      this.rb.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, false);
      return;
    }
    // the cylinder's axis: its local +Y turned by its rotation
    const q = this.rb.rotation();
    const ax = 2 * (q.x * q.y - q.w * q.z), ay = 1 - 2 * (q.x * q.x + q.z * q.z), az = 2 * (q.y * q.z + q.w * q.x);
    const s = w.x * ax + w.y * ay + w.z * az, cut = Math.abs(s) <= d ? s : Math.sign(s) * d;
    this.rb.setAngvel({ x: w.x - ax * cut, y: w.y - ay * cut, z: w.z - az * cut }, false);
  }

  /** prev = curr = the body's pose now */
  private snap(): void {
    const t = this.rb.translation(), q = this.rb.rotation();
    this.curr.x = this.prev.x = t.x; this.curr.y = this.prev.y = t.y; this.curr.z = this.prev.z = t.z;
    this.currRot.x = this.prevRot.x = q.x; this.currRot.y = this.prevRot.y = q.y; this.currRot.z = this.prevRot.z = q.z; this.currRot.w = this.prevRot.w = q.w;
    const v = this.rb.linvel(); this.lastVel.x = v.x; this.lastVel.y = v.y; this.lastVel.z = v.z;
  }

  /** @internal before the step */
  keepPrev(): void {
    const a = this.prev, b = this.curr, p = this.prevRot, q = this.currRot;
    a.x = b.x; a.y = b.y; a.z = b.z; p.x = q.x; p.y = q.y; p.z = q.z; p.w = q.w;
  }

  /** @internal after the step: the new pose and how hard it was knocked */
  read(dt: number): void {
    const t = this.rb.translation(), q = this.rb.rotation(), v = this.rb.linvel(), lv = this.lastVel;
    this.curr.x = t.x; this.curr.y = t.y; this.curr.z = t.z;
    this.currRot.x = q.x; this.currRot.y = q.y; this.currRot.z = q.z; this.currRot.w = q.w;
    const g = GRAVITY * this.rb.gravityScale() * dt;
    this.impact = Math.hypot(v.x - lv.x, v.y - (lv.y - g), v.z - lv.z);
    if (this.impact > this.peak) this.peak = this.impact;
    lv.x = v.x; lv.y = v.y; lv.z = v.z;
  }
}

/** what the service needs of `Game`: its fixed phases and the render interpolation factor */
export interface FixedClock {
  alpha: number;
  onFixed: (phase: 'pre' | 'step' | 'post', fn: (dt: number) => void, label?: string) => void;
}

export class Bodies {
  readonly list: Body[] = [];
  cap: number;
  private steps = 0;
  private clock: FixedClock | null = null;
  private readonly order: Body[] = [];

  /** `focus`: the point the cap keeps bodies near (the player's feet, a live reference); `cap` defaults to the phone's
   *  (bootstrap passes the device tier's). Renderer-free: a headless runtime runs its own service over its host's world. */
  readonly focus: Vec3;

  readonly physics: Physics;
  constructor(physics: Physics, focus?: Vec3, cap: number = BODY_CAP.phone) {
    this.physics = physics;
    this.focus = focus ?? { x: 0, y: 0, z: 0 };
    this.cap = cap;
  }

  /** run in the game's fixed phases; `alpha` comes from its clock from now on */
  attach(game: FixedClock): this {
    this.clock = game;
    game.onFixed('pre', (dt) => { this.pre(dt); }, 'physics.bodies.pre');
    game.onFixed('post', (dt) => { this.post(dt); }, 'physics.bodies.post');
    return this;
  }

  /** 0‥1: the render's place between the last two fixed steps (1 with no clock: the latest pose) */
  get alpha(): number { return this.clock?.alpha ?? 1; }

  spawn(spec: BodySpec, at: Vec3, vel?: Vec3, rot?: Quat): Body {
    const { R, world } = this.physics;
    const desc = R.RigidBodyDesc.dynamic().setTranslation(at.x, at.y, at.z)
      .setLinearDamping(spec.linearDamping ?? 0).setAngularDamping(spec.angularDamping ?? 0.05)
      .setCcdEnabled(spec.ccd ?? false);
    if (rot) desc.setRotation(rot);
    if (vel) desc.setLinvel(vel.x, vel.y, vel.z);
    const rb = world.createRigidBody(desc);
    const s = spec.shape;
    const shape = 'ball' in s ? R.ColliderDesc.ball(s.ball)
      : 'cylinder' in s ? R.ColliderDesc.cylinder(s.cylinder.halfHeight, s.cylinder.radius)
        : R.ColliderDesc.cuboid(s.cuboid.x, s.cuboid.y, s.cuboid.z);
    shape.setDensity(spec.density ?? 500).setFriction(spec.friction ?? 0.6).setRestitution(spec.restitution ?? 0.1)
      .setCollisionGroups(groups(spec.group ?? 'ITEM'));
    const collider = world.createCollider(shape, rb);
    tagCollider(collider, spec.material, spec.owner);
    const b = new Body(rb, collider, spec, this.steps);
    this.list.push(b);
    return b;
  }

  remove(b: Body): void {
    if (!b.alive) return;
    b.alive = false;
    const i = this.list.indexOf(b);
    if (i !== -1) this.list.splice(i, 1);
    untagCollider(b.collider);
    this.physics.world.removeRigidBody(b.rb);
    b.spec.onRemoved?.(b);
  }

  /** awake dynamic bodies right now (what the cap counts) */
  get awake(): number {
    let n = 0;
    for (const b of this.list) if (b.rb.isEnabled() && !b.rb.isSleeping()) n++;
    return n;
  }

  /** before the world steps: keep the last pose; rolling things lose spin; the water lifts what floats */
  pre(dt: number = 1 / 60): void {
    for (const b of this.list) {
      b.keepPrev();
      if (b.rollDecel > 0 && b.rb.isEnabled() && !b.rb.isSleeping()) b.rollResist(dt);
      const f = b.spec.float;
      if (f === undefined || !b.rb.isEnabled()) continue;
      const t = b.rb.translation(), s = f.surface(t.x, t.z);
      const wet = s === undefined ? 0 : Math.min(1, Math.max(0, (s - (t.y - b.bottom)) / (2 * b.bottom)));
      if (wet === 0 && b.wet === 0) continue;
      b.wet = wet;
      b.rb.resetForces(false);
      if (wet === 0) continue;
      const m = b.rb.mass(), v = b.rb.linvel(), k = m * f.drag * wet;
      b.rb.addForce({ x: -v.x * k, y: m * GRAVITY * f.buoyancy * wet - v.y * k, z: -v.z * k }, true);
    }
  }

  /** after the world stepped: the new poses, the knocks, and the cap */
  post(dt: number): void {
    this.steps++;
    let awake = 0;
    for (const b of this.list) {
      if (!b.rb.isEnabled() || b.rb.isSleeping()) { b.impact = 0; continue; }
      b.read(dt);
      awake++;
    }
    if (awake > this.cap) this.cull(awake - this.cap);
  }

  /** put `n` awake bodies out of the way: the farthest from the focus first, the older on a tie */
  private cull(n: number): void {
    const o = this.order, f = this.focus;
    o.length = 0;
    for (const b of this.list) if (b.spec.keep !== true && b.rb.isEnabled() && !b.rb.isSleeping()) o.push(b);
    const d2 = (b: Body): number => (b.curr.x - f.x) ** 2 + (b.curr.y - f.y) ** 2 + (b.curr.z - f.z) ** 2;
    o.sort((a, b) => d2(b) - d2(a) || a.born - b.born);
    for (let i = 0; i < n && i < o.length; i++) {
      const b = o[i];
      if (b === undefined) break;
      if (b.spec.expendable === true) this.remove(b);
      else { b.rb.sleep(); b.impact = 0; }
    }
    o.length = 0;
  }

  dispose(): void {
    for (const b of this.list.slice()) this.remove(b); // remove() edits the list
  }
}

// ── drops (PHYSICS P7-L2): a thing that falls out of something, lands, and lies there ────────────────────────────────

/** Bounded native-body lifecycle coefficients; collision/spawning remain the Bodies service's. */
export interface DynamicBodySlotsRow {
  readonly count: number; readonly clocks: 'f32' | 'number'; readonly initial: 1 | 2;
  readonly restSpeed: number; readonly restTime: number; readonly maxAge: number; readonly inclusive: boolean;
  readonly landing?: {readonly impact: number; readonly timeout: number; readonly wet: boolean; readonly clearDistance: number};
}
/** Native continuation keeps handles, float state, source indices and the round-robin cursor. */
export interface DynamicBodySlotData { k: number; state: number; rest: number; age: number; thrower: number; handle: number; wet: number }
export interface DynamicBodySlotsPorts<T> {
  readonly bodies: () => Bodies | null; readonly spec: (slot: number) => BodySpec;
  readonly removed?: (slot: number, body: Body) => void;
  readonly retired?: (slot: number, body: Body) => void;
  /** Borrows this step's player pose. True means contact/bounce consumed the slot's draw this frame. */
  readonly contact?: (body: Body, source: T | null, at: Vec3, player: Vec3 | null) => boolean;
  readonly landed?: (body: Body, at: Vec3, age: number) => void;
}
/** One body slot owner for volleys and tossed loot. No fixed phase, collider or Rapier service is installed here. */
export class DynamicBodySlots<T> {
  private readonly launchVelocity = { x: 0, y: 0, z: 0 };
  private readonly launchRotation = new Quaternion();
  private readonly launchEuler = new Euler();
  /** Evaluate the same bounded launch data for both a body volley and a tossed pickup. No RNG is advanced here. */
  static velocity(row: BodyLaunchRow, from: Vec3, to: Vec3, phase: number, out: Vec3): void {
    if (!Number.isFinite(phase)) throw new RangeError('Invalid body launch phase');
    if (row.kind === 'radial') {
      if (![row.horizontal, row.up].every(Number.isFinite)) throw new RangeError('Invalid radial body launch');
      out.x = Math.sin(phase) * row.horizontal; out.y = row.up; out.z = Math.cos(phase) * row.horizontal;
    } else {
      if (!(row.speed > 0) || !(row.time[0] > 0) || row.time[1] < row.time[0]
        || ![row.speed, ...row.time, row.gravity, ...row.rotation].every(Number.isFinite)) throw new RangeError('Invalid aimed body launch');
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
      const time = Math.max(row.time[0], Math.min(row.time[1], Math.hypot(dx, dz) / row.speed));
      out.x = dx / time; out.y = dy / time + 0.5 * row.gravity * time; out.z = dz / time;
    }
  }
  private readonly body: (Body | null)[];
  private readonly state: Int8Array;
  private readonly rest: Float32Array | number[];
  private readonly age: Float32Array | number[];
  private readonly source: (T | null)[];
  private readonly gone: Uint8Array;
  private next = 0;
  private readonly row: DynamicBodySlotsRow;
  private readonly ports: DynamicBodySlotsPorts<T>;
  constructor(row: DynamicBodySlotsRow, ports: DynamicBodySlotsPorts<T>) {
    if (!Number.isInteger(row.count) || row.count < 1 || row.count > 128
      || ![row.restSpeed,row.restTime,row.maxAge,...(row.landing ? [row.landing.impact,row.landing.timeout,row.landing.clearDistance] : [])].every(value=>Number.isFinite(value)&&value>=0)) throw new RangeError('Invalid dynamic body slots row');
    this.row = row; this.ports = ports;
    this.body = Array.from({length:row.count},():Body|null=>null); this.source = Array.from({length:row.count},():T|null=>null);
    this.state = new Int8Array(row.count); this.gone = new Uint8Array(row.count);
    this.rest = row.clocks === 'f32' ? new Float32Array(row.count) : Array.from({length:row.count},()=>0);
    this.age = row.clocks === 'f32' ? new Float32Array(row.count) : Array.from({length:row.count},()=>0);
  }
  private spec(k: number): BodySpec {
    const spec = this.ports.spec(k);
    return {...spec,onRemoved:body=>{
      if (this.body[k] !== body) return;
      this.body[k] = null; this.state[k] = 0; this.gone[k] = 1;
      spec.onRemoved?.(body); this.ports.removed?.(k,body);
    }};
  }
  bodyAt(k: number): Body | null { return this.body[k] ?? null; }
  /** Reuse the next slot before spawning; caller retains the original launch/spin law. */
  spawn(from: Vec3, velocity: Vec3, rotation?: Quat, source: T | null = null): Body | null {
    const bodies = this.ports.bodies(); if (bodies === null) return null;
    const k = this.next; this.next = (k+1)%this.row.count; this.free(k);
    const body = bodies.spawn(this.spec(k),from,velocity,rotation);
    this.body[k] = body; this.state[k] = this.row.initial; this.rest[k] = 0; this.age[k] = 0; this.source[k] = source;
    return body;
  }
  /** Launch coefficients own velocity and initial orientation; the caller keeps draw order and post-spawn angular velocity. */
  launch(row: BodyLaunchRow, from: Vec3, to: Vec3, phase: number, source: T | null = null): Body | null {
    DynamicBodySlots.velocity(row, from, to, phase, this.launchVelocity);
    const rotation = row.kind === 'target' ? this.launchRotation.setFromEuler(this.launchEuler.set(
      phase * row.rotation[0], phase * row.rotation[1], phase * row.rotation[2])) : undefined;
    return this.spawn(from, this.launchVelocity, rotation, source);
  }
  free(k: number): void {
    const body = this.bodyAt(k); this.body[k] = null; this.state[k] = 0; this.gone[k] = 1;
    if (body !== null) this.ports.bodies()?.remove(body);
  }
  dispose(): void { for(let k=0;k<this.row.count;k++)this.free(k); }
  /** Read after the caller's unchanged fixed/world step; scratch and drawing are borrowed. */
  step<P extends Vec3>(dt: number, alpha: number, player: Vec3 | null, at: P, rotation?: Quat, draw?: (k:number,at:P|null)=>void): boolean {
    let drew = false;
    for(let k=0;k<this.row.count;k++) {
      const state = this.state[k], body = this.bodyAt(k);
      if (state === 0 || body === null) { if(this.gone[k] === 1){this.gone[k]=0;drew=true;draw?.(k,null);}continue; }
      this.gone[k] = 0; body.pose(alpha,at,rotation);
      const age = (this.age[k]??0)+dt; this.age[k] = age;
      const landing = this.row.landing;
      if(state === 1) {
        if(this.ports.contact?.(body,this.source[k]??null,at,player)) {this.state[k]=2;this.rest[k]=0;continue;}
        if(landing && (body.takeImpact()>landing.impact || (landing.wet && body.wet>0) || age>landing.timeout)) {
          this.ports.landed?.(body,at,age); this.state[k]=2;this.rest[k]=0;body.setGroup('ITEM');
        }
      } else {
        if(landing && player && body.collider.collisionGroups()===groups('DEBRIS') && Math.hypot(at.x-player.x,at.z-player.z)>landing.clearDistance)body.setGroup('ITEM');
        const resting = body.rb.isSleeping() || body.speed<this.row.restSpeed;
        this.rest[k] = resting ? (this.rest[k]??0)+dt : 0;
        const rest = this.rest[k]??0;
        if(this.row.inclusive ? rest>=this.row.restTime || age>=this.row.maxAge : rest>this.row.restTime || age>this.row.maxAge) {
          this.free(k);this.ports.retired?.(k,body);this.gone[k]=0;drew=true;draw?.(k,null);continue;
        }
      }
      drew=true;draw?.(k,at);
    }
    return drew;
  }
  snapshot(index:(source:T)=>number):{next:number;slots:{[K in keyof DynamicBodySlotData]:DynamicBodySlotData[K]}[]} {
    const slots:DynamicBodySlotData[]=[];
    for(let k=0;k<this.row.count;k++) {
      const body=this.bodyAt(k),state=this.state[k]??0,source=this.source[k]??null;
      if(state===0||body===null)continue;
      slots.push({k,state,rest:this.rest[k]??0,age:this.age[k]??0,thrower:source===null?-1:index(source),handle:body.rb.handle,wet:body.wet});
    }
    return {next:this.next,slots};
  }
  /** Restore counters first, then reattach the exact saved bodies after the native world replacement. */
  restore(saved:{next:number;slots:readonly DynamicBodySlotData[]},source:(index:number)=>T|null):()=>void {
    if(!Number.isInteger(saved.next)||saved.next<0||saved.next>=this.row.count)throw new Error('Invalid saved body slot cursor');
    const seen=new Set<number>();
    for(const row of saved.slots){if(!Number.isInteger(row.k)||row.k<0||row.k>=this.row.count||seen.has(row.k))throw new Error('Invalid saved body slot');seen.add(row.k);}
    this.next=saved.next;
    for(let k=0;k<this.row.count;k++){this.body[k]=null;this.state[k]=0;this.rest[k]=0;this.age[k]=0;this.source[k]=null;}
    for(const row of saved.slots){this.state[row.k]=row.state;this.rest[row.k]=row.rest;this.age[row.k]=row.age;this.source[row.k]=row.thrower<0?null:source(row.thrower);}
    return ()=>{
      const bodies=this.ports.bodies();if(bodies===null)throw new Error('Saved body slots need their native service');
      for(const row of saved.slots){const world=bodies.physics.world;if(!world.bodies.contains(row.handle))throw new Error('Saved body slot has no native body');
        const rb=world.getRigidBody(row.handle),body=new Body(rb,rb.collider(0),this.spec(row.k),0);body.wet=row.wet;bodies.list.push(body);this.body[row.k]=body;}
    };
  }
}

/** A contact/landing observation, consumed once in slot traversal order. Mechanics never call content. */
export interface BodySlotEvent<T> { readonly kind: 'contact' | 'land'; readonly source: T | null; readonly at: Vec3; readonly age: number; readonly wet: number }
/** Row-owned ball volleys and settling drops over the existing native Bodies authority.
 * Page water uses the installed terrain/sea services; native water uses the actual simulation ground and clock.
 * Restore rebinds existing handles after world replacement, without drawing or creating new bodies. */
export class RowBodySlots<T extends { readonly entityId: string } = never> {
  readonly row: BodySlotsData;
  readonly poses: readonly { readonly at: Vec3; readonly rotation: Quaternion; visible: boolean }[];
  readonly floor: Vec3 = { x: 0, y: 0, z: 0 };
  settled = false;
  private readonly slots: DynamicBodySlots<T>;
  private readonly at: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly rotation = new Quaternion();
  private events: BodySlotEvent<T>[] = [];
  private changed = false;
  private reattach: (() => void) | null = null;
  private service: Bodies | null;
  private readonly physics: Physics | null;
  constructor(input: unknown, service: Bodies | null, owner: unknown,
    physics: Physics | null = service?.physics ?? null, host?: SimHost) {
    this.service = service; this.physics = physics;
    this.row = parse(BodySlotsSchema, input);
    const row = this.row;
    if (row.settle !== undefined && row.count !== 1) throw new Error('Settling body requires one slot');
    this.poses = Array.from({ length: row.count }, () => ({ at: { x: 0, y: 0, z: 0 }, rotation: new Quaternion(), visible: false }));
    const emit = (kind: BodySlotEvent<T>['kind'], source: T | null, at: Vec3, age: number, wet: number): void => {
      this.events.push({ kind, source, at: { ...at }, age, wet });
    };
    this.slots = new DynamicBodySlots<T>(row, {
      bodies: () => this.service,
      spec: () => ({ shape: { ball: row.body.radius }, owner, ...row.body,
        ...(row.float === undefined ? {} : { float: { buoyancy: row.float.buoyancy, drag: row.float.drag, surface: (x: number, z: number) => {
          const level = host === undefined ? terrainWaterLevel() : row.float?.level ?? 0;
          const ground = host === undefined ? terrainHeight(x, z) : host.groundHeightAt(x, z);
          return ground >= level ? undefined : level + (row.float?.waves === true ? waveHeight(x, z, host?.clock.now) : 0);
        } } }),
      }),
      contact: (body, source, at, player) => {
        const contact = row.contact;
        if (contact === undefined) return false;
        if (player === null) throw new Error('Body contact requires the current player pose');
        const y = Math.max(player.y, Math.min(player.y + contact.height, at.y));
        if (!((at.x - player.x) ** 2 + (y - at.y) ** 2 + (at.z - player.z) ** 2 < contact.radius ** 2)) return false;
        emit('contact', source, at, 0, body.wet);
        const velocity = body.rb.linvel(); body.launch({ x: velocity.x * contact.horizontalBounce, y: contact.up, z: velocity.z * contact.horizontalBounce });
        return true;
      },
      landed: (body, at, age) => { emit('land', null, at, age, body.wet); },
      removed: (_slot, body) => { if (row.settle !== undefined && !this.settled) this.settle(body.curr, body); },
      retired: (_slot, body) => { if (row.settle !== undefined) this.settle(body.curr, body); },
    });
  }
  bodyAt(slot: number): Body | null { return this.slots.bodyAt(slot); }
  /** Direct velocity is used by existing tossed pickups; it consumes no random draw. */
  spawn(from: Vec3, velocity: Vec3): Body | null {
    const body = this.slots.spawn(from, velocity);
    this.floor.x = from.x; this.floor.y = from.y - this.row.body.radius; this.floor.z = from.z;
    if (body === null && this.row.settle !== undefined) this.settle(from);
    return body;
  }
  /** The existing stream owns the phase and angular draws, in that order, and only while bodies are available. */
  throw(launch: BodyLaunchRow, from: Vec3, to: Vec3, source: T | null, rng: Rng): void {
    if (this.service === null) return;
    const spin = this.row.spin, phase = spin === undefined ? 0 : rng.range(spin.phase[0], spin.phase[1]);
    const body = this.slots.launch(launch, from, to, phase, source);
    if (body !== null && spin !== undefined) body.rb.setAngvel({ x: rng.range(spin.x[0], spin.x[1]), y: rng.range(spin.y[0], spin.y[1]), z: rng.range(spin.z[0], spin.z[1]) }, true);
  }
  update(dt: number, alpha: number, player: Vec3 | null): boolean {
    const drew = this.slots.step(dt, alpha, player, this.at, this.rotation, (slot, at) => {
      const pose = this.poses[slot]; if (pose === undefined) throw new Error('Missing body pose slot');
      pose.visible = at !== null;
      if (at !== null) {
        Object.assign(pose.at, at); pose.rotation.copy(this.rotation);
        if (this.row.settle !== undefined) { this.floor.x = at.x; this.floor.y = at.y - this.row.body.radius; this.floor.z = at.z; }
      }
    });
    const changed = this.changed; this.changed = false; return drew || changed;
  }
  takeEvents(): readonly BodySlotEvent<T>[] { const events = this.events; this.events = []; return events; }
  snapshot(sources: readonly string[]): ReturnType<DynamicBodySlots<T>['snapshot']> { return this.slots.snapshot(source => sources.indexOf(source.entityId)); }
  restore(saved: Parameters<DynamicBodySlots<T>['restore']>[0], sources: readonly (T | null)[]): void {
    this.reattach = this.slots.restore(saved, index => sources[index] ?? null);
    this.events = []; this.changed = true; for (const pose of this.poses) pose.visible = false;
  }
  bind(service: Bodies | null): void { this.service = service; this.reattach?.(); this.reattach = null; }
  dispose(): void {
    if (this.row.settle !== undefined && !this.settled) this.settle(this.bodyAt(0)?.curr ?? this.floor);
    else this.slots.dispose();
  }
  private settle(at: Vec3, removed?: Body): void {
    this.settled = true;
    const body = removed ?? this.bodyAt(0), { x, y, z } = at;
    this.slots.dispose();
    const below = this.physics === null ? undefined : floorBelow(this.physics, x, z, y, this.row.settle?.depth ?? 0);
    this.floor.x = x; this.floor.z = z; this.floor.y = below ?? (body === null ? y : y - this.row.body.radius);
  }
}

/** a dropped item's body: a small ball that bounces a little and stops rolling soon (DEBRIS: the player walks through
 *  it, it never shoves you); removed by the cap before anything that lasts */
export const DROP_BODY: { readonly shape: { readonly ball: 0.2; }; readonly material: "wood"; readonly group: "DEBRIS"; readonly density: 400; readonly friction: 0.8; readonly restitution: 0.4; readonly angularDamping: 2; readonly rolling: 0.3; readonly ccd: true; readonly expendable: true; } = {
  shape: { ball: 0.2 }, material: 'wood', group: 'DEBRIS', density: 400, friction: 0.8, restitution: 0.4,
  angularDamping: 2, rolling: 0.3, ccd: true, expendable: true,
} as const satisfies Omit<BodySpec, 'owner'>;
/** below this speed (m/s) for DROP_REST_T (s) it has landed; after DROP_MAX_T (s) it has landed whatever it is doing */
const DROP_SLOTS: BodySlotsData = { count: 1, clocks: 'number', initial: 2, restSpeed: .1, restTime: .3, maxAge: 5, inclusive: true,
  body: { radius: DROP_BODY.shape.ball, material: DROP_BODY.material, group: DROP_BODY.group, density: DROP_BODY.density,
    friction: DROP_BODY.friction, restitution: DROP_BODY.restitution, angularDamping: DROP_BODY.angularDamping,
    rolling: DROP_BODY.rolling, ccd: DROP_BODY.ccd, expendable: DROP_BODY.expendable }, settle: { depth: 60 } };

/**
 * A short-lived body for something dropped into the world (a legendary's loot popping out of the carcass): it flies
 * from `from` with `vel`, bounces, settles on whatever is under it (a deck, a rock, the ground), and then the body goes
 * — the thing lies still at its `floor` point from then on and costs the physics nothing.
 *
 *   const drop = new Drop(app.bodies, owner, from, vel);
 *   drop.update(dt);  drop.floor   // per frame: the point under it (interpolated in flight; final once `landed`)
 *
 * With no body service (node, before boot) it lands at once where it starts, on the first surface below `from` if
 * there is a physics world. Culled by the cap in flight, it lands on the surface straight below where it was.
 */
export class Drop {
  /** the point under the thing: the ball's lowest point in flight, the surface it rests on once landed */
  readonly floor: Vec3;
  get landed(): boolean { return this.slots.settled; }
  private readonly slots: RowBodySlots;
  get body(): Body | null { return this.slots.bodyAt(0); }
  private readonly bodies: Bodies | null;
  constructor(bodies: Bodies | null, owner: unknown, from: Vec3, vel: Vec3, physics: Physics | null = bodies?.physics ?? null) {
    this.bodies = bodies;
    this.slots = new RowBodySlots(DROP_SLOTS, bodies, owner, physics); this.floor = this.slots.floor;
    this.slots.spawn(from,vel);
  }

  /** per frame: follow the body; land once it has come to rest (or flown too long). True on the frame it lands. */
  update(dt: number): boolean {
    const b = this.body;
    if (this.landed || b === null) return false;
    this.slots.update(dt,this.bodies?.alpha??1,null);
    return this.landed;
  }

  /** stop now (picked up in flight, the owner disposed) — the body goes */
  dispose(): void { if (!this.landed) this.slots.dispose(); }
}
