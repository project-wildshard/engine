import type { MoverPose } from '@wildshard/engine/physics/mover';
import type { ScriptEntity } from '@wildshard/engine/script/effects';
import { MoverMechanic, STEER_FIELDS, type MoverSteer } from '@wildshard/engine/sim/moverMotion';
import type { MoverData } from '@wildshard/format/movers';

/** A server row of the ridden vehicle: the frame's tick and the pose it carried. */
export interface SteerRow { readonly tick: number; readonly pose: MoverPose }
/** How far a row may stand from what this page predicted for the same step before the prediction moves onto it. */
export const STEER_SETTLE = { metres: 0.02, radians: 0.002 } as const;
/** Steps kept to meet their rows: two seconds of round trip at the fixed step. */
const KEPT = 120;
/** The server steps a mover once a tick at this rate, and so does the page (`MoverRuntime.step`). */
const STEP = 1 / 60;
const tau = 2 * Math.PI;
const wrap = (angle: number): number => angle - Math.floor(angle / tau + 0.5) * tau;

/**
 * SHARD-SOURCE SS-MS2a3b: the vehicle this page's player rides, stepped here on the rider's own stick by the server's own
 * mechanic (`MoverMechanic`, SS-MS2a1b), one step per command the page sends. A row says where the server had it after the
 * newest command it stepped; the step this page took for that command is `behind` steps back, and when the two disagree the
 * prediction (and every step after that one) moves by the difference, as a predicted body replays onto its owner block.
 */
export class SteerPrediction {
  private readonly mechanic: MoverMechanic;
  private entity: ScriptEntity;
  private readonly steps: { x: number; y: number; z: number; yaw: number }[] = [];
  private heard = -1;
  private tick = 0;
  constructor(row: MoverData[number], from: MoverPose) {
    if (row.driver?.kind !== 'steer' || row.trigger === undefined) throw new Error('Not a steer vehicle');
    this.mechanic = new MoverMechanic({ driver: row.driver, trigger: row.trigger, at: row.at, euler: row.euler, ...(row.carry === undefined ? {} : { carry: row.carry }) });
    const { position: p, euler } = from;
    this.entity = { id: row.entity, name: row.id, position: [p.x, p.y, p.z], frozen: false, interactive: true,
      fields: { 1: 0, [STEER_FIELDS.yaw]: euler.y, 3: 0, 4: 1, [STEER_FIELDS.speed]: 0, [STEER_FIELDS.ridden]: 1 } };
  }
  /** One step on the rider's stick, over `ground` when the page found ground under a ground-following vehicle. */
  step(stick: MoverSteer, ground: number | undefined, blocked = false): void {
    this.entity = this.mechanic.step(this.entity, { tick: this.tick++, dt: STEP, action: 0, permission: 0, steer: stick, ...(ground === undefined ? {} : { ground }), ...(blocked ? { blocked } : {}) }).entity;
    const [x, y, z] = this.entity.position;
    this.steps.push({ x, y, z, yaw: this.entity.fields[STEER_FIELDS.yaw] ?? 0 });
    if (this.steps.length > KEPT) this.steps.shift();
  }
  /** Meet a row: the server stepped all but `behind` of the commands this page sent, the newest of which it has stepped here. */
  settle(row: SteerRow, behind: number): void {
    if (row.tick === this.heard) return;
    this.heard = row.tick;
    const at = this.steps.length - 1 - behind, was = this.steps[at];
    // a row for a command sent before this prediction began (or past what it keeps) has nothing here to meet
    if (was === undefined) return;
    const p = row.pose.position, dx = p.x - was.x, dy = p.y - was.y, dz = p.z - was.z, turn = wrap(row.pose.euler.y - was.yaw);
    if (Math.hypot(dx, dy, dz) <= STEER_SETTLE.metres && Math.abs(turn) <= STEER_SETTLE.radians) return;
    for (let i = at; i < this.steps.length; i++) {
      const step = this.steps[i];
      if (step !== undefined) { step.x += dx; step.y += dy; step.z += dz; step.yaw = wrap(step.yaw + turn); }
    }
    const [x, y, z] = this.entity.position;
    this.entity = { ...this.entity, position: [x + dx, y + dy, z + dz], fields: { ...this.entity.fields, [STEER_FIELDS.yaw]: wrap((this.entity.fields[STEER_FIELDS.yaw] ?? 0) + turn) } };
  }
  /** Its heading now (SS-GP5c: the ground probe looks past its bow). */
  yaw(): number { return this.entity.fields[STEER_FIELDS.yaw] ?? 0; }
  /** Where the page has it now. */
  pose(): MoverPose {
    const [x, y, z] = this.entity.position, f = this.entity.fields;
    return { position: { x, y, z }, euler: { x: f[1] ?? 0, y: f[STEER_FIELDS.yaw] ?? 0, z: f[3] ?? 0 }, enabled: true };
  }
}
