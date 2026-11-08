import { Vector3, MathUtils } from 'three';
import type { AnimalPoseLaw } from './animalPose';
import { FlightMotion, type SpeciesFlight } from '../ai/flight';
import type { Actor, DamageRequest, DamageDealt } from '../combat/pipeline';
import type { AnimalDims, Rarity, VariantMods } from './species/registry';
import { tap } from '../core/harnessTap';
import type { ANIMAL_STATES } from './animalStates';

/** Shared behaviour state consumed by simulation and pose adapters. */
export type AnimalState = typeof ANIMAL_STATES[number];
/** Authored creature health, dimensions and motion settings, without a rig. */
export interface AnimalSimSpec {
  kind: string; label: string; variant: string; rarity: Rarity; hp: number; aggressive: boolean;
  dims: AnimalDims; mods: VariantMods; flight?: SpeciesFlight; lockable?: boolean;
}
/** Collision-only displacement port; the creature retains its own feet position. */
export interface AnimalMotor {
  move: (feet: Vector3, want: { x: number; y: number; z: number }, ignoreGround: boolean) => void;
  dispose: () => void;
}
/** Trusted collision-pose owner. It reads only the last published joints, never advances a body or pose.
 * The installer snapshots/restores its publication history through the host adapter alongside this actor. */
export interface AnimalVolumePort {
  readonly entityId: string;
  headWorld: (out: Vector3) => void;
  bodyCapsule: (rear: Vector3, front: Vector3) => void;
  foreCapsule?: (rear: Vector3, front: Vector3) => boolean;
}
/** Per-host world height, time, random stream and optional damage pipeline. */
export interface AnimalSimPorts {
  heightAt: (x: number, z: number) => number;
  floorBelow?: (x: number, z: number, fromY: number, maxDrop: number) => number | undefined;
  now?: () => number;
  random: () => number;
  hit?: (request: DamageRequest) => DamageDealt | null;
  /** The server captures the decision's focused player when a native windup starts. */
  attackStarted?: () => void;
}
/** Mutable presentation sample. A view owns this buffer; sampling never advances authoritative state. */
export interface AnimalPoseSample {
  attackT: number; attackDur: number; groundY: number; tiltRollT: number; stunT: number;
  flinch: number; flinchRoll: number; flinchPitch: number; brace: number; deathSide: number;
}
/** Legacy bolt base damage and range falloff shared by client and simulation. */
export const DAMAGE = { bodyMin: 32, bodyMax: 40, headMul: 2.5, falloffStart: 40, falloffEnd: 90, falloffMin: 0.6 };
/** Sample the legacy bolt formula from an explicit gameplay random source. */
export function damageFor(headshot: boolean, dist: number, random: () => number): number {
  const fall = 1 - (1 - DAMAGE.falloffMin) * MathUtils.clamp((dist - DAMAGE.falloffStart) / (DAMAGE.falloffEnd - DAMAGE.falloffStart), 0, 1);
  const body = (DAMAGE.bodyMin + random() * (DAMAGE.bodyMax - DAMAGE.bodyMin)) * fall;
  return Math.round(headshot ? body * DAMAGE.headMul : body);
}
const STAGGER_PUSH = [0.6, 1.5] as const, STAGGER_STUN = [0.4, 0.8] as const, STAGGER_PUSH_T = 0.25;
interface AnimalSnapshot {
  version: number; id: string;
  motion: { hp: number; maxHp: number; yaw: number; speed: number; herd: number; desiredYaw: number; desiredSpeed: number;
    turnRate: number; lookWeight: number; seed: number; scale: number; strafe: number; desiredStrafe: number; yOffset: number;
    attackT: number; attackDur: number; flinch: number; flinchRoll: number; flinchPitch: number; stunT: number;
    pushT: number; pushDist: number; brace: number; deathT: number; deathSide: number; groundY: number;
    tiltRollT: number; elapsed: number; fallVelocity: number };
  flags: { alive: boolean; harnessHold: boolean; aggressive: boolean; driven: boolean; levelGround: boolean; scripted: boolean; falling: boolean };
  kind: string; variant: string; rarity: Rarity; label: string; state: AnimalState; mods: VariantMods; mem: Record<string, number>;
  position: number[]; lookTarget: number[]; pushDir: number[]; impulse: number[];
  lastHitT: number | null; attackTurnCap: number | null; flight: ReturnType<FlightMotion['snapshot']> | null;
}
const actors = new WeakMap<AnimalSim, Actor>();
const hitHead = new Vector3();

/** Creature state and motion. All world services arrive as ports; there is no scene, rig or active app. */
export class AnimalSim {
  protected readonly flight: FlightMotion | null;
  protected readonly impulseVelocity: Vector3 = new Vector3();
  protected falling = false;
  protected fallVelocity = 0;
  harnessHold = false;
  kind: string; variant: string; rarity: Rarity; label: string; aggressive: boolean;
  mods: VariantMods;
  alive = true;
  hp: number; maxHp: number;
  position: Vector3 = new Vector3();
  yaw = 0; speed = 0; state: AnimalState = 'idle'; herd = 0;
  desiredYaw = 0; desiredSpeed = 0; turnRate = 2.5;
  lastHitT: typeof Infinity = -Infinity;
  lookTarget: Vector3 = new Vector3(); lookWeight = 0;
  seed: number; scale: number;
  strafe = 0; desiredStrafe = 0; yOffset = 0;
  driven = false; levelGround = false;
  groundHeight?: (x: number, z: number, fromY: number) => number;
  mem: Record<string, number> = {};
  protected attackT = -1; protected attackDur = 1;
  attackTurnCap: typeof Infinity = Infinity;
  protected flinch = 0; protected flinchRoll = 0; protected flinchPitch = 0;
  protected stunT = 0; protected pushT = 0; protected pushDist = 0; protected pushDir: Vector3 = new Vector3(); protected brace = 0;
  protected deathT = -1; protected deathSide = 1;
  protected groundY = 0;
  protected tiltRollT = 0;
  scripted = false;
  motor: AnimalMotor | null = null;
  /** Optional physics-owned horizontal constraint, including far creatures and fliers; the mounted driver suspends it. */
  motionConstraint: ((from: Readonly<{ x: number; y: number; z: number }>, to: { x: number; y: number; z: number }) => void) | null = null;
  private readonly motionFrom = { x: 0, y: 0, z: 0 };
  readonly entityId: string;
  protected readonly simSpec: AnimalSimSpec;
  protected readonly simPorts: AnimalSimPorts;
  private volumePort: AnimalVolumePort | null = null;
  private elapsed = 0;
  private readonly moveWant = { x: 0, y: 0, z: 0 };

  constructor(spec: AnimalSimSpec, seed: number, scale: number, entityId: string, ports: AnimalSimPorts) {
    this.simSpec = spec; this.simPorts = ports; this.entityId = entityId;
    this.kind = spec.kind; this.variant = spec.variant; this.rarity = spec.rarity; this.label = spec.label;
    this.aggressive = spec.aggressive; this.mods = { ...spec.mods };
    this.maxHp = this.hp = spec.hp; this.seed = seed; this.scale = scale;
    this.flight = spec.flight === undefined ? null : new FlightMotion(spec.flight);
  }
  get dims(): AnimalDims { return this.simSpec.dims; }
  /** Copy just pose inputs into a reused view buffer, without allocating a snapshot. */
  samplePose(out: AnimalPoseSample): void {
    out.attackT = this.attackT; out.attackDur = this.attackDur; out.groundY = this.groundY;
    out.tiltRollT = this.tiltRollT; out.stunT = this.stunT; out.flinch = this.flinch;
    out.flinchRoll = this.flinchRoll; out.flinchPitch = this.flinchPitch; out.brace = this.brace; out.deathSide = this.deathSide;
  }
  /** Stand as a wire row says (P1-E5.3 I6): a view of a body a server elsewhere runs. Nothing here decides or steps. */
  showRow(row: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly state: AnimalState; readonly attack: number; readonly attackDuration?: number; readonly winding?: boolean; readonly flinch: number; readonly strafe: number; readonly brace: number; readonly hp: number; readonly alive: boolean; readonly rise: number; readonly act: number }, dt: number): void {
    const moved = Math.hypot(row.x - this.position.x, row.z - this.position.z);
    if (dt > 0) this.speed += (Math.min(moved / dt, 20) - this.speed) * Math.min(1, dt * 10);
    this.position.set(row.x, row.y, row.z); this.yaw = row.yaw; this.groundY = row.y; this.hp = row.hp; this.alive = row.alive;
    this.state = row.state; this.attackDur = row.attackDuration ?? 1;
    this.attackT = (row.winding === true || row.attack > 0) ? row.attack * this.attackDur : -1;
    this.flinch = row.flinch; this.strafe = row.strafe; this.brace = row.brace;
    const { mem } = this;
    if (row.rise > 0 || mem['rise'] !== undefined) { mem['rising'] = Number(row.rise > (mem['rise'] ?? 0)); mem['rise'] = row.rise; mem['init'] = 1; }
    if (row.act !== 0 || mem['st'] !== undefined) mem['st'] = row.act;
  }
  /** Full motor/contact continuation; authored ports and rig state remain with the fresh instance. */
  snapshot(): AnimalSnapshot {
    return { version: 1, id: this.entityId,
      motion: { hp: this.hp, maxHp: this.maxHp, yaw: this.yaw, speed: this.speed, herd: this.herd,
        desiredYaw: this.desiredYaw, desiredSpeed: this.desiredSpeed, turnRate: this.turnRate,
        lookWeight: this.lookWeight, seed: this.seed, scale: this.scale, strafe: this.strafe,
        desiredStrafe: this.desiredStrafe, yOffset: this.yOffset, attackT: this.attackT, attackDur: this.attackDur,
        flinch: this.flinch, flinchRoll: this.flinchRoll, flinchPitch: this.flinchPitch, stunT: this.stunT,
        pushT: this.pushT, pushDist: this.pushDist, brace: this.brace, deathT: this.deathT,
        deathSide: this.deathSide, groundY: this.groundY, tiltRollT: this.tiltRollT,
        elapsed: this.elapsed, fallVelocity: this.fallVelocity },
      flags: { alive: this.alive, harnessHold: this.harnessHold, aggressive: this.aggressive, driven: this.driven,
        levelGround: this.levelGround, scripted: this.scripted, falling: this.falling },
      kind: this.kind, variant: this.variant, rarity: this.rarity, label: this.label, state: this.state,
      // Match decoder field order regardless of the authored product's key order.
      mods: { speed: this.mods.speed, chargeDist: this.mods.chargeDist, damageTaken: this.mods.damageTaken,
        chargeDamage: this.mods.chargeDamage, relentless: this.mods.relentless }, mem: { ...this.mem },
      position: this.position.toArray(), lookTarget: this.lookTarget.toArray(), pushDir: this.pushDir.toArray(), impulse: this.impulseVelocity.toArray(),
      lastHitT: this.lastHitT === -Infinity ? null : this.lastHitT,
      attackTurnCap: this.attackTurnCap === Infinity ? null : this.attackTurnCap,
      flight: this.flight?.snapshot() ?? null };
  }
  restore(saved: ReturnType<AnimalSim['snapshot']>): void {
    if (saved.version !== 1 || saved.id !== this.entityId || !Object.values(saved.motion).every(Number.isFinite)
      || !Object.values(saved.flags).every((value) => typeof value === 'boolean')
      || [saved.position, saved.lookTarget, saved.pushDir, saved.impulse].some((vector) => vector.length !== 3 || !vector.every(Number.isFinite))
      || (saved.lastHitT !== null && !Number.isFinite(saved.lastHitT))
      || (saved.attackTurnCap !== null && !Number.isFinite(saved.attackTurnCap))
      || (saved.flight === null) !== (this.flight === null)) throw new RangeError('Invalid creature snapshot');
    if (saved.flight !== null) this.flight?.restore(saved.flight);
    Object.assign(this, saved.motion, saved.flags);
    this.kind = saved.kind; this.variant = saved.variant; this.rarity = saved.rarity; this.label = saved.label; this.state = saved.state;
    this.mods = { ...saved.mods }; this.mem = { ...saved.mem };
    this.position.fromArray(saved.position); this.lookTarget.fromArray(saved.lookTarget);
    this.pushDir.fromArray(saved.pushDir); this.impulseVelocity.fromArray(saved.impulse);
    this.lastHitT = saved.lastHitT ?? -Infinity; this.attackTurnCap = saved.attackTurnCap ?? Infinity;
  }
  get flying(): boolean { return this.flight !== null; }
  get lockable(): boolean { return this.simSpec.lockable ?? this.flying; }
  get lockRange(): number | undefined { return this.simSpec.flight?.lockRange; }
  place(x: number, z: number, yaw: number, y?: number): void {
    this.position.set(x, y ?? this.simPorts.heightAt(x, z), z);
    const flight = this.simSpec.flight;
    if (y === undefined && flight !== undefined) this.position.y = flight.altitude + (flight.above === 'world' ? 0 : this.position.y);
    this.groundY = this.position.y; this.falling = false; this.fallVelocity = 0;
    this.yaw = this.desiredYaw = yaw;
  }
  setMotion(desiredYaw: number, desiredSpeed: number, turnRate = 2.5): void { this.desiredYaw = desiredYaw; this.desiredSpeed = desiredSpeed; this.turnRate = turnRate; }
  impulse(velocity: Vector3): void {
    if (![velocity.x, velocity.y, velocity.z].every(Number.isFinite)) throw new Error('Creature impulse must be finite');
    if (!this.alive) return;
    this.impulseVelocity.add(velocity);
    if (this.flight === null && this.groundHeight === undefined) this.impulseVelocity.y = 0;
  }
  get hasImpulse(): boolean { return this.impulseVelocity.lengthSq() > 0; }
  fly(yaw: number, speed: number, altitude: number, turnRate = 2.5): void {
    if (this.flight === null) throw new Error('Species must declare flight before flying');
    this.flight.target(altitude); this.setMotion(yaw, speed, turnRate);
  }
  setStrafe(mps: number): void { this.desiredStrafe = mps; }
  startAttack(dur: number): void { this.attackT = 0; this.attackDur = Math.max(0.05, dur); this.simPorts.attackStarted?.(); this.attackStarted(this.attackDur); }
  get attackPhase(): number { return this.attackT < 0 ? -1 : Math.min(1, this.attackT / this.attackDur); }
  /** Wrapped body-clock milliseconds at this attack's start. Existing motion checkpoints preserve both clocks. */
  get attackStamp(): number { return this.attackT < 0 ? 0 : Math.round((this.elapsed - this.attackT) * 1000) >>> 0; }
  cancelAttack(): void { this.attackT = -1; }
  get stunned(): boolean { return this.stunT > 0; }
  damageFor(headshot: boolean, dist: number): number { return damageFor(headshot, dist, this.simPorts.random); }
  /** Shared scalar pose clocks after one scheduled body move. Does not move, decide, publish matrices or draw.
   * `advanceAttack` is true only for legacy views that moved through stepMotion rather than step. */
  advancePose(law: AnimalPoseLaw, dt: number, t: number, near: boolean, advanceAttack = false,
    debugGait?: { gait: string; phase: number }): void {
    this.readPoseInputs(law, advanceAttack, debugGait); law.advance(dt, t, near);
    const input = law.input;
    this.speed = input.speed; this.desiredSpeed = input.desiredSpeed; this.attackT = input.attackT;
    this.flinch = input.flinch; this.brace = input.brace; this.deathT = input.deathT;
  }
  /** The existing owner chooses terrain-sampling cadence; this only updates the shared pose targets. */
  samplePoseTerrain(law: AnimalPoseLaw): void {
    this.readPoseInputs(law, false); law.sampleTerrain(this.simPorts.heightAt); this.tiltRollT = law.input.tiltRollT;
  }
  private readPoseInputs(law: AnimalPoseLaw, advanceAttack: boolean, debugGait?: { gait: string; phase: number }): void {
    const i = law.input;
    i.speed = this.speed; i.strafe = this.strafe; i.scale = this.scale; i.seed = this.seed; i.state = this.state; i.alive = this.alive;
    i.position = this.position; i.lookTarget = this.lookTarget; i.yaw = this.yaw; i.lookWeight = this.lookWeight;
    i.flinch = this.flinch; i.flinchRoll = this.flinchRoll; i.flinchPitch = this.flinchPitch; i.brace = this.brace; i.stunT = this.stunT;
    i.deathT = this.deathT; i.deathSide = this.deathSide; i.attackT = this.attackT; i.attackDur = this.attackDur;
    i.groundY = this.groundY; i.tiltRollT = this.tiltRollT; i.levelGround = this.levelGround; i.flying = this.flight !== null;
    i.advanceAttack = advanceAttack; i.desiredSpeed = this.desiredSpeed; i.debugGait = debugGait;
  }
  /** Bind one trusted posed-volume owner before restoring the host. Actor clocks stay with this actor;
   * publication/restore cadence stays with the installer. No callback executes during binding. */
  bindVolumes(port: AnimalVolumePort): void {
    if (this.volumePort !== null || port.entityId !== this.entityId || typeof port.headWorld !== 'function'
      || typeof port.bodyCapsule !== 'function' || (port.foreCapsule !== undefined && typeof port.foreCapsule !== 'function')) {
      throw new Error('Incompatible creature volume binding');
    }
    this.volumePort = port;
  }
  /** Head and body defaults use authored dimensions until a trusted installer binds published posed volumes. */
  headWorld(out: Vector3): Vector3 {
    if (this.volumePort !== null) { this.volumePort.headWorld(out); return out; }
    return out.set(this.position.x + Math.sin(this.yaw) * this.dims.bodyHalfLen * this.scale,
      this.position.y + this.dims.bodyY * this.scale, this.position.z + Math.cos(this.yaw) * this.dims.bodyHalfLen * this.scale);
  }
  /** The optional fore volume is absent until its trusted pose owner supplies one. */
  foreCapsule(rear: Vector3, front: Vector3): boolean { return this.volumePort?.foreCapsule?.(rear, front) ?? false; }
  bodyCapsule(a: Vector3, b: Vector3): void {
    if (this.volumePort !== null) { this.volumePort.bodyCapsule(a, b); return; }
    const d = this.dims, half = d.bodyHalfLen * this.scale;
    const x = d.capsuleAxis === 'y' ? 0 : Math.sin(this.yaw) * half, y = d.capsuleAxis === 'y' ? half : 0, z = d.capsuleAxis === 'y' ? 0 : Math.cos(this.yaw) * half;
    const cy = this.position.y + d.bodyY * this.scale;
    a.set(this.position.x - x, cy - y, this.position.z - z); b.set(this.position.x + x, cy + y, this.position.z + z);
  }
  applyDamage(amount: number, hitPoint: Vector3, dir: Vector3): boolean {
    if (!this.alive) return false;
    return this.simPorts.hit === undefined ? this.applyFinalDamage(amount, hitPoint, dir)
      : this.simPorts.hit({ source: 'env', sourceTags: ['dmg.legacy', 'cover.checked'], target: this.combatActor(), amount, point: hitPoint, dir })?.killed ?? false;
  }
  combatActor(): Actor {
    const cached = actors.get(this); if (cached !== undefined) return cached;
    const read = (): AnimalSim => this;
    const actor: Actor = {
      id: this.entityId, tags: ['actor.creature', `creature.${this.kind}`], state: [],
      get alive() { return read().alive; },
      onDamageRequest: (req) => this.damageRequested(req),
      attributes: { get health() { return read().hp; }, set health(value: number) { read().hp = value; }, get maxHealth() { return read().maxHp; }, get damageTakenMul() { return read().mods.damageTaken; } },
      isHeadshot: (req) => this.headWorld(hitHead).distanceToSquared(req.point) < (this.dims.headRadius * this.scale + 0.06) ** 2,
      ...(this.hasDamageMultiplier() ? { damageMul: (req: DamageRequest) => this.damageMultiplier(req) } : {}),
      applyDamage: (req) => this.applyFinalDamage(req.amount, req.point, req.dir),
    };
    actors.set(this, actor); return actor;
  }
  applyFinalDamage(dealt: number, hitPoint: Vector3, dir: Vector3): boolean {
    if (!this.alive) return false;
    this.hp -= dealt; this.lastHitT = this.hitTime();
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    const lx = dir.x * cos - dir.z * sin, lz = dir.x * sin + dir.z * cos;
    this.flinch = 1; this.flinchRoll = -lx * 0.25;
    this.flinchPitch = -lz * 0.12 + (hitPoint.y - this.position.y > this.dims.bodyY ? 0.05 : -0.03);
    if (this.hp <= 0) {
      this.hp = 0; this.alive = false; this.state = 'dead'; this.deathT = 0; this.deathSide = lx >= 0 ? -1 : 1;
      this.desiredSpeed = 0; tap.kill?.(this.kind); this.died(dealt, hitPoint, dir);
      this.damaged(dealt, hitPoint, dir, true); return true;
    }
    this.damaged(dealt, hitPoint, dir, false); return false;
  }
  stagger(dir: Vector3, strength = 0): void {
    if (!this.alive) return;
    const s = MathUtils.clamp(strength, 0, 1), running = this.speed > 1.5;
    this.pushDist = MathUtils.lerp(STAGGER_PUSH[0], STAGGER_PUSH[1], s) / Math.max(1, this.scale); this.pushT = STAGGER_PUSH_T;
    this.pushDir.set(dir.x, 0, dir.z);
    if (this.pushDir.lengthSq() < 1e-6) this.pushDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).negate(); else this.pushDir.normalize();
    this.stunT = MathUtils.lerp(STAGGER_STUN[0], STAGGER_STUN[1], s); this.brace = 1;
    this.speed = 0; this.desiredSpeed = 0; this.flinch = Math.max(this.flinch, 0.8 + 0.2 * s); this.cancelAttack(); this.staggered(s, running);
  }
  protected attackStarted(_dur: number): void { /* The view may emit a cue. */ }
  protected hitTime(): number { return this.simPorts.now?.() ?? this.elapsed * 1000; }
  /** The harness observes every requested hit and every death here, on the authoritative creature: a view bound to a
   *  host creature (SF3b) forwards its combat to that creature, so a view-side observer would never fire. */
  protected damageRequested(req: DamageRequest): void { tap.hit?.(this.kind, req.amount); }
  protected hasDamageMultiplier(): boolean { return false; }
  protected damageMultiplier(_req: DamageRequest): number { return 1; }
  protected died(_dealt: number, _point: Vector3, _dir: Vector3): void { /* The view may start a corpse pose. */ }
  protected damaged(_dealt: number, _point: Vector3, _dir: Vector3, _died: boolean): void { /* The view may emit blood and sound. */ }
  protected staggered(_strength: number, _running: boolean): void { /* The owner may interrupt AI. */ }
  protected moveBody(want: { x: number; y: number; z: number }): void { this.motor?.move(this.position, want, !this.falling); }
  step(dt: number): void {
    this.stepMotion(dt);
    if (this.attackT >= 0) this.attackT += dt;
  }
  protected stepMotion(dt: number): void {
    this.elapsed += dt;
    const x0 = this.position.x, z0 = this.position.z;
    if (this.motionConstraint !== null) Object.assign(this.motionFrom, this.position);
    if (this.driven) { this.groundY = this.position.y; }
    else if (this.alive && this.stunT > 0) {
      // staggered: no steering, no gait — shoved back along the blow with an ease-out, then held
      this.stunT -= dt; this.speed = 0;
      if (this.pushT > 0) {
        const u0 = 1 - this.pushT / STAGGER_PUSH_T;
        this.pushT = Math.max(0, this.pushT - dt);
        const u1 = 1 - this.pushT / STAGGER_PUSH_T;
        const ease = (u: number) => 1 - (1 - u) * (1 - u);
        const step = this.pushDist * (ease(u1) - ease(u0));
        this.position.x += this.pushDir.x * step; this.position.z += this.pushDir.z * step;
      }
    } else if (this.alive) {
      // heading + speed steering
      let dy = this.desiredYaw - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const maxTurn = (this.attackT >= 0 ? Math.min(this.turnRate, this.attackTurnCap) : this.turnRate) * dt;
      const turn = MathUtils.clamp(dy, -maxTurn, maxTurn);
      this.yaw += turn;
      // a flier rolls into its turn (SpeciesFlight.bank); applyTerrain eases the body toward it
      if (this.flight !== null) this.tiltRollT = this.flight.bank(this.speed, dt > 0 ? turn / dt : 0);
      const accel = this.desiredSpeed > this.speed ? 7 : 11;
      this.speed += MathUtils.clamp(this.desiredSpeed - this.speed, -accel * dt, accel * dt);
      if (this.speed > 0.01) {
        this.position.x += Math.sin(this.yaw) * this.speed * dt;
        this.position.z += Math.cos(this.yaw) * this.speed * dt;
      }
      this.strafe += MathUtils.clamp(this.desiredStrafe - this.strafe, -9 * dt, 9 * dt);
      if (Math.abs(this.strafe) > 0.01) {
        // the animal's left is +X in its frame: world (cos yaw, -sin yaw)
        this.position.x += Math.cos(this.yaw) * this.strafe * dt;
        this.position.z -= Math.sin(this.yaw) * this.strafe * dt;
      }
    } else { this.speed = 0; this.strafe = 0; }

    if (this.alive && this.hasImpulse) {
      this.position.x += this.impulseVelocity.x * dt; this.position.z += this.impulseVelocity.z * dt;
    }

    this.motionConstraint?.(this.motionFrom, this.position);

    // near the player the move goes through the physics body (PHYSICS P6): walls, rocks, trunks, the player and other
    // animals stop it — the walk, the charge and a knock-back alike
    if (this.motor !== null && this.alive && !this.driven && this.flight === null) {
      const dx = this.position.x - x0, dz = this.position.z - z0;
      if (dx !== 0 || dz !== 0) {
        this.position.x = x0; this.position.z = z0;
        const want = this.moveWant; want.x = dx; want.y = 0; want.z = dz;
        this.moveBody(want);
        this.position.y = this.groundY + this.yOffset; // the motor ignores the terrain: the ground follow below owns y
      }
    }

    // ground follow (smoothed so bumps in the heightfield don't jitter the body)
    if (this.flight !== null) {
      this.flight.step(dt, this.position, this.alive, (x, z, fromY, maxDrop) => this.simPorts.floorBelow === undefined ? this.simPorts.heightAt(x, z) : this.simPorts.floorBelow(x, z, fromY, maxDrop));
      this.groundY = this.position.y;
    } else if (!this.driven) {
      const gy = this.groundHeight?.(this.position.x, this.position.z, this.groundY + 1) ?? this.simPorts.heightAt(this.position.x, this.position.z);
      // A WORLD deck ending is a fall, not a heightfield bump. Legacy analytic bodies keep their exact smoothing.
      if (this.groundHeight !== undefined && (this.falling || this.groundY - gy > 1)) {
        this.falling = true;
        this.fallVelocity += this.impulseVelocity.y; this.impulseVelocity.y = 0;
        const next = this.groundY + this.fallVelocity * dt - 10 * dt * dt;
        this.fallVelocity -= 20 * dt;
        if (this.fallVelocity <= 0 && next <= gy) {
          this.groundY = gy; this.falling = false; this.fallVelocity = 0;
        } else this.groundY = next;
      } else this.groundY += (gy - this.groundY) * Math.min(1, dt * 12);
      this.position.y = this.groundY + this.yOffset;
    }

    if (this.alive && this.hasImpulse) {
      if (this.flight !== null) this.position.y += this.impulseVelocity.y * dt;
      this.impulseVelocity.multiplyScalar(Math.exp(-3.5 * dt));
      if (this.impulseVelocity.lengthSq() < 0.05) this.impulseVelocity.set(0, 0, 0);
    } else if (!this.alive) this.impulseVelocity.set(0, 0, 0);

  }
}
