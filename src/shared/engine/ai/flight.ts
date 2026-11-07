export interface SpeciesFlight {
  altitude: number;
  /** Ground-relative by default; a missing/distant floor falls back to world altitude. */
  above?: 'ground' | 'world';
  climbRate: number; diveRate: number;
  /** Lock acquire distance in metres (eye → body edge); default 24 m, release at 1.5×. */
  lockRange?: number;
  /** The largest roll into a turn, radians (0 < bank < π/2). The body rolls by the coordinated turn's
   * atan(speed × yaw rate / g), capped here. Omitted: the body flies level. */
  bank?: number;
}
/** standard gravity, m/s²: the coordinated turn's bank is atan(v·ω / g) */
const G = 9.81;
interface FlightPoint { x: number; y: number; z: number }
type FloorSampler = (x: number, z: number, fromY: number, maxDrop: number) => number | undefined;
interface FlightState { version: number; altitude: number; sampleIn: number; floor: number | null; smoothFloor: number | null }

/** Flight owns vertical motion, while the existing body still owns heading and speed. */
export class FlightMotion {
  private altitude: number;
  private sampleIn = 0;
  private floor: number | undefined;
  private smoothFloor: number | undefined;
  private readonly spec: SpeciesFlight;
  constructor(spec: SpeciesFlight) {
    this.spec = spec;
    if (!Number.isFinite(spec.altitude) || !Number.isFinite(spec.climbRate) || !Number.isFinite(spec.diveRate) || spec.climbRate <= 0 || spec.diveRate <= 0) throw new Error('Flight needs finite altitude and positive climb/dive rates');
    if (spec.lockRange !== undefined && (!Number.isFinite(spec.lockRange) || spec.lockRange <= 0)) throw new Error('Flight lock range must be finite and positive');
    if (spec.bank !== undefined && !(spec.bank > 0 && spec.bank < Math.PI / 2)) throw new Error('Flight bank must be between 0 and π/2');
    this.altitude = spec.altitude;
  }
  snapshot(): FlightState {
    return { version: 1, altitude: this.altitude, sampleIn: this.sampleIn, floor: this.floor ?? null, smoothFloor: this.smoothFloor ?? null };
  }
  restore(state: FlightState): void {
    if (state.version !== 1 || ![state.altitude, state.sampleIn].every(Number.isFinite)
      || (state.floor !== null && !Number.isFinite(state.floor)) || (state.smoothFloor !== null && !Number.isFinite(state.smoothFloor))) throw new RangeError('Invalid flight snapshot');
    this.altitude = state.altitude; this.sampleIn = state.sampleIn;
    this.floor = state.floor ?? undefined; this.smoothFloor = state.smoothFloor ?? undefined;
  }
  target(altitude: number): void {
    if (!Number.isFinite(altitude)) throw new Error('Flight altitude must be finite');
    this.altitude = altitude;
  }
  /** The roll for a turn at `speed` m/s and `yawRate` rad/s (+ = a turn to the left, the body's +X): the left side
   * dips (a negative roll about the forward axis) in a left turn. 0 for a species without `bank`. */
  bank(speed: number, yawRate: number): number {
    const max = this.spec.bank;
    if (max === undefined || !Number.isFinite(speed) || !Number.isFinite(yawRate)) return 0;
    const roll = Math.max(-max, Math.min(max, Math.atan(speed * yawRate / G)));
    return roll === 0 ? 0 : -roll;
  }
  step(dt: number, position: FlightPoint, alive: boolean, sample: FloorSampler): void {
    if (this.spec.above !== 'world' || !alive) {
      this.sampleIn -= dt;
      if (this.sampleIn <= 0) {
        this.sampleIn = 0.2;
        const floor = sample(position.x, position.z, position.y + 1, 201);
        this.floor = floor !== undefined && Number.isFinite(floor) && position.y - floor <= 200 ? floor : undefined;
        this.smoothFloor ??= this.floor;
      }
      if (this.floor === undefined) this.smoothFloor = undefined;
      else if (this.smoothFloor !== undefined) this.smoothFloor += (this.floor - this.smoothFloor) * Math.min(1, dt * 8);
    }
    if (!alive) { position.y = Math.max(this.floor ?? -Infinity, position.y - this.spec.diveRate * dt); return; }
    const target = this.altitude + (this.spec.above === 'world' ? 0 : this.smoothFloor ?? 0);
    position.y += Math.max(-this.spec.diveRate * dt, Math.min(this.spec.climbRate * dt, target - position.y));
  }
}
