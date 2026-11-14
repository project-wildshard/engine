// P1-E5.3-C4 (E5-REPLICATION §5.2): client-side prediction of one's own character. Every fixed step runs the shared motion
// step at once and saves the state after it; every frame compares the server's state at `lastSeq` with what was saved, and
// only a difference over tolerance puts the server's state back and replays the commands the server has not reached.
// The world is never rolled back, only this character (J59 Q10).
import type { Vector3 } from 'three';
import type { NetCommand } from '@wildshard/wire/netCommand';
import { seqAfter } from '../../../shared/engine/net/command';
import type { NetColumn } from '../../../shared/engine/net/schema';
import { CAPTURED, captureMotion, MOTION_WORDS, restoreMotion } from '../../../shared/engine/player/motionState';
import type { PlayerMotionState } from '../../../shared/engine/player/motion';
import type { PredictedRide } from '../../../shared/engine/player/modes';
import type { CharacterMotor, MoveResult } from '../../../shared/engine/physics/CharacterMotor';
import type { NetCorrection } from '../../../shared/engine/net/measurements';

/** Saved moves: about a second. A full ring means the server has stopped answering, and the player holds still. */
export const PREDICTION_RING = 64;
/** E5-REPLICATION §9: position within this, and equal flags, is a match. */
export const PREDICTION_TOLERANCE = 0.02;
/**
 * Ticks a command can land from where a client guessed. A deck stands at the tick a command runs on the server, and a client
 * knows that tick only to within the queue's own depth, so on a moving deck the feet can be this many of its steps off in
 * phase with nothing wrong: the same spot on the deck. Correcting that would chase the deck for ever.
 */
const DECK_PHASE_TICKS = 3;
/** NET-LAG NL12 (a): a grounded Y-only gap up to this, on matching XZ, is the same floor (J282: 150 to 200 ms is the design target). */
export const GROUND_Y_SLACK = 0.05;
/** A correction this far is a teleport: it snaps rather than glides. */
export const PREDICTION_SNAP = 3;
/** Room for a ride's words and its capsule's in a saved move. */
const RIDE_ROOM = 64;
/** One saved move. */
const SAVED_WORDS: number = MOTION_WORDS + RIDE_ROOM;
/** Seconds the camera takes to lose about two thirds of a correction. */
const SMOOTH_TIME = 0.1;

/** What a predictor drives. */
export interface PredictedBody {
  readonly motionState: PlayerMotionState;
  readonly motor: CharacterMotor;
  /** What carries it now, or null on foot. */
  readonly ride: PredictedRide | null;
  /** Added to the camera's feet. */
  readonly renderOffset: Vector3;
  /** One step of a quantised command. `replay`: the second run of a step, which fires no sound, event or view moment. False
   *  when something else owned the motion that step (a ride, a traversal), so a replay skips it. */
  step: (command: NetCommand, replay: boolean) => boolean;
}

const orNull = (value: number): number | null => Number.isNaN(value) ? null : value;
/** Owner block columns to the state they carry. A field not listed here keeps its saved value on a correction. */
const OWNER_WRITES: Readonly<Record<string, (s: PlayerMotionState, value: number, ground: MoveResult) => void>> = {
  px: (s, value) => { s.position.x = value; }, py: (s, value) => { s.position.y = value; }, pz: (s, value) => { s.position.z = value; },
  vx: (s, value) => { s.velocity.x = value; }, vy: (s, value) => { s.velocity.y = value; }, vz: (s, value) => { s.velocity.z = value; },
  dashT: (s, value) => { s.dash.t = value; }, dashX: (s, value) => { s.dash.vx = value; }, dashZ: (s, value) => { s.dash.vz = value; },
  dodgeT: (s, value) => { s.dodge.t = value; }, dodgeCd: (s, value) => { s.dodge.cd = value; },
  shoveT: (s, value) => { s.shove.t = value; }, shoveX: (s, value) => { s.shove.vx = value; }, shoveZ: (s, value) => { s.shove.vz = value; },
  impulseX: (s, value) => { s.impulse.x = value; }, impulseY: (s, value) => { s.impulse.y = value; }, impulseZ: (s, value) => { s.impulse.z = value; },
  lockR0: (s, value) => { s.lock.r0 = value; }, jumpAgo: (s, value) => { s.jump.ago = value; }, jumpLeft: (s, value) => { s.jump.left = value; },
  hoverBob: (s, value) => { s.board.hoverBob = value; },
  climbTo: (s, value) => { s.swim.climbTo = orNull(value); }, climbCooldown: (s, value) => { s.swim.climbCooldown = value; }, strokeTime: (s, value) => { s.swim.strokeTime = value; },
  water: (s, value) => { s.footing.water = orNull(value); }, depth: (s, value) => { s.footing.depth = value; },
  groundNormalY: (_s, value, ground) => { ground.groundNormalY = value; }, downhillX: (_s, value, ground) => { ground.downhillX = value; }, downhillZ: (_s, value, ground) => { ground.downhillZ = value; },
  freedom: (_s, value, ground) => { ground.horizontalFreedom = value; },
  moveScale: (s, value) => { s.moveScale = value; },
};
const OWNER_FLAGS: Readonly<Record<string, (s: PlayerMotionState, value: boolean, ground: MoveResult) => void>> = {
  grounded: (s, value) => { s.fall.grounded = value; }, board: (s, value) => { s.board.on = value; }, swim: (s, value) => { s.swim.on = value; },
  hoverAir: (s, value) => { s.board.hoverAir = value; }, stood: (s, value) => { s.swim.stood = value; }, diving: (s, value) => { s.swim.diving = value; },
  wading: (s, value) => { s.footing.wading = value; }, onPlatform: (s, value) => { s.footing.onPlatform = value; }, sliding: (s, value) => { s.footing.sliding = value; },
  motorGrounded: (_s, value, ground) => { ground.grounded = value; },
};

/** The owner block's columns as the predictor reads them, resolved once. */
interface OwnerTable { readonly x: number; readonly y: number; readonly z: number; readonly grounded: number; readonly board: number; readonly swim: number; readonly led: number; readonly resets: number }
function ownerTable(columns: readonly NetColumn<never>[]): OwnerTable {
  const at = (name: string): number => {
    const index = columns.findIndex(column => column.name === name);
    if (index === -1) throw new Error(`Owner block has no ${name}`);
    return index;
  };
  return { x: at('px'), y: at('py'), z: at('pz'), grounded: at('grounded'), board: at('board'), swim: at('swim'), led: at('led'), resets: at('resets') };
}

/** One player's prediction. */
export class Predictor {
  /** Corrections taken, and steps replayed for them: what a proof page reports. */
  corrections = 0; replays = 0;
  /** What each correction disagreed on, and the widest gap at the acknowledged step. */
  readonly missed = { position: 0, grounded: 0, board: 0, swim: 0, ride: 0, gap: 0 };
  readonly misses: number[][] = [];
  private readonly body: PredictedBody;
  private readonly columns: readonly NetColumn<never>[];
  private readonly table: OwnerTable;
  private readonly corrected:((row:Omit<NetCorrection,'kind'|'session'>)=>void)|undefined;
  private readonly seqs = new Uint16Array(PREDICTION_RING);
  private readonly owned = new Uint8Array(PREDICTION_RING);
  private readonly commands: (NetCommand | null)[] = Array.from({ length: PREDICTION_RING }, () => null);
  private readonly rode = new Uint8Array(PREDICTION_RING);
  private readonly states = new Float64Array(PREDICTION_RING * SAVED_WORDS);
  private head = 0;
  private count = 0;
  private acked: number | null = null;
  /** The server is carrying this body (the owner block's `led`), as of the newest frame: nothing here steps it. */
  private led = false;
  private resets: number | null = null;
  /** The newest frame has this body on a ride. */
  private aboard = false;
  constructor(body: PredictedBody, columns: readonly NetColumn<never>[], corrected?: (row:Omit<NetCorrection,'kind'|'session'>)=>void) {
    this.corrected=corrected;
    this.body = body; this.columns = columns; this.table = ownerTable(columns);
  }
  /** The ring is full: run no step and send no command until a frame frees it. */
  get full(): boolean { return this.count === PREDICTION_RING; }
  /** Moves the server has not acknowledged. */
  get pending(): number { return this.count; }
  /** The server is carrying this body now. */
  get leading(): boolean { return this.led; }

  /** Run and save one step. False, with nothing changed, when the ring is full. While the server leads the step is only saved:
   *  it was sent, and if the server ends up taking it free, the frame that ends the lead replays it. */
  step(command: NetCommand): boolean {
    if (this.full) return false;
    const { body } = this, slot = (this.head + this.count) % PREDICTION_RING;
    this.owned[slot] = this.led || body.step(command, false) ? 1 : 0;
    this.seqs[slot] = command.seq; this.commands[slot] = command;
    this.save(slot);
    this.count++;
    return true;
  }
  private save(slot: number): void {
    const { body, states } = this, at = slot * SAVED_WORDS, { ride } = body;
    captureMotion(body.motionState, body.motor, states, at);
    this.rode[slot] = ride === null ? 0 : 1;
    ride?.capture(states, at + MOTION_WORDS);
  }

  /**
   * A frame: `lastSeq` is the newest command the server has stepped, `owner` its state after it. True when it corrected.
   * While the owner block says `led` the server's state is taken as it comes, with no compare and no replay. The frame that
   * ends the lead, or that says the server reset this body, always takes the server's state, whatever `lastSeq` it brings.
   * `tick`: the frame's, which the client's swell clock takes on every correction. `ridden`: the frame's ride words, null on foot.
   * A frame ahead of the `mount` or `dismount` that explains it waits for it.
   */
  reconcile(lastSeq: number, owner: ArrayLike<number>, tick?: number, ridden: ArrayLike<number> | null = null): boolean {
    const { acked, table } = this;
    if ((acked !== null && seqAfter(acked, lastSeq)) || (this.body.ride === null) !== (ridden === null)) return false;
    const led = this.flag(table.led, owner) === 1, resets = this.value(table.resets, owner);
    const boarded = (ridden !== null) !== this.aboard; // getting on or off is the server's word, not a wrong guess
    const forced = led || this.led || boarded || (this.resets !== null && this.resets !== resets);
    this.led = led; this.resets = resets; this.aboard = ridden !== null;
    if (!forced && acked === lastSeq) return false;
    const { body, seqs, states, count, head } = this, offset = count === 0 ? -1 : (lastSeq - (seqs[head] ?? 0)) & 0xffff;
    this.acked = lastSeq;
    const saved = offset >= 0 && offset < count, slot = (head + offset) % PREDICTION_RING, at = slot * SAVED_WORDS; // else older than the ring, or nothing saved
    if (saved) { this.head = (slot + 1) % PREDICTION_RING; this.count = count - offset - 1; }
    if (!forced && (!saved || this.matches(slot, owner, ridden))) return false;
    const s = body.motionState, { ride } = body, feet = ride?.feet ?? s.position, x = feet.x + body.renderOffset.x, y = feet.y + body.renderOffset.y, z = feet.z + body.renderOffset.z, { yaw } = s;
    if (saved) restoreMotion(s, body.motor, states, at);
    if (saved && this.rode[slot] === 1) ride?.restore(states, at + MOTION_WORDS);
    this.write(s, owner);
    if (ridden !== null) ride?.adopt(ridden);
    if (tick !== undefined) s.tick = tick;
    if (!led) for (let left = 0, run = this.head; left < this.count; left++, run = (run + 1) % PREDICTION_RING) {
      const command = this.commands[run];
      if (command !== null && command !== undefined && this.owned[run] === 1) { body.step(command, true); this.replays++; }
      this.save(run);
    }
    s.yaw = yaw; // the view is this client's own: the server sends it back later than the thumb has moved
    if (!led && !boarded) this.corrections++;
    const offsetX = x - feet.x, offsetY = y - feet.y, offsetZ = z - feet.z, far = offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ > PREDICTION_SNAP * PREDICTION_SNAP;
    body.renderOffset.set(far ? 0 : offsetX, far ? 0 : offsetY, far ? 0 : offsetZ);
    if(!led&&!boarded)this.corrected?.({tick:tick??s.tick,mode:ride!==null?'ride':s.board.on?'board':s.swim.on?'swim':'foot',offset:Math.hypot(offsetX,offsetY,offsetZ),snapped:far});
    return !led && !boarded;
  }

  /** A session's first frame: this body stands where the server says, with nothing to compare it to. */
  adopt(lastSeq: number, owner: ArrayLike<number>, tick?: number, ridden: ArrayLike<number> | null = null, glide = false): void {
    const { body, table } = this, s = body.motionState, { yaw } = s, was = { x: s.position.x, y: s.position.y, z: s.position.z };
    if (tick !== undefined) s.tick = tick;
    this.acked = lastSeq; this.led = this.flag(table.led, owner) === 1; this.resets = this.value(table.resets, owner); this.aboard = ridden !== null;
    this.head = 0; this.count = 0;
    this.write(s, owner);
    s.yaw = yaw;
    body.motor.resetAt(s.position);
    this.write(s, owner); // the reset cleared the ground the owner block had just landed
    if (ridden !== null) body.ride?.adopt(ridden);
    body.renderOffset.set(0, 0, 0);
    // OFFLINE OF10: a page that played unseated glides onto its seat when it is near, as a correction does; a far seat snaps
    if (glide) {
      const dx = was.x - s.position.x, dy = was.y - s.position.y, dz = was.z - s.position.z;
      if (Math.hypot(dx, dy, dz) < PREDICTION_SNAP) body.renderOffset.set(dx, dy, dz);
    }
  }

  /** Each render frame: the camera glides back onto the predicted feet. */
  update(dt: number): void {
    const { renderOffset } = this.body;
    if (renderOffset.x === 0 && renderOffset.y === 0 && renderOffset.z === 0) return;
    renderOffset.multiplyScalar(Math.exp(-dt / SMOOTH_TIME));
    if (renderOffset.lengthSq() < 1e-8) renderOffset.set(0, 0, 0);
  }

  private matches(slot: number, owner: ArrayLike<number>, ridden: ArrayLike<number> | null): boolean {
    const { states, table } = this, at = slot * SAVED_WORDS;
    const { missed } = this;
    if ((this.rode[slot] === 1) !== (ridden !== null)) { missed.ride++; return false; }
    if (ridden !== null) {
      const from = at + MOTION_WORDS, gapX = (ridden[0] ?? 0) - (states[from] ?? 0), gapY = (ridden[1] ?? 0) - (states[from + 1] ?? 0), gapZ = (ridden[2] ?? 0) - (states[from + 2] ?? 0);
      if (gapX * gapX + gapY * gapY + gapZ * gapZ <= PREDICTION_TOLERANCE * PREDICTION_TOLERANCE && ridden[3] === states[from + 3]) return true;
      missed.ride++;
      return false;
    }
    const x = this.value(table.x, owner) - (states[at + CAPTURED.x] ?? 0), y = this.value(table.y, owner) - (states[at + CAPTURED.y] ?? 0), z = this.value(table.z, owner) - (states[at + CAPTURED.z] ?? 0);
    const reach = PREDICTION_TOLERANCE + DECK_PHASE_TICKS * (states[at + CAPTURED.carried] ?? 0), grounded = this.flag(table.grounded, owner) !== states[at + CAPTURED.grounded];
    // NL12 (a): both on the ground, the ground decides Y; a few cm there alone is the same floor, not a miss
    const floorY = !grounded && this.flag(table.grounded, owner) === 1 && Math.abs(y) <= GROUND_Y_SLACK ? 0 : y, gap = x * x + floorY * floorY + z * z;
    if (grounded || gap > reach * reach) this.keepMiss(slot, owner);
    if (gap > reach * reach) { missed.position++; missed.gap = Math.max(missed.gap, Math.hypot(x, y, z)); return false; }
    if (grounded) { missed.grounded++; return false; }
    if (this.flag(table.board, owner) !== states[at + CAPTURED.board]) { missed.board++; return false; }
    if (this.flag(table.swim, owner) !== states[at + CAPTURED.swim]) { missed.swim++; return false; }
    return true;
  }
  /** The first misses, side by side: server x y z grounded, then this client's. */
  private keepMiss(slot: number, owner: ArrayLike<number>): void {
    const { states, table, misses } = this, at = slot * SAVED_WORDS;
    if (misses.length < 48) misses.push([this.value(table.x, owner), this.value(table.y, owner), this.value(table.z, owner), this.flag(table.grounded, owner), states[at + CAPTURED.x] ?? 0, states[at + CAPTURED.y] ?? 0, states[at + CAPTURED.z] ?? 0, states[at + CAPTURED.grounded] ?? 0]);
  }
  private flag(index: number, owner: ArrayLike<number>): number { return this.columns[index]?.value(owner[index] ?? 0) === true ? 1 : 0; }
  private value(index: number, owner: ArrayLike<number>): number {
    const value = this.columns[index]?.value(owner[index] ?? 0);
    return typeof value === 'number' ? value : 0;
  }
  private write(s: PlayerMotionState, owner: ArrayLike<number>): void {
    const { columns } = this, ground = this.body.motor.result;
    for (const [index, column] of columns.entries()) {
      const value = column.value(owner[index] ?? 0);
      if (typeof value === 'number') OWNER_WRITES[column.name]?.(s, value, ground);
      else if (typeof value === 'boolean') OWNER_FLAGS[column.name]?.(s, value, ground);
    }
  }
}
