import type { MoverPose } from '@wildshard/format/moverPose';
import type { VehicleHandling } from '@wildshard/format/vehicles';
import { stepVehicle, type VehicleCommand, type VehicleState, type VehicleStepOut, type VehicleWorld } from '@wildshard/engine/sim/vehicle';
import { VEHICLE_EDGE_OWNER } from '@wildshard/engine/sim/vehicleHull';

/** A server row of the driven vehicle: the frame's tick, its pose, and (MSZ16) its speeds along and across its heading. */
export interface VehicleRow { readonly tick: number; readonly pose: MoverPose; readonly forward?: number; readonly slip?: number }
/** How far a row may stand from what this page had after the same command before the page replays from it. */
export const VEHICLE_SETTLE = { metres: 0.02, radians: 0.002, speed: 0.05 } as const;
/** A correction under `snap` m eases out of the drawn vehicle over `seconds`; one past it snaps (MSZ16). */
export const VEHICLE_EASE = { snap: 0.5, seconds: 0.1 } as const;
/** Commands kept to meet their rows: two seconds of round trip at the fixed step. */
const KEPT = 120;
/** The server steps a vehicle once a tick at this rate, and so does the page. */
export const VEHICLE_DT: number = 1 / 60;
const tau = 2 * Math.PI;
const wrap = (angle: number): number => angle - Math.floor(angle / tau + 0.5) * tau;

/** A vehicle state off a row, its speeds from `motion` where the row carries none. */
export function rowState(row: Pick<VehicleRow, 'pose' | 'forward' | 'slip'>, motion: Pick<VehicleState, 'forward' | 'slip'>): VehicleState {
  const { position: p, euler } = row.pose;
  return { x: p.x, y: p.y, z: p.z, yaw: euler.y, pitch: euler.x, roll: -euler.z, forward: row.forward ?? motion.forward, slip: row.slip ?? motion.slip };
}
/** The pose a state draws (the server's `poseOf`). */
export const statePose = (state: VehicleState): MoverPose => ({ position: { x: state.x, y: state.y, z: state.z }, euler: { x: state.pitch, y: state.yaw, z: -state.roll }, enabled: true });

/**
 * MIRROR-SALT-ZONE MSZ16: the vehicle this page's player drives, stepped here by the server's own step (MSZ7's `stepVehicle`)
 * on each command the page sends, the moment it sends it. A row says where the server had it after the newest command it
 * stepped, `behind` commands back from the newest sent; when that disagrees with what this page had after the same command,
 * the page takes the row's state and replays every command the server has not answered from it, through its own world (the
 * floor probe and the hull's cast, MSZ13), so a slide or a bounce replays as the server stepped it, rather than shifting the old
 * steps (`SteerPrediction.settle`), which drifts once the step stops being a straight line.
 *
 * The drawn vehicle hides the jump: a correction under `VEHICLE_EASE.snap` m eases out over `VEHICLE_EASE.seconds`, a larger
 * one (a knock the page never saw, a wreck's reset) snaps.
 */
export class VehiclePrediction {
  /** Rows that disagreed, and of those the ones that snapped: what a proof reads. */
  corrections = 0; snaps = 0;
  /** The widest gap a row found, m. */
  worst = 0;
  /** MSZ18: a live step met the cell's edge since the page last asked (`takeEdge`). */
  private edged = false;
  /** MSZ15: the hardest hit a live step met since the page last asked (`takeImpact`), m/s; 0 for none. */
  private struck = 0;
  private readonly out: VehicleStepOut = { blocked: false, sliding: 0, impact: null };
  private readonly handling: VehicleHandling;
  private readonly world: VehicleWorld;
  private now: VehicleState;
  private readonly steps: { readonly command: VehicleCommand; after: VehicleState }[] = [];
  private heard = -1;
  /** The drawn vehicle's lag behind the predicted one, easing to nothing. */
  private readonly offset = { x: 0, y: 0, z: 0, yaw: 0 };
  private easing = 0;
  constructor(handling: VehicleHandling, world: VehicleWorld, from: VehicleState) {
    this.handling = handling; this.world = world; this.now = from;
  }
  /** One command, stepped as the server will step it. */
  step(command: VehicleCommand): VehicleState {
    this.out.impact = null;
    this.now = stepVehicle(this.now, command, this.handling, this.world, VEHICLE_DT, this.out);
    const impact = this.out.impact as VehicleStepOut['impact'];
    if (impact?.owner === VEHICLE_EDGE_OWNER) this.edged = true;
    else if (impact !== null && impact !== undefined) this.struck = Math.max(this.struck, impact.strength); // MSZ15: heard on the page
    this.steps.push({ command, after: this.now });
    if (this.steps.length > KEPT) this.steps.shift();
    return this.now;
  }
  /** Meet a row: the server has stepped all but `behind` of the commands this page sent. True when it corrected. */
  settle(row: VehicleRow, behind: number): boolean {
    if (row.tick === this.heard) return false;
    this.heard = row.tick;
    const at = this.steps.length - 1 - behind, was = this.steps[at];
    // a row for a command sent before this prediction began (or past what it keeps) has nothing here to meet
    if (was === undefined) return false;
    const server = rowState(row, was.after), mine = was.after;
    const gap = Math.hypot(server.x - mine.x, server.y - mine.y, server.z - mine.z);
    if (gap <= VEHICLE_SETTLE.metres && Math.abs(wrap(server.yaw - mine.yaw)) <= VEHICLE_SETTLE.radians
      && Math.abs(server.forward - mine.forward) <= VEHICLE_SETTLE.speed && Math.abs(server.slip - mine.slip) <= VEHICLE_SETTLE.speed) return false;
    // replay the unanswered commands from the server's state
    const drawn = this.drawnState();
    was.after = server;
    let state = server;
    for (let i = at + 1; i < this.steps.length; i++) {
      const step = this.steps[i]; if (step === undefined) continue;
      state = stepVehicle(state, step.command, this.handling, this.world, VEHICLE_DT); step.after = state;
    }
    this.now = state;
    this.corrections++; this.worst = Math.max(this.worst, gap);
    // the drawn vehicle stays where it was drawn and eases onto the new prediction, or snaps a long way
    const dx = drawn.x - state.x, dy = drawn.y - state.y, dz = drawn.z - state.z;
    if (Math.hypot(dx, dy, dz) > VEHICLE_EASE.snap) { this.offset.x = 0; this.offset.y = 0; this.offset.z = 0; this.offset.yaw = 0; this.easing = 0; this.snaps++; return true; }
    this.offset.x = dx; this.offset.y = dy; this.offset.z = dz; this.offset.yaw = wrap(drawn.yaw - state.yaw); this.easing = VEHICLE_EASE.seconds;
    return true;
  }
  /** A drawn frame of `dt` s: the correction's lag eases out, evenly, over what is left of its time. */
  ease(dt: number): void {
    if (this.easing <= 0) return;
    const keep = dt >= this.easing ? 0 : (this.easing - dt) / this.easing;
    this.offset.x *= keep; this.offset.y *= keep; this.offset.z *= keep; this.offset.yaw *= keep;
    this.easing = Math.max(0, this.easing - dt);
  }
  /** MSZ18: whether a step met the cell's edge since the last ask (its chip says why the vehicle turned back). */
  takeEdge(): boolean { const edged = this.edged; this.edged = false; return edged; }
  /** MSZ15: the hardest hit (closing speed, m/s) a step met since the last ask, the cell's edge aside; 0 for none. */
  takeImpact(): number { const struck = this.struck; this.struck = 0; return struck; }
  /** Where the page has it now: its collider stands here. */
  state(): VehicleState { return this.now; }
  /** Where it is drawn now: the prediction, with a correction's lag still easing out. */
  drawnState(): VehicleState {
    const { offset: o, now } = this;
    return o.x === 0 && o.y === 0 && o.z === 0 && o.yaw === 0 ? now : { ...now, x: now.x + o.x, y: now.y + o.y, z: now.z + o.z, yaw: wrap(now.yaw + o.yaw) };
  }
  /** The drawn lag now, m. */
  lag(): number { return Math.hypot(this.offset.x, this.offset.y, this.offset.z); }
}
