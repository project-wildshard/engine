import type { ANIMAL_STATES } from '@wildshard/engine/entities/animalStates';
import { castRay, floorBelow } from '@wildshard/engine/physics/query';
import { MathUtils, Vector3 } from 'three';
import { tagOf } from '@wildshard/engine/physics/surface';
import type { CharacterMotor, MotorOptions } from '@wildshard/engine/physics/CharacterMotor';
import type { Physics } from '@wildshard/engine/physics/Physics';
import * as v from 'valibot';

/** An authored road point in the horizontal plane. */
export type RoadXZ = readonly [number, number];

/** m from a road's centre line the horse still counts as on it (the trails' beds are ~5–7 m wide) */
export const ROAD_REACH = 5.5;
/** the heading must lie within this of the road's line (cos 60°): turned further off it, the rider is leaving the road */
const roadROAD_ALIGN = 0.5;
/** m short of a road's end the follow lets go (the horse coasts down there) */
const roadROAD_END = 3;

/** Nearest aligned road heading and measured lateral distance. */
export interface RoadSteer { yaw: number; off: number }

/**
 * The yaw (animal convention: x = sin, z = cos) toward the point `ahead` m down the nearest road from (x, z) that runs
 * within 60° of `heading` (at a junction the branch across it is skipped), the way `heading` points along it; `off` = the
 * distance to its centre line. Null when no such road is within ROAD_REACH or it ends within `ahead` + roadROAD_END.
 */
export function roadSteer(roads: readonly (readonly RoadXZ[])[], x: number, z: number, heading: number, ahead: number): RoadSteer | null {
  let best = -1, bestSeg = -1, bestT = 0, bestD = ROAD_REACH;
  for (let r = 0; r < roads.length; r++) {
    const pts = roads[r];
    if (pts === undefined) continue;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if (a === undefined || b === undefined) continue;
      const ux = b[0] - a[0], uz = b[1] - a[1], l2 = ux * ux + uz * uz;
      if (l2 < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * ux + (z - a[1]) * uz) / l2));
      const d = Math.hypot(x - (a[0] + ux * t), z - (a[1] + uz * t));
      // only a road the horse runs along: at a junction the branch across its heading is not the one it is on
      if (d < bestD && Math.abs((ux * Math.sin(heading) + uz * Math.cos(heading)) / Math.sqrt(l2)) >= roadROAD_ALIGN) { bestD = d; best = r; bestSeg = i; bestT = t; }
    }
  }
  const pts = roads[best];
  if (pts === undefined) return null;
  const a = pts[bestSeg], b = pts[bestSeg + 1];
  if (a === undefined || b === undefined) return null;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dot = ((b[0] - a[0]) * Math.sin(heading) + (b[1] - a[1]) * Math.cos(heading)) / len;
  if (Math.abs(dot) < roadROAD_ALIGN) return null;
  const dir = dot > 0 ? 1 : -1;
  // walk `ahead` m down the polyline from the foot of the perpendicular, the way the horse faces
  let px = a[0] + (b[0] - a[0]) * bestT, pz = a[1] + (b[1] - a[1]) * bestT;
  let left = ahead + roadROAD_END, seg = bestSeg, aimX = px, aimZ = pz, aimed = false;
  for (;;) {
    const q = dir > 0 ? pts[seg + 1] : pts[seg];
    if (q === undefined) return null;
    const d = Math.hypot(q[0] - px, q[1] - pz);
    if (!aimed && left - roadROAD_END <= d) {
      const u = (left - roadROAD_END) / Math.max(d, 1e-6);
      aimX = px + (q[0] - px) * u; aimZ = pz + (q[1] - pz) * u; aimed = true;
    }
    if (left <= d) break;
    left -= d; px = q[0]; pz = q[1];
    seg += dir;
    if (seg < 0 || seg + 1 >= pts.length) return null;   // the road ends before the look-ahead (+ the margin)
  }
  return { yaw: Math.atan2(aimX - x, aimZ - z), off: bestD };
}

/** half-width of the beat window, in stride phase (±0.16 of a stride ≈ ±70 ms at a gallop's ~2.3 strides a second) */
export const SPUR_WINDOW = 0.16;
/** a tap sooner than this share of a stride after the last one is mashing, not riding the rhythm */
const roadSPUR_MASH = 0.55;
/** strides a good tap keeps the gallop going for (so the next beat's tap lands before it runs out) */
const roadSPUR_LATCH = 1.35;
/** Maximum scored streak and speed boost per beat. */
export const SPUR_MAX_STREAK = 3, SPUR_BOOST_PER = 0.04;

/** The score of a press against the current stride. */
export type SpurTap = 'good' | 'early' | 'off';
const roadSpurState: v.GenericSchema<BoundedRoadSpurSaveInput, BoundedRoadSpurSave> = v.strictObject({ version: v.literal(1), streak: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(SPUR_MAX_STREAK)),
  latchT: v.pipe(v.number(), v.finite(), v.minValue(0)), good: v.pipe(v.number(), v.integer(), v.minValue(0)), lastTap: v.pipe(v.number(), v.finite()) });
/** Restorable rhythm-spur clocks. */
export type RhythmSpurState = v.InferOutput<typeof roadSpurState>;

/** Bounded stride-scored gallop continuation. */
export class RhythmSpur {
  /** good taps in a row (0..SPUR_MAX_STREAK) */
  streak = 0;
  /** s the last good tap still holds the gallop */
  latchT = 0;
  /** good taps this ride (for the HUD / the checks) */
  good = 0;
  private lastTap = -1e9;

  /** a GALLOP press at time `t` (s), the horse's gait `phase` (0..1) and stride `period` (s) */
  tap(t: number, phase: number, period: number): SpurTap {
    const since = t - this.lastTap;
    this.lastTap = t;
    const p = ((phase % 1) + 1) % 1, off = Math.min(p, 1 - p);
    if (since < period * roadSPUR_MASH) { this.streak = 0; this.latchT = 0; return 'early'; }
    if (off > SPUR_WINDOW) { this.streak = 0; this.latchT = 0; return 'off'; }
    this.streak = Math.min(SPUR_MAX_STREAK, this.streak + 1);
    this.latchT = period * roadSPUR_LATCH;
    this.good++;
    return 'good';
  }

  update(dt: number): void {
    if (this.latchT > 0) { this.latchT = Math.max(0, this.latchT - dt); if (this.latchT === 0) this.streak = 0; }
  }

  reset(): void { this.streak = 0; this.latchT = 0; this.lastTap = -1e9; }

  /** The rhythm as flat words (P1-E5.3-D2). */
  captureRide(out: Float64Array, at: number): void { out[at] = this.streak; out[at + 1] = this.latchT; out[at + 2] = this.good; out[at + 3] = this.lastTap; }
  restoreRide(from: ArrayLike<number>, at: number): void { this.streak = from[at] ?? 0; this.latchT = from[at + 1] ?? 0; this.good = from[at + 2] ?? 0; this.lastTap = from[at + 3] ?? -1e9; }

  /** Exact rhythm continuation, including the previous press that makes a rapid repeat count as mashing. */
  snapshot(): RhythmSpurState { return v.parse(roadSpurState, { version: 1, streak: this.streak, latchT: this.latchT, good: this.good, lastTap: this.lastTap }); }
  restore(value: unknown): void { const s = v.parse(roadSpurState, value); this.streak = s.streak; this.latchT = s.latchT; this.good = s.good; this.lastTap = s.lastTap; }

  /** the rhythm is holding the gallop */
  get latched(): boolean { return this.latchT > 0; }
  /** the gallop's speed factor while latched (1 + 4 % a tap in a row, up to +12 %) */
  get boost(): number { return this.latched ? 1 + SPUR_BOOST_PER * this.streak : 1; }
}

/** The controls of one command, as the reins read them. */
export interface ReinsCommand {
  readonly steer?: { readonly keyX: number; readonly keyY: number; readonly stickX: number; readonly stickY: number } | undefined;
  readonly sprint?: boolean | undefined; readonly jump?: boolean | undefined;
}
/** A frame a caller fills per command. */
export type ReinsFrameRow = { -readonly [K in keyof ReinsFrame]: ReinsFrame[K] };
/** What a command is to the reins: the server's one reading, and a page's on the wire (P1-E5.3-D1). */
export function commandReins(frame: ReinsFrameRow, command: ReinsCommand | undefined): void {
  frame.forward = command?.steer?.keyY ?? 0; frame.turn = command?.steer?.keyX ?? 0;
  frame.touchX = command?.steer?.stickX ?? 0; frame.touchY = command?.steer?.stickY ?? 0;
  frame.gallop = command?.sprint === true; frame.jump = command?.jump === true;
}
/** Resolved input and the admitted world queries; the caller owns a persistent frame port. */
export interface ReinsFrame {
  readonly forward: number; readonly turn: number; readonly touchX: number; readonly touchY: number;
  readonly gallop: boolean; readonly jump: boolean; readonly drawing: boolean; readonly moveScale: number;
  readonly phase: number; readonly feet: { readonly x: number; readonly z: number };
  readonly roads: readonly (readonly RoadXZ[])[] | undefined;
  readonly inBounds: (x: number, z: number, margin: number) => boolean;
  readonly refuses: (x: number, z: number) => boolean;
  readonly wet: boolean;
}
/** Mounted gait speeds in metres per second. */
export interface HorseSpeeds { readonly walk: number; readonly trot: number; readonly canter: number; readonly gallop: number }
const reinsSECTOR = 0.38;                 // the stick's forward / back sectors: |y| > 0.38 × its length (~67° either side of up / down)
const reinsPIVOT_SPEED = 0.6, reinsBACK_SPEED = 1.1;   // m/s: the stick beside you from a stand (a turn on the spot), reining back
/** rad/s turn at full rein per gait (between them it blends by speed) — at a gallop 0.62 rad/s = a ~21 m radius */
const reinsTURN = { stand: 1.5, walk: 1.35, trot: 1.1, canter: 0.85, gallop: 0.62 };
const reinsDRAW_TURN = 0.6;               // the rein's turn while you draw (a steadier line to shoot from)
const reinsSKID_MIN = 7, reinsSKID_TIME = 1.2, reinsSKID_TURN = 1.6;
const reinsPANIC_SPEED = 9.5, reinsPANIC_TURN = 2;
const reinsROAD_TURN = 2.2, reinsSTEED_RESUME = 25;

const reinsClamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));
const reinsLerp = (a: number, b: number, t: number): number => (1 - t) * a + t * b;
const reinsAngDiff = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const reinsNum = v.pipe(v.number(), v.finite());
const reinsReinsState: v.GenericSchema<BoundedReinsSaveInput, BoundedReinsSave> = v.strictObject({ version: v.literal(1), steed: v.pipe(reinsNum, v.minValue(0), v.maxValue(100)), winded: v.boolean(), breaking: v.boolean(),
  heading: reinsNum, speed: reinsNum, wUp: reinsNum, grounded: v.boolean(), target: reinsNum, rateIn: reinsNum, turnIn: reinsNum, sector: v.picklist([-1, 0, 1, 2]),
  galloping: v.boolean(), drawing: v.boolean(), jumpWas: v.boolean(), jumpQueued: v.boolean(), cruise: reinsNum, gallopWas: v.boolean(), tapQueued: v.boolean(),
  clock: reinsNum, lastPhase: reinsNum, strideHz: reinsNum, sectorWas: v.picklist([-1, 0, 1, 2]), skidT: reinsNum, panicT: reinsNum, panicRear: reinsNum, panicYaw: reinsNum, jolt: reinsNum,
  onRoad: v.boolean(), beat: v.boolean(), spurFlash: v.pipe(reinsNum, v.integer(), v.minValue(0)), turnLead: reinsNum,
  spur: roadSpurState });
/** Complete reins continuation, including held inputs and rhythm. */
export type MountedReinsState = v.InferOutput<typeof reinsReinsState>;
/** The shipping reins decision law, without input devices, renderer, global app or native resource allocation. */
export class MountedReins {
  steed = 100; winded = false; breaking = false;
  heading = 0; speed = 0; wUp = 0; grounded = true;
  target = 0; rateIn = 0; turnIn = 0; sector = 2;
  galloping = false; drawing = false; jumpWas = false; jumpQueued = false;
  cruise = 0; gallopWas = false; tapQueued = false; clock = 0; lastPhase = 0; strideHz = 2;
  sectorWas = 2; skidT = 0; panicT = 0; panicRear = 0; panicYaw = 0; jolt = 0;
  onRoad = false; beat = false; spurFlash = 0; turnLead = 0;
  readonly spur: RhythmSpur = new RhythmSpur();
  private readonly speeds: HorseSpeeds;
  constructor(speeds: HorseSpeeds) { this.speeds = speeds; }
  /** All decision clocks and queued input edges; physical motor and presentation continuation belong to their drivers. */
  snapshot(): MountedReinsState {
    return v.parse(reinsReinsState, { version: 1, steed: this.steed, winded: this.winded, breaking: this.breaking, heading: this.heading, speed: this.speed,
      wUp: this.wUp, grounded: this.grounded, target: this.target, rateIn: this.rateIn, turnIn: this.turnIn, sector: this.sector,
      galloping: this.galloping, drawing: this.drawing, jumpWas: this.jumpWas, jumpQueued: this.jumpQueued, cruise: this.cruise,
      gallopWas: this.gallopWas, tapQueued: this.tapQueued, clock: this.clock, lastPhase: this.lastPhase, strideHz: this.strideHz,
      sectorWas: this.sectorWas, skidT: this.skidT, panicT: this.panicT, panicRear: this.panicRear, panicYaw: this.panicYaw, jolt: this.jolt,
      onRoad: this.onRoad, beat: this.beat, spurFlash: this.spurFlash, turnLead: this.turnLead, spur: this.spur.snapshot() });
  }
  /** Validate the entire envelope before changing any live clock. */
  restore(value: unknown): void {
    const s = v.parse(reinsReinsState, value);
    if (s.spur.lastTap > s.clock) throw new RangeError('Rhythm press is ahead of the riding clock');
    this.spur.restore(s.spur);
    this.steed = s.steed; this.winded = s.winded; this.breaking = s.breaking; this.heading = s.heading; this.speed = s.speed;
    this.wUp = s.wUp; this.grounded = s.grounded; this.target = s.target; this.rateIn = s.rateIn; this.turnIn = s.turnIn; this.sector = s.sector;
    this.galloping = s.galloping; this.drawing = s.drawing; this.jumpWas = s.jumpWas; this.jumpQueued = s.jumpQueued; this.cruise = s.cruise;
    this.gallopWas = s.gallopWas; this.tapQueued = s.tapQueued; this.clock = s.clock; this.lastPhase = s.lastPhase; this.strideHz = s.strideHz;
    this.sectorWas = s.sectorWas; this.skidT = s.skidT; this.panicT = s.panicT; this.panicRear = s.panicRear; this.panicYaw = s.panicYaw;
    this.jolt = s.jolt; this.onRoad = s.onRoad; this.beat = s.beat; this.spurFlash = s.spurFlash; this.turnLead = s.turnLead;
  }
  read(dt: number, frame: ReinsFrame): void {
    const HORSE_SPEED = this.speeds, drawing = frame.drawing;
    const fwdK = frame.forward, strK = frame.turn;
    const tx = frame.touchX, ty = frame.touchY, stick = Math.hypot(tx, ty);
    const turnIn = reinsClamp(strK + tx, -1, 1);
    const gallopKey = frame.gallop;
    this.wUp = fwdK > 0 ? this.wUp + dt : 0;
    // the stick's sector (8 ways): ahead (within ~67° of up) = go, the gait by how far it is pushed; beside = a collected
    // turn (at most a trot; a pivot on the spot from a stand); behind = rein in, then back up
    const sector = stick > 0.1 ? (ty > reinsSECTOR * stick ? 1 : ty < -reinsSECTOR * stick ? -1 : 0) : fwdK !== 0 ? fwdK : strK !== 0 ? 0 : 2;
    let target = 0;
    if (sector === 1) target = stick > 0.1 ? (stick < 0.45 ? HORSE_SPEED.walk : stick < 0.85 ? HORSE_SPEED.trot : HORSE_SPEED.canter) : this.wUp < 0.9 ? HORSE_SPEED.trot : HORSE_SPEED.canter;
    else if (sector === 0) target = reinsClamp(this.speed, reinsPIVOT_SPEED, HORSE_SPEED.trot);
    else if (sector === -1) target = this.speed > 0.5 ? 0 : -reinsBACK_SPEED * (stick > 0.1 ? Math.min(1, -ty / 0.8) : 1);
    if (sector === 1) this.cruise = target; else if (sector === -1) this.cruise = 0;   // B1: the gait a road keeps
    if (this.steed <= 0) this.winded = true;
    if (this.winded && this.steed >= reinsSTEED_RESUME) this.winded = false;
    // ── B1: the rhythm spur — a GALLOP press scored against the stride (the horse's gait phase; 0 = the downbeat) ──
    this.clock += dt;
    const ph = frame.phase, dph = (ph - this.lastPhase + 1) % 1;
    if (dt > 0 && dph < 0.5) this.strideHz += (dph / dt - this.strideHz) * Math.min(1, dt * 6);
    this.lastPhase = ph;
    const canSpur = this.speed > 6 && sector !== -1 && !this.winded && !this.breaking && this.panicT <= 0;
    const press = this.tapQueued || (gallopKey && !this.gallopWas);
    this.tapQueued = false;
    this.gallopWas = gallopKey;
    this.spur.update(dt);
    if (!canSpur && this.speed < 5) this.spur.reset();
    if (press && canSpur && this.spur.tap(this.clock, ph, 1 / Math.max(0.5, this.strideHz)) === 'good') this.spurFlash++;
    this.beat = canSpur && Math.min(ph, 1 - ph) < SPUR_WINDOW;
    const galloping = (gallopKey || this.spur.latched) && sector !== -1 && !this.winded && !this.breaking;
    if (galloping) target = HORSE_SPEED.gallop * this.spur.boost;
    // ── B1: the skid stop — the reins pulled back at a canter or faster ──
    if (sector === -1 && this.sectorWas !== -1 && this.speed > reinsSKID_MIN && this.grounded && !this.breaking) {
      this.skidT = reinsSKID_TIME; this.jolt = Math.max(this.jolt, 0.35);
    }
    if (sector !== -1) this.skidT = 0;
    this.sectorWas = sector;
    // ── B1: keep to the road — the stick let go on a road: the gait held (GALLOP gallops it), the reins along the road ──
    let turnSteer = turnIn;
    this.onRoad = false;
    const roads = frame.roads;
    if (roads !== undefined && sector === 2 && !this.breaking && frame.moveScale !== 0 && (this.speed > HORSE_SPEED.walk * 0.8 || galloping)) {
      const r = roadSteer(roads, frame.feet.x, frame.feet.z, this.heading, 5 + Math.abs(this.speed) * 0.9);
      if (r !== null) {
        this.onRoad = true;
        if (!galloping) target = Math.max(this.cruise, HORSE_SPEED.walk);
        turnSteer = reinsClamp(-reinsAngDiff(r.yaw, this.heading) * reinsROAD_TURN, -1, 1);
      }
    }
    // ── B1: the panic — rear (from a stand), then bolt away from the scare, deaf to the reins ──
    if (this.panicT > 0) {
      this.panicT = Math.max(0, this.panicT - dt); this.panicRear = Math.max(0, this.panicRear - dt);
      target = this.panicRear > 0 ? 0 : reinsPANIC_SPEED;
      turnSteer = reinsClamp(-reinsAngDiff(this.panicYaw, this.heading) * 2.5, -1, 1);
    }
    if (this.breaking || frame.moveScale === 0) target = 0;                       // the bucking rounds; a boss intro locks the reins
    // (steep ground is the motor's: the horse's climb limit by gait, in step)
    const ahead = 2 + this.speed * 0.4;
    const ax = frame.feet.x + Math.sin(this.heading) * ahead, az = frame.feet.z + Math.cos(this.heading) * ahead;
    if (!frame.inBounds(ax, az, 6)) target = Math.min(target, 0);
    // a line the horse will not cross (the Storm Titan's grass fire): it stops dead and shies
    if (target > 0 && frame.refuses(ax, az)) target = 0;
    // fording: in the river / the brook the horse wades at a walk-trot, swimming (held at FORD_DEPTH) where it is deeper
    const wet = frame.wet;
    if (wet) target = Math.sign(target) * Math.min(Math.abs(target), HORSE_SPEED.walk * 1.6);
    // the jump is an edge: queued until a fixed step takes it
    const jumpDown = frame.jump;
    if (jumpDown && !this.jumpWas && !this.breaking) this.jumpQueued = true;
    this.jumpWas = jumpDown;
    this.target = target; this.turnIn = turnSteer; this.sector = sector; this.galloping = galloping; this.drawing = drawing;
    // the rein's turn (rad/s at full rein by speed, in step): stick right = heading down (animal yaw)
    this.rateIn = this.breaking ? 0 : -turnSteer * (drawing && this.panicT <= 0 ? reinsDRAW_TURN : 1) * (this.skidT > 0 ? reinsSKID_TURN : this.panicT > 0 ? reinsPANIC_TURN : 1);
    // the head leads the turn: the neck swings to the rein first (eased in horse.ts), the body's turn follows it
    this.turnLead = reinsClamp(this.rateIn * this.maxRate() / reinsTURN.stand, -1, 1);
  }
  maxRate(): number {
    const HORSE_SPEED = this.speeds;
    const sp = Math.abs(this.speed);
    return sp < HORSE_SPEED.walk ? reinsLerp(reinsTURN.stand, reinsTURN.walk, sp / HORSE_SPEED.walk)
      : sp < HORSE_SPEED.trot ? reinsLerp(reinsTURN.walk, reinsTURN.trot, (sp - HORSE_SPEED.walk) / (HORSE_SPEED.trot - HORSE_SPEED.walk))
      : sp < HORSE_SPEED.canter ? reinsLerp(reinsTURN.trot, reinsTURN.canter, (sp - HORSE_SPEED.trot) / (HORSE_SPEED.canter - HORSE_SPEED.trot))
      : reinsLerp(reinsTURN.canter, reinsTURN.gallop, Math.min(1, (sp - HORSE_SPEED.canter) / (HORSE_SPEED.gallop - HORSE_SPEED.canter)));
  }

}


/** What a ride reads and writes of the animal under it: a body on the server, a view on a page. */
export interface MountedAnimal {
  readonly position: Vector3; readonly scale: number; readonly mem: Record<string, number>;
  yaw: number; speed: number; state: (typeof ANIMAL_STATES)[number]; levelGround: boolean;
  setMotion: (yaw: number, speed: number, turn: number) => void;
}
/** What a jostle reads of the body it met. */
export interface MountedContact { readonly position: { readonly x: number; readonly z: number }; readonly yaw: number; readonly speed: number }
/** Explicit world queries and contact classification, shared by the page and trusted native host. */
export interface MountedWorld {
  readonly physics: Physics | null;
  readonly heightAt: (x: number, z: number) => number;
  readonly waterLevel: () => number;
  readonly wetAt: ((x: number, z: number) => boolean) | undefined;
  readonly stampede: (owner: unknown, horse: MountedAnimal) => MountedContact | null;
  readonly thrown: () => void;
}
/** Physical rider outputs; camera, HUD and equipment stay with presentation. */
export interface MountedRider {
  readonly position: Vector3; readonly velocity: Vector3;
  onGround: boolean; sprinting: boolean; crouching: boolean; speedFactor: number;
}
const mountSTEED_MAX = 100, mountSTEED_GALLOP = 12, mountSTEED_WALK = 15, mountSTEED_CANTER = 5;
const mountBODY = { length: 2.4, radius: 0.42, step: 0.45, snap: 0.5, kg: 450 };
const mountCLIMB = { walk: 47, gallop: 35 };   // degrees: the steepest ground climbed at a walk → at a full gallop (between: by speed)
const mountGRAVITY = 19.7, mountJUMP_V = 7.7;       // m/s², m/s: a 1.5 m arc over 0.78 s (clears the corral's 1.3 m rail)
const mountJUMP_APEX_T = mountJUMP_V / mountGRAVITY;     // s to the top of the arc (the auto jump takes off this far out, in time)
const mountJOSTLE_CD = 0.45, mountUNSEAT_CLOSING = 9;
const mountTURN_EASE = 4.5;               // 1/s: the turn's rate eases toward the rein (~0.22 s) — no snap, and the head leads it
const mountACCEL = 3.6, mountACCEL_HI = 2.2, mountCOAST = 3.2, mountREIN = 8;   // m/s²: speeding up (the gallop's last gear slower), letting go, reining back
const mountSKID = 16, mountSKID_REAR = 0.28;   // m/s it starts from, m/s² it stops at, s at most, the pivot's rein ×
const mountSTEED_RHYTHM = 2;              // STEED/s a gallop held by the rhythm costs (a held GALLOP: mountSTEED_GALLOP)
const mountFORD_DEPTH = 0.95;             // m of water a horse wades before it swims (its back stays dry)               // rad the saddle view looks down past the player's pitch
const mountAngDiff = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const mountPANIC_REAR_POSE = 0.45;
const mountWORLD = ['WORLD'] as const, mountCREATURE = ['CREATURE'] as const;
const mount_from = { x: 0, y: 0, z: 0 }, mount_dir = { x: 0, y: 0, z: 0 }, mount_want = { x: 0, y: 0, z: 0 };

const mountNum = v.pipe(v.number(), v.finite()), mountPoint = v.tuple([mountNum, mountNum, mountNum]);
const mountBodyState = v.strictObject({ version: v.literal(1), reins: v.unknown(), feet: mountPoint, prevFeet: mountPoint,
  prevHeading: mountNum, yawRate: mountNum, vy: mountNum, onDeck: v.boolean(), swimming: v.boolean(), airT: mountNum,
  blockedT: v.pipe(mountNum, v.minValue(0)), shoveX: mountNum, shoveZ: mountNum, jostleCd: v.pipe(mountNum, v.minValue(0)),
  eyeY: mountNum, bobY: mountNum, gait: v.picklist(['stand', 'walk', 'trot', 'canter', 'gallop']),
  jostles: v.pipe(mountNum, v.integer(), v.minValue(0)), thrownBy: v.nullable(v.literal('stampede')) });

/** The shipping lying PLAYER capsule, including its native deck weight and gait-dependent slope rule. */
export function mountedMotorOptions(scale: number, owner: MountedAnimal): MotorOptions {
  return { radius: mountBODY.radius * scale, height: mountBODY.radius * 2 * scale, length: mountBODY.length * scale,
    step: mountBODY.step * scale, maxClimbDeg: mountCLIMB.walk, snap: mountBODY.snap, group: 'PLAYER',
    blockedBy: ['WORLD', 'CREATURE', 'ITEM'], owner, weight: mountBODY.kg };
}

const RIDE_GAITS = ['stand', 'walk', 'trot', 'canter', 'gallop'] as const;
/** The words of a ride's flat state (`MountedBody.captureRide`). The feet come first, then whether they stand on ground. */
export const RIDE_WORDS = 38;
/** All scalar history needed by the physical motor and rider projection; the capsule belongs to native continuation. */
export interface MountedBodyState {
  readonly version: 1; readonly reins: ReturnType<MountedReins['snapshot']>;
  readonly feet: number[]; readonly prevFeet: number[];
  readonly prevHeading: number; readonly yawRate: number; readonly vy: number;
  readonly onDeck: boolean; readonly swimming: boolean; readonly airT: number; readonly blockedT: number;
  readonly shoveX: number; readonly shoveZ: number; readonly jostleCd: number;
  readonly eyeY: number; readonly bobY: number; readonly gait: 'stand' | 'walk' | 'trot' | 'canter' | 'gallop';
  readonly jostles: number; readonly thrownBy: string | null;
}
/** The actual shipping mounted motor law, renderer-free; its native resources are explicitly installed by the caller. */
export class MountedBody extends MountedReins {

  gait: (typeof RIDE_GAITS)[number] = 'stand';
  jostles = 0; thrownBy: string | null = null;
  motor: CharacterMotor | null = null;
  readonly feet: Vector3 = new Vector3(); readonly prevFeet: Vector3 = new Vector3();
  prevHeading = 0; yawRate = 0; vy = 0; onDeck = false; swimming = false;
  airT = -1; blockedT = 0; shoveX = 0; shoveZ = 0; jostleCd = 0;
  eyeY = 0; bobY = 0;
  private readonly vel = new Vector3();
  private contactHorse: MountedAnimal | null = null; private contactWorld: MountedWorld | null = null;
  private contactHit: MountedContact | null = null;
  private contactResult(): MountedContact | null { return this.contactHit; }
  private readonly contact: Parameters<CharacterMotor['touching']>[2] = c => {
    const world = this.contactWorld, a = this.contactHorse;
    if (world === null || a === null) return true;
    const o = world.stampede(tagOf(c)?.owner, a);
    if (o === null) return true;
    this.contactHit = o; return false;
  };
  private readonly bodySpeeds: HorseSpeeds;
  constructor(bodySpeeds: HorseSpeeds) { super(bodySpeeds); this.bodySpeeds = bodySpeeds; }

  /** Scalar continuation; the native capsule is captured separately and reconnected after world replacement. */
  snapshotBody(): MountedBodyState {
    return { version: 1 as const, reins: this.snapshot(), feet: this.feet.toArray(), prevFeet: this.prevFeet.toArray(),
      prevHeading: this.prevHeading, yawRate: this.yawRate, vy: this.vy, onDeck: this.onDeck, swimming: this.swimming,
      airT: this.airT, blockedT: this.blockedT, shoveX: this.shoveX, shoveZ: this.shoveZ, jostleCd: this.jostleCd,
      eyeY: this.eyeY, bobY: this.bobY, gait: this.gait, jostles: this.jostles, thrownBy: this.thrownBy };
  }
  /** Refuse malformed history atomically, before changing any live reins or feet. */
  restoreBody(value: unknown): void {
    const s = v.parse(mountBodyState, value), checked = new MountedReins(this.bodySpeeds);
    checked.restore(s.reins);
    this.restore(s.reins); this.feet.fromArray(s.feet); this.prevFeet.fromArray(s.prevFeet);
    this.prevHeading = s.prevHeading; this.yawRate = s.yawRate; this.vy = s.vy; this.onDeck = s.onDeck; this.swimming = s.swimming;
    this.airT = s.airT; this.blockedT = s.blockedT; this.shoveX = s.shoveX; this.shoveZ = s.shoveZ; this.jostleCd = s.jostleCd;
    this.eyeY = s.eyeY; this.bobY = s.bobY; this.gait = s.gait; this.jostles = s.jostles; this.thrownBy = s.thrownBy;
  }

  /**
   * The ride as flat words (P1-E5.3-D2): everything the next read and step take from the last, for a predictor's ring and the
   * owner block. No valibot and no allocation: it runs per command. `eyeY`, `bobY` and `jolt` are the view's, and what a read
   * writes before its step reads it (`target`, `rateIn`, `sector`, `galloping`) is not state. `RIDE_FEET` and `RIDE_GROUNDED` are
   * what a predictor compares. Its capsule's words are the motor's, and its handles mean nothing on the wire.
   */
  captureRide(out: Float64Array, at: number): void {
    const { feet: f } = this;
    out[at] = f.x; out[at + 1] = f.y; out[at + 2] = f.z; out[at + 3] = Number(this.grounded);
    out[at + 4] = this.heading; out[at + 5] = this.speed; out[at + 6] = this.yawRate; out[at + 7] = this.vy;
    out[at + 8] = this.steed; out[at + 9] = Number(this.winded); out[at + 10] = Number(this.breaking); out[at + 11] = this.wUp; out[at + 12] = this.cruise;
    out[at + 13] = Number(this.gallopWas); out[at + 14] = Number(this.jumpWas); out[at + 15] = Number(this.jumpQueued); out[at + 16] = Number(this.tapQueued);
    out[at + 17] = this.clock; out[at + 18] = this.lastPhase; out[at + 19] = this.strideHz; out[at + 20] = this.sectorWas; out[at + 21] = this.skidT;
    out[at + 22] = this.panicT; out[at + 23] = this.panicRear; out[at + 24] = this.panicYaw; out[at + 25] = this.spurFlash;
    this.spur.captureRide(out, at + 26);
    out[at + 30] = Number(this.onDeck); out[at + 31] = Number(this.swimming); out[at + 32] = this.airT; out[at + 33] = this.blockedT;
    out[at + 34] = this.shoveX; out[at + 35] = this.shoveZ; out[at + 36] = this.jostleCd; out[at + 37] = RIDE_GAITS.indexOf(this.gait);
  }
  /** Put a `captureRide` back, with the capsule where and as it stood. */
  restoreRide(from: ArrayLike<number>, at: number): void {
    const word = (index: number): number => from[at + index] ?? 0, on = (index: number): boolean => word(index) !== 0;
    this.feet.set(word(0), word(1), word(2)); this.grounded = on(3);
    this.heading = word(4); this.speed = word(5); this.yawRate = word(6); this.vy = word(7);
    this.steed = word(8); this.winded = on(9); this.breaking = on(10); this.wUp = word(11); this.cruise = word(12);
    this.gallopWas = on(13); this.jumpWas = on(14); this.jumpQueued = on(15); this.tapQueued = on(16);
    this.clock = word(17); this.lastPhase = word(18); this.strideHz = word(19); this.sectorWas = word(20); this.skidT = word(21);
    this.panicT = word(22); this.panicRear = word(23); this.panicYaw = word(24); this.spurFlash = word(25);
    this.spur.restoreRide(from, at + 26);
    this.onDeck = on(30); this.swimming = on(31); this.airT = word(32); this.blockedT = word(33);
    this.shoveX = word(34); this.shoveZ = word(35); this.jostleCd = word(36); this.gait = RIDE_GAITS[word(37)] ?? 'stand';
    this.motor?.standAt(this.feet, this.heading);
  }

  settleBody(): void {
    const m = this.motor;
    if (m !== null) {
      m.release();
      // a capsule lying level on a slope digs its uphill end in: lift it clear (gravity sets it down on the next steps)
      const y0 = this.feet.y;
      let free = false;
      let up = 0;
      for (let i = 0; i < 9; i++) {
        if (free) break;
        this.feet.y = y0 + up; free = m.setYaw(this.feet, this.heading); up += 0.1;
      }
      // standing in something (the hitching rail at the camp horse's nose): back out along the heading, up to 2 m
      const bx = -Math.sin(this.heading), bz = -Math.cos(this.heading);
      for (let i = 0; i < 14; i++) {
        if (free) break;
        this.feet.x += bx * 0.15; this.feet.z += bz * 0.15; this.feet.y = y0;
        free = m.setYaw(this.feet, this.heading);
      }
    }
    this.vy = 0; this.grounded = true; this.airT = -1;
    this.prevFeet.copy(this.feet); this.prevHeading = this.heading;
  }
  landBody(world: MountedWorld): void {
    const f = this.feet, physics = world.physics, heightAt = world.heightAt;
    if (physics === null) return;
    const top = floorBelow(physics, f.x, f.z, f.y + 2.5, 2.6, this.motor?.collider);
    if (top !== undefined && top > f.y) { f.y = top; this.onDeck = top - heightAt(f.x, f.z) > 0.3; }
  }
  private obstacleAhead(world: MountedWorld, scale: number): boolean {
    const physics = world.physics, m = this.motor;
    if (physics === null || m === null) return false;
    const f = this.feet, s = scale;
    const sx = Math.sin(this.heading), sz = Math.cos(this.heading);
    const reach = this.speed * mountJUMP_APEX_T;               // the centre is over the obstacle at the top of the arc
    mount_dir.x = sx; mount_dir.y = 0; mount_dir.z = sz;
    mount_from.x = f.x; mount_from.y = f.y + 0.7 * s; mount_from.z = f.z;
    const low = castRay(physics, mount_from, mount_dir, reach + 0.6, mountWORLD, m.collider);
    if (low !== null && low.material !== 'ground' && Math.abs(low.normal.y) < 0.5 && low.distance > reach - 0.9) {
      mount_from.y = f.y + 1.75 * s;
      const high = castRay(physics, mount_from, mount_dir, low.distance + 1.2, mountWORLD, m.collider);
      const land = floorBelow(physics, f.x + sx * (low.distance + 2.2), f.z + sz * (low.distance + 2.2), f.y + 2.5, 5, m.collider);
      return high === null && land !== undefined;
    }
    // a ditch / the brook: the ground drops a metre 2.4–3.4 m ahead and rises again 2 m past it
    for (let i = 0; i < 2; i++) {
      const d = i === 0 ? 2.4 : 3.4;
      const x = f.x + sx * d, z = f.z + sz * d;
      const g = floorBelow(physics, x, z, f.y + 1, 6, m.collider);
      if (g === undefined || g > f.y - 1.0) continue;
      const far = floorBelow(physics, x + sx * 2, z + sz * 2, f.y + 2, 8, m.collider);
      if (far !== undefined && far > g + 0.6) return true;
    }
    return false;
  }
  stepBody(dt: number, a: MountedAnimal, p: MountedRider, world: MountedWorld): void {
    const HORSE_SPEED = this.bodySpeeds, heightAt = world.heightAt, waterLevel = world.waterLevel;
    const f = this.feet;
    this.prevFeet.copy(f); this.prevHeading = this.heading;
    // ── turning: the rate eases toward the rein; the body turns only where its nose and rump have room ──
    this.yawRate += (this.rateIn * this.maxRate() - this.yawRate) * Math.min(1, dt * mountTURN_EASE);
    let heading = this.breaking ? a.yaw : this.heading + this.yawRate * dt;   // the bucking spins the horse itself (Taming)
    heading = Math.atan2(Math.sin(heading), Math.cos(heading));
    if (heading !== this.heading) {
      if (this.motor === null || this.motor.setYaw(f, heading)) this.heading = heading;
      else this.yawRate = 0;                                                    // boxed in: the turn is refused
    }
    // inertia: speeding up takes its time (a canter in ~2.5 s, the gallop's last gear slower); letting go coasts down,
    // the reins (back) stop it in a couple of lengths
    const accel = this.target > this.speed ? (this.speed > HORSE_SPEED.canter - 0.5 ? mountACCEL_HI : mountACCEL) : this.skidT > 0 ? mountSKID : this.sector === -1 || this.target < 0 ? mountREIN : mountCOAST;
    // B1: the skid — the haunches down (the rear knob), until the horse stands
    if (this.skidT > 0) this.skidT = this.speed < 0.6 ? 0 : Math.max(0, this.skidT - dt);
    this.speed += MathUtils.clamp(this.target - this.speed, -accel * dt, accel * dt);
    // ── the jump: Space, or by itself at a canter+ over a rail / log / the brook a jump's reach ahead ──
    const wantJump = this.jumpQueued || (this.speed > 6 && this.grounded && this.obstacleAhead(world, a.scale));
    this.jumpQueued = false;
    if (wantJump && this.grounded && !this.breaking && !this.swimming) { this.vy = mountJUMP_V; this.grounded = false; this.airT = 0; }
    // on the ground no push down into it (the capsule's long flat underside snags on the ground's own contact if it
    // is pressed into it every step — the snap to ground takes it down slopes); in the air, gravity
    if (!this.grounded || this.vy > 0) this.vy -= mountGRAVITY * dt;
    // ── R3: the herd's shove fades ──
    const fade = Math.exp(-dt * 5);
    this.shoveX *= fade; this.shoveZ *= fade; this.jostleCd = Math.max(0, this.jostleCd - dt);
    // ── the move: the horse's climb limit by gait (47° at a walk → 35° at a gallop), then the motor ──
    const sx = Math.sin(this.heading), sz = Math.cos(this.heading);
    mount_want.x = (sx * this.speed + this.shoveX) * dt; mount_want.y = this.vy * dt; mount_want.z = (sz * this.speed + this.shoveZ) * dt;
    const m = this.motor;
    let grounded: boolean, freedom = 1;
    if (m !== null) {
      // by the gait the reins ask for (or the speed still carried): held at a gallop, a 40° bank stays refused — rein in
      // to a walk and the horse picks its way up
      const climbV = Math.max(Math.abs(this.speed), Math.abs(this.target));
      m.setClimb(MathUtils.lerp(mountCLIMB.walk, mountCLIMB.gallop, MathUtils.clamp((climbV - HORSE_SPEED.walk) / (HORSE_SPEED.gallop - HORSE_SPEED.walk), 0, 1)));
      const carried = this.grounded && m.carry(f);   // carry the rider with a moving deck
      if (carried && this.vy <= 0) mount_want.y = 0;
      const r = m.move(f, mount_want, false);
      grounded = r.grounded; freedom = r.horizontalFreedom;
    } else {
      // no physics world (a node harness): the old ground follow, nothing stops it
      f.x += mount_want.x; f.z += mount_want.z; f.y = heightAt(f.x, f.z); grounded = true;
    }
    // on a deck: standing on a registered collider over the terrain (the Kunes bridge, a yurt's floor) — every Nalati
    // floor is real geometry since NALATI-MERGE P1, so the motor carries the horse on it (no floor functions left)
    this.onDeck = grounded && f.y - heightAt(f.x, f.z) > 0.3;
    // swimming: deeper than mountFORD_DEPTH the horse floats with its back dry (fording stays game code)
    const wl = waterLevel();
    this.swimming = f.y < wl - mountFORD_DEPTH && (world.wetAt?.(f.x, f.z) === true || heightAt(f.x, f.z) < wl);
    if (this.swimming) { f.y = wl - mountFORD_DEPTH; grounded = true; }
    // on a structure (a bridge deck, floor function or collider): the terrain under it is not what the hooves stand on, so
    // the body must not tilt to it — the Kunes bridge spans a gully and the horse pitched ~20° to the bank below, which
    // swung the seat (and the eye) forward over the neck: no head or ears in the frame on the bridge (NALATI-MERGE H4)
    a.levelGround = this.onDeck || f.y - heightAt(f.x, f.z) > 0.3;
    if (grounded && this.vy <= 0) {
      if (this.airT >= 0) this.bobY -= 0.12;                                     // the landing
      this.vy = 0; this.airT = -1;
    } else if (this.airT >= 0) this.airT += dt;
    this.grounded = grounded;
    // run into a wall: the gait drops to what the body actually made (no galloping in place against a fence) — once it
    // has held for a few steps, so one snag on a stone doesn't rein the horse in
    this.blockedT = freedom < 0.5 && Math.abs(this.speed) > 0.5 ? this.blockedT + dt : 0;
    if (this.blockedT > 0.06) {
      const made = Math.hypot(f.x - this.prevFeet.x, f.z - this.prevFeet.z) / dt;
      this.speed = Math.sign(this.speed) * Math.min(Math.abs(this.speed), made);
    }
    // ── R3: a stampeding horse against the rider: jostled; at a gallop, a hard hit throws you ──
    if (m !== null && this.jostleCd <= 0) {
      this.contactHorse = a; this.contactWorld = world; this.contactHit = null;
      try { m.touching(0.3, mountCREATURE, this.contact); }
      finally { this.contactHorse = null; this.contactWorld = null; }
      const hit = this.contactResult();
      if (hit !== null && this.jostleBody(hit)) { world.thrown(); return; }
    }
    // ── the horse follows exactly (Animal skips its own steering while driven; pose() places it) ──
    a.setMotion(this.heading, this.speed, 50);
    a.speed = this.speed;
    a.state = this.speed > 6 ? 'flee' : Math.abs(this.speed) > 0.2 ? 'wander' : 'idle';
    // the rear knob is a LEVEL (horse.ts eases toward it) and Mount owns it while you ride: the jump's take-off, the skid
    // sitting the horse back, the panic's first half-second — else 0. E320: the skid and the panic only ever raised it, so
    // after one the neck stood up in front of the rider's eye for good (the "cursed", face-on horse on the horse track)
    if (this.airT >= 0) {
      const u = this.airT / (2 * mountJUMP_APEX_T);
      a.mem['rear'] = u < 0.35 ? 0.35 : 0;
      if (u > 0.6 && u < 0.65) a.mem['kick'] = 1;
    } else if (!this.breaking) a.mem['rear'] = this.panicRear > 0 ? mountPANIC_REAR_POSE : this.skidT > 0 ? mountSKID_REAR : 0;
    // ── STEED ──
    this.gait = this.speed < 0.3 ? 'stand' : this.speed < 3 ? 'walk' : this.speed < 6.5 ? 'trot' : this.speed < 11 ? 'canter' : 'gallop';
    const rhythm = this.spur.latched;   // B1: a gallop the rhythm holds is almost free
    this.steed = MathUtils.clamp(this.steed + dt * (this.galloping && this.speed > 9 ? -(rhythm ? mountSTEED_RHYTHM : mountSTEED_GALLOP) : this.gait === 'canter' ? mountSTEED_CANTER : mountSTEED_WALK), 0, mountSTEED_MAX);
    // ── the rider rides along: the carrier velocity for the bow, no walk of his own ──
    this.vel.set(sx * this.speed, this.vy, sz * this.speed);
    p.velocity.copy(this.vel);
    p.onGround = true; p.sprinting = this.speed > 10; p.crouching = false; p.speedFactor = 0;
  }
  jostleBody(o: MountedContact): boolean {
    this.jostleCd = mountJOSTLE_CD; this.jostles++;
    const ox = Math.sin(o.yaw) * o.speed, oz = Math.cos(o.yaw) * o.speed;
    const mx = Math.sin(this.heading) * this.speed, mz = Math.cos(this.heading) * this.speed;
    const closing = Math.hypot(ox - mx, oz - mz);
    let nx = this.feet.x - o.position.x, nz = this.feet.z - o.position.z;
    const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    const k = Math.min(3.5, 0.8 + closing * 0.25);
    this.shoveX = nx * k + (ox - mx) * 0.15; this.shoveZ = nz * k + (oz - mz) * 0.15;
    this.jolt = Math.max(this.jolt, Math.min(1, 0.3 + closing / 14));
    this.speed *= 0.92;
    if (this.gait === 'gallop' && closing >= mountUNSEAT_CLOSING) {
      this.thrownBy = 'stampede';
      return true;
    }
    return false;
  }
  /** The shipping feet/eye-height projection, called once after fixed motion; it owns no camera or renderer. */
  placeRider(dt: number, alpha: number, a: MountedAnimal, p: Pick<MountedRider, 'position'>, world: MountedWorld): number {
    const t = MathUtils.clamp(alpha, 0, 1);
    const pf = this.prevFeet, f = this.feet;
    const glide = pf.distanceToSquared(f) < 25;   // a teleport is not a glide
    const px = glide ? pf.x + (f.x - pf.x) * t : f.x, pz = glide ? pf.z + (f.z - pf.z) * t : f.z;
    let py = glide ? pf.y + (f.y - pf.y) * t : f.y;
    const heading = glide ? this.prevHeading + mountAngDiff(this.heading, this.prevHeading) * t : this.heading;
    // the hooves on the ground: the capsule rides on its lowest mountPoint, so on a slope its middle floats a little — draw the
    // horse on the floor under its middle (a physics query; decks and the jump keep the body's own height)
    const physics = world.physics;
    if (this.grounded && !this.onDeck && !this.swimming && this.airT < 0 && physics !== null && this.motor !== null) {
      const fl = floorBelow(physics, px, pz, py + 0.3, 0.9, this.motor.collider);
      if (fl !== undefined && fl < py) py = fl;
    }
    if (this.airT >= 0) this.eyeY = py; else this.eyeY += (py - this.eyeY) * Math.min(1, dt * 12);
    a.position.set(px, this.eyeY, pz);
    a.yaw = heading;
    p.position.set(px, this.eyeY, pz);
    return heading;
  }
}

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedRoadSpurSaveInput = BoundedRoadSpurSave;
interface BoundedRoadSpurSaveFields {
    version: 1;
    streak: number;
    latchT: number;
    good: number;
    lastTap: number;
}
type BoundedRoadSpurSave = { [Key in keyof BoundedRoadSpurSaveFields]: BoundedRoadSpurSaveFields[Key] };
type BoundedReinsSaveInput = BoundedReinsSave;
interface BoundedReinsSaveFields {
    version: 1;
    steed: number;
    winded: boolean;
    breaking: boolean;
    heading: number;
    speed: number;
    wUp: number;
    grounded: boolean;
    target: number;
    rateIn: number;
    turnIn: number;
    sector: 0 | 1 | 2 | -1;
    galloping: boolean;
    drawing: boolean;
    jumpWas: boolean;
    jumpQueued: boolean;
    cruise: number;
    gallopWas: boolean;
    tapQueued: boolean;
    clock: number;
    lastPhase: number;
    strideHz: number;
    sectorWas: 0 | 1 | 2 | -1;
    skidT: number;
    panicT: number;
    panicRear: number;
    panicYaw: number;
    jolt: number;
    onRoad: boolean;
    beat: boolean;
    spurFlash: number;
    turnLead: number;
    spur: {
        version: 1;
        streak: number;
        latchT: number;
        good: number;
        lastTap: number;
    };
}
type BoundedReinsSave = { [Key in keyof BoundedReinsSaveFields]: BoundedReinsSaveFields[Key] };
