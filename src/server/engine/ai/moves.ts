import * as v from 'valibot';
import { parseActorMoves, type ActorMove } from '@wildshard/format/actorMoves';
import { emitFault } from '../../../shared/engine/core/faults';

/** Simulation observations only; neither a renderer nor a shard callback enters the motion kernel. */
export interface MovePoint { readonly x: number; readonly y: number; readonly z: number }
export interface MoveBody { readonly position: MovePoint; readonly yaw: number }
export interface MoveSteering { readonly yaw: number; readonly speed: number; readonly altitude: number; readonly turn: number; readonly ground: boolean }
export interface MoveObservation {
  readonly body: MoveBody;
  readonly target?: MovePoint;
  /** Actual named world spot, resolved by the platform before starting a perch/takeoff. */
  readonly perch?: MovePoint & { readonly yaw: number };
  /** Authoritative contact and admitted strike range, not an inferred distance hit. */
  readonly reach?: boolean; readonly range?: number;
  readonly field?: number;
  /** Existing platform registry resolves the declared spot or numeric actor fields. */
  readonly destination?: { readonly x: number; readonly z: number; readonly y?: number; readonly yaw?: number };
  /** Numeric public fields resolved by the platform; rows bound maximum speed and turn. */
  readonly controls?: { readonly yaw: number; readonly speed: number; readonly turn: number };
}
export interface MoveFrame {
  /** One placement request for the existing body owner; restore never applies it. */
  readonly placement?: { readonly x: number; readonly z: number; readonly y?: number; readonly yaw: number };
  readonly steering?: MoveSteering;
  readonly bank?: number;
  readonly field?: { readonly id: string; readonly value: number };
  readonly strike?: string;
  /** One edge only. The platform publishes move.done(actor, move, ok). */
  readonly done?: boolean;
}
const yawTo = (body: MoveBody, target: Pick<MovePoint, 'x' | 'z'>): number => Math.atan2(target.x - body.position.x, target.z - body.position.z);
const distance = (body: MoveBody, target: Pick<MovePoint, 'x' | 'z'>): number => Math.hypot(target.x - body.position.x, target.z - body.position.z);
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
type Motion = Pick<MoveSteering, 'speed' | 'turn' | 'ground'>;
type Of<K extends ActorMove['kind']> = Extract<ActorMove, { kind: K }>;

/** Shared orbit geometry. A bearing lead follows the actual body; otherwise the owner retains a clock angle. */
export function orbitSteering(row: Pick<Of<'orbit'>, 'center' | 'r' | 'y' | 'lead'> & Motion, body: MoveBody, angle: number): MoveSteering {
  const [x, z] = row.center;
  const around = row.lead === undefined ? angle : Math.atan2(body.position.x - x, body.position.z - z) + row.lead;
  const target = row.lead === undefined ? { x: x + Math.cos(around) * row.r, z: z + Math.sin(around) * row.r }
    : { x: x + Math.sin(around) * row.r, z: z + Math.cos(around) * row.r };
  return { yaw: yawTo(body, target), speed: row.speed, altitude: row.y, turn: row.turn, ground: row.ground };
}
/** Shared closing/retreat and readiness law. Range comes from the strike owner. */
export function stalkSteering(row: Pick<Of<'stalk'>, 'standOff' | 'above' | 'altitude' | 'retreat' | 'constantSpeed' | 'ready'> & Motion,
  body: MoveBody, target: MovePoint, range?: number): { steering: MoveSteering; ready: boolean } {
  const d = distance(body, target), altitude = row.above === undefined ? row.altitude : target.y + row.above;
  if (altitude === undefined) throw new Error('Move requires an altitude source');
  if (row.ready.kind === 'range' && (range === undefined || !Number.isFinite(range) || range < 0)) throw new Error('Move requires the admitted strike range');
  return { steering: { yaw: yawTo(body, target) + (row.retreat && d < row.standOff ? Math.PI : 0),
    speed: row.constantSpeed ? row.speed : Math.min(row.speed, Math.abs(d - row.standOff) * 1.5), altitude, turn: row.turn, ground: row.ground },
    ready: row.ready.kind === 'over' ? d < row.ready.radius && Math.abs(body.position.y - altitude) < row.ready.height
      : row.ready.kind === 'band' ? Math.abs(d - row.standOff) < row.ready.tolerance : range !== undefined && d < range };
}
/** Dive steering leaves reach, attack tokens and the strike runner with the existing combat authority. */
export function diveSteering(row: Pick<Of<'dive'>, 'slope' | 'skim' | 'altitude' | 'aimHeight'> & Partial<Pick<Of<'dive'>, 'targetAltitude'>> & Motion, body: MoveBody, target: MovePoint): MoveSteering {
  const dy = target.y + row.aimHeight - body.position.y;
  const d = Math.hypot(target.x - body.position.x, dy, target.z - body.position.z);
  return { yaw: yawTo(body, target), speed: row.speed, altitude: row.targetAltitude === true ? target.y + row.aimHeight : Math.max(row.skim, Math.min(row.altitude, d * row.slope)), turn: row.turn, ground: row.ground };
}
/** Timed departure and banking; the existing flight motor owns actual vertical motion and collisions. */
export function takeoffSteering(row: Pick<Of<'takeoff'>, 'altitude' | 'bank'> & Motion, body: MoveBody, target: MovePoint, from: number, progress: number): { steering: MoveSteering; bank: number } {
  const k = clamp(progress, 0, 1), yaw = yawTo(body, target), off = Math.atan2(Math.sin(yaw - body.yaw), Math.cos(yaw - body.yaw));
  return { steering: { yaw, speed: row.speed * k, altitude: from + (row.altitude - from) * k, turn: row.turn, ground: row.ground },
    bank: -clamp(off * 1.2, -row.bank, row.bank) * Math.min(1, k * 4) };
}
/** Interpolated rise/lie geometry also serves the legacy encounter's externally driven intro progress. */
export function riseSteering(row: { readonly from: number; readonly to: number; readonly yawLead: number } & Motion, body: MoveBody, progress: number): MoveSteering {
  const k = clamp(progress, 0, 1);
  return { yaw: body.yaw + row.yawLead, speed: k > 0 ? row.speed : 0, altitude: row.from + (row.to - row.from) * k, turn: row.turn, ground: row.ground };
}
const finite = v.pipe(v.number(), v.finite());
const saved: v.GenericSchema<ActorMoveSavedDataInput, ActorMoveSavedData> = v.strictObject({ version: v.literal(1), contract: v.string(), elapsed: v.pipe(finite, v.minValue(0)), angle: finite, complete: v.boolean(), strikeIssued: v.exactOptional(v.boolean()) });
function point(value: MovePoint): void { if (![value.x, value.y, value.z].every(Number.isFinite)) throw new Error('Nonfinite move observation'); }

/** One replaceable sim-side move. It emits data requests; platform flight/physics/combat applies them in fixed-step order.
 * No fight phases, random choices, attack selection, scene objects or import-time installation live here. */
export class ActorMoveRunner {
  private readonly row: ActorMove;
  private readonly contract: string;
  private elapsed = 0;
  private angle: number;
  private complete = false;
  private strikeIssued = false;
  private reportedFrame = false;
  constructor(input: unknown, body: MoveBody) {
    const row = parseActorMoves([input])[0]; if (row === undefined) throw new Error('Missing move declaration');
    this.row = row; this.contract = JSON.stringify(row);
    point(body.position); if (!Number.isFinite(body.yaw)) throw new Error('Nonfinite move heading');
    this.angle = this.row.kind === 'orbit' ? Math.atan2(body.position.z - this.row.center[1], body.position.x - this.row.center[0]) : 0;
  }
  snapshot(): v.InferOutput<typeof saved> { return { version: 1, contract: this.contract, elapsed: this.elapsed, angle: this.angle, complete: this.complete, ...(this.row.kind === 'dive' && this.row.strike !== undefined ? { strikeIssued: this.strikeIssued } : {}) }; }
  /** Full validation precedes mutation. Restore neither moves nor emits completion/strike requests. */
  restore(input: unknown): void {
    const value = v.parse(saved, input);
    if (value.contract !== this.contract) throw new Error('Move continuation belongs to another declaration');
    this.elapsed = value.elapsed; this.angle = value.angle; this.complete = value.complete; this.strikeIssued = value.strikeIssued ?? false;
  }
  /** Advance exactly once per 60 Hz simulation step. Completed moves emit no further requests.
   * A refused observation emits nothing, restores private clocks/edges and reports once. */
  step(observation: MoveObservation): MoveFrame {
    if (this.complete) return {};
    const elapsed = this.elapsed, angle = this.angle, complete = this.complete, strikeIssued = this.strikeIssued;
    try {return this.evaluateObservation(observation);}
    catch (error) {
      this.elapsed = elapsed; this.angle = angle; this.complete = complete; this.strikeIssued = strikeIssued;
      if (!this.reportedFrame) {
        this.reportedFrame = true;
        emitFault({system: 'ai.move', error, verdict: 'retry'});
      }
      return {};
    }
  }
  private evaluateObservation(observation: MoveObservation): MoveFrame {
    const { body, target, perch } = observation, row = this.row;
    point(body.position); if (!Number.isFinite(body.yaw)) throw new Error('Nonfinite move heading');
    if (target !== undefined) point(target);
    if (perch !== undefined) { point(perch); if (!Number.isFinite(perch.yaw)) throw new Error('Nonfinite perch heading'); }
    const needsTarget = row.kind === 'stalk' || row.kind === 'dive' || row.kind === 'takeoff' || row.kind === 'ring-run' || (row.kind === 'relocate' && row.facing === 'target');
    if (needsTarget && target === undefined) throw new Error('Move requires a resolved target');
    if ((row.kind === 'takeoff' || row.kind === 'perch') && perch === undefined) throw new Error('Move requires its resolved perch');
    if ((row.kind === 'burrow' || row.kind === 'surface') && (observation.field === undefined || !Number.isFinite(observation.field) || observation.field < 0 || observation.field > 1)) throw new Error('Move requires a normalized field');
    if (row.kind === 'stalk' && row.ready.kind === 'range' && (observation.range === undefined || !Number.isFinite(observation.range) || observation.range < 0)) throw new Error('Move requires the admitted strike range');
    const destination = observation.destination;
    if (row.kind === 'relocate' && (destination === undefined || ![destination.x, destination.z].every(value => Number.isFinite(value) && Math.abs(value) <= 10000)
      || (destination.y !== undefined && (!Number.isFinite(destination.y) || Math.abs(destination.y) > 10000)) || (destination.yaw !== undefined && !Number.isFinite(destination.yaw)))) throw new Error('Move requires its finite admitted location');
    this.elapsed += 1 / 60;
    switch (row.kind) {
      case 'steer': {
        const controls = observation.controls;
        if (controls === undefined || ![controls.yaw, controls.speed, controls.turn].every(Number.isFinite)
          || controls.speed < 0 || controls.speed > row.speed || controls.turn < 0 || controls.turn > row.turn) throw new Error('Move steering exceeds admitted bounds');
        return { steering: { ...controls, altitude: body.position.y, ground: row.ground } };
      }
      case 'relocate': {
        if (destination === undefined) throw new Error('Missing admitted location');
        const yaw = row.facing === 'target' && target !== undefined ? Math.atan2(target.x - destination.x, target.z - destination.z)
          : typeof row.facing === 'number' ? row.facing : destination.yaw ?? body.yaw;
        return { placement: { x: destination.x, z: destination.z, yaw, ...(destination.y === undefined ? {} : { y: destination.y }) }, ...this.finish(true) };
      }
      case 'orbit': this.angle += (row.angularSpeed ?? row.speed / row.r) / 60; return { steering: orbitSteering(row, body, this.angle) };
      case 'stalk': {
        if (target === undefined) throw new Error('Missing move target');
        const result = stalkSteering(row, body, target, observation.range);
        return { steering: result.steering, ...(result.ready ? this.finish(true) : row.giveUp !== undefined && this.elapsed >= row.giveUp ? this.finish(false) : {}) };
      }
      case 'dive': {
        if (target === undefined) throw new Error('Missing move target');
        if (row.strike !== undefined && !row.contactCompletes && observation.range === undefined) throw new Error('Dive strike requires its admitted range');
        const reached = observation.reach === true && (observation.range === undefined || Math.hypot(target.x - body.position.x,
          target.y + row.aimHeight - body.position.y, target.z - body.position.z) <= observation.range);
        const fire = reached && row.strike !== undefined && !this.strikeIssued;
        if (fire) this.strikeIssued = true;
        return { steering: diveSteering(row, body, target), ...(fire ? { strike: row.strike } : {}),
          ...(reached && row.contactCompletes ? this.finish(true) : this.elapsed >= row.maxSeconds ? this.finish(false) : {}) };
      }
      case 'climb': return { steering: { yaw: body.yaw, speed: row.speed + row.speedBonus, altitude: row.altitude, turn: row.turn, ground: row.ground },
        ...(this.elapsed >= row.seconds ? this.finish(true) : {}) };
      case 'takeoff': {
        if (target === undefined || perch === undefined) throw new Error('Missing departure target');
        return { ...takeoffSteering(row, body, target, perch.y, this.elapsed / row.seconds), ...(this.elapsed >= row.seconds ? this.finish(true) : {}) };
      }
      case 'perch': {
        if (perch === undefined) throw new Error('Missing move perch');
        const d = distance(body, perch), arrived = d <= row.arrival && Math.abs(body.position.y - perch.y) <= row.arrival;
        return { steering: { yaw: d > row.arrival ? yawTo(body, perch) : perch.yaw, speed: d > row.arrival ? Math.min(row.speed, d * 1.2) : 0,
          altitude: perch.y, turn: row.turn, ground: row.ground }, ...(arrived ? this.finish(true) : {}) };
      }
      case 'rise': case 'lie': {
        const span = Math.abs(row.to - row.from), progress = span === 0 ? 1 : Math.min(1, row.rate * this.elapsed / span);
        return { steering: riseSteering(row, body, progress), ...(progress === 1 && Math.abs(body.position.y - row.to) < 0.05 ? this.finish(true) : {}) };
      }
      case 'ring-run': {
        if (target === undefined) throw new Error('Missing ring center');
        const angle = row.angle + row.angularSpeed * this.elapsed, d = distance(body, target);
        return { steering: { yaw: yawTo(body, d < row.closeRadius ? target : { x: target.x + Math.cos(angle) * row.radius, z: target.z + Math.sin(angle) * row.radius }),
          speed: d < row.stopDistance ? 0 : row.speed, altitude: body.position.y, turn: row.turn, ground: row.ground } };
      }
      case 'burrow': case 'surface': {
        const from = observation.field; if (from === undefined) throw new Error('Missing move field');
        const value = clamp(from + (row.kind === 'burrow' ? 1 : -1) * row.rate / 60, 0, 1);
        return { field: { id: row.field, value }, ...(value === (row.kind === 'burrow' ? 1 : 0) ? this.finish(true) : {}) };
      }
      default: { const unreachable: never = row; throw new Error(`Unknown move ${String(unreachable)}`); }
    }
  }
  private finish(ok: boolean): { done: boolean } { this.complete = true; return { done: ok }; }
}

/** Complete admitted continuation, independent of validator implementation metadata. */
type ActorMoveSavedDataInput = ActorMoveSavedData;
interface ActorMoveSavedDataFields {
    version: 1;
    contract: string;
    elapsed: number;
    angle: number;
    complete: boolean;
    strikeIssued?: boolean;
}
type ActorMoveSavedData = { [Key in keyof ActorMoveSavedDataFields]: ActorMoveSavedDataFields[Key] };
