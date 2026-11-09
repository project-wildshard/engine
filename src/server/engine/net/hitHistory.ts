// P1-E5.3-G1 (J50, J127, E5-REPLICATION §6.2): where every hittable stood on each recent tick, so a player's blow is settled
// against what that player saw. Bodies and their colliders never move: a query reads a `RewoundBody` beside the real one.
import { Vector3 } from 'three';
import type { AnimalSim } from '../../../shared/engine/entities/AnimalSim';
import { hitHistoryOf, publishHitHistory } from '../combat/rewind';
import type { SimHost } from '../sim';
import type {HitRewind} from '../../../shared/engine/net/measurements';

/** The furthest back a hit reads, in ticks: 200 ms at 60 Hz (J50). Past it the shooter leads. */
export const REWIND_TICKS = 12;
/** Now and every tick back to the cap. */
const ROWS = REWIND_TICKS + 1;
/** A row: x, y, z, yaw. */
const FIELDS = 4;
/** What one body costs: its rows, f32. */
export const HIT_HISTORY_BYTES: number = ROWS * FIELDS * Float32Array.BYTES_PER_ELEMENT;

/**
 * A body as it stood on a past tick: its feet and facing from the history, its volumes from the live body carried there. The
 * shape is the present one, so a posed joint reads today's pose at the old place, which holds for 200 ms of animation.
 */
export class RewoundBody {
  rewind:HitRewind|undefined;
  readonly position: Vector3 = new Vector3();
  readonly body: AnimalSim;
  private cos = 1; private sin = 0;
  constructor(body: AnimalSim) { this.body = body; }
  get entityId(): string { return this.body.entityId; }
  get alive(): boolean { return this.body.alive; }
  get hidden(): boolean { return 'hidden' in this.body && this.body.hidden === true; }
  get scale(): number { return this.body.scale; }
  get dims(): AnimalSim['dims'] { return this.body.dims; }
  /** Stand at a row of feet and yaw. */
  place(x: number, y: number, z: number, yaw: number): void {
    const turn = yaw - this.body.yaw;
    this.position.set(x, y, z); this.cos = Math.cos(turn); this.sin = Math.sin(turn);
  }
  /** Carry a point on the live body to the same place on this one. */
  private past(point: Vector3): Vector3 {
    const { position: at } = this.body, x = point.x - at.x, z = point.z - at.z;
    return point.set(this.position.x + x * this.cos + z * this.sin, point.y - at.y + this.position.y, this.position.z - x * this.sin + z * this.cos);
  }
  /** A contact on this body, at the same place on the live one: where the blow lands now. */
  present(point: Vector3, out: Vector3): Vector3 {
    const { position: at } = this.body, x = point.x - this.position.x, z = point.z - this.position.z;
    return out.set(at.x + x * this.cos - z * this.sin, point.y - this.position.y + at.y, at.z + x * this.sin + z * this.cos);
  }
  headWorld(out: Vector3): Vector3 { this.body.headWorld(out); return this.past(out); }
  bodyCapsule(rear: Vector3, front: Vector3): void { this.body.bodyCapsule(rear, front); this.past(rear); this.past(front); }
  foreCapsule(rear: Vector3, front: Vector3): boolean {
    if (!this.body.foreCapsule(rear, front)) return false;
    this.past(rear); this.past(front); return true;
  }
}

interface Track { readonly body: AnimalSim; readonly rows: Float32Array; readonly seen: RewoundBody; readonly first: number; last: number }

/** Each hittable's last `ROWS` ticks. It reads the sim and writes nothing back, so nothing it holds is saved: a restored room starts empty and reads the present. */
export class HitHistory {
  /** Only an operator playtest allocates per-query measurement metadata. */
  measureRewinds=false;
  private readonly host: SimHost;
  private readonly tracks = new Map<string, Track>();
  private readonly roster: RewoundBody[] = [];
  constructor(host: SimHost) {
    this.host = host; publishHitHistory(host, this);
    host.onStep('net.hit-history', () => { this.record(); }, undefined, 'afterBodies');
  }
  /** Bytes the rows hold now, against §6.2's 18 KB estimate for 64 bodies. */
  get bytes(): number { return this.tracks.size * HIT_HISTORY_BYTES; }
  /** Note every body as this tick leaves it: what a frame of this tick shows. */
  private record(): void {
    const { tracks, host } = this, tick = host.state.tick, at = (tick % ROWS) * FIELDS;
    for (const [id, body] of host.entities) {
      let track = tracks.get(id);
      if (track?.body !== body) { track = { body, rows: new Float32Array(ROWS * FIELDS), seen: new RewoundBody(body), first: tick, last: tick }; tracks.set(id, track); }
      const { rows } = track, p = body.position;
      rows[at] = p.x; rows[at + 1] = p.y; rows[at + 2] = p.z; rows[at + 3] = body.yaw;
      track.last = tick;
    }
    for (const [id, track] of tracks) if (track.last !== tick) tracks.delete(id);
  }
  /**
   * The tick a command's `viewTick` means now: its 16 bits unwrapped against `now`, clamped to the cap (J50). Null reads the
   * present: 0 is a command that claims no view, and a view at or past `now` has nothing to rewind.
   */
  tickOf(viewTick: number): number | null {
    if (viewTick === 0) return null;
    const now = this.host.state.tick, behind = ((now - viewTick + 0x8000) & 0xffff) - 0x8000;
    return behind <= 0 ? null : now - Math.min(behind, REWIND_TICKS);
  }
  /** Stand a track at `tick`, or at its first row if the body is newer. */
  private stand(track: Track, tick: number): RewoundBody {
    const at = (Math.max(tick, track.first) % ROWS) * FIELDS, { rows, seen } = track;
    seen.place(rows[at] ?? 0, rows[at + 1] ?? 0, rows[at + 2] ?? 0, rows[at + 3] ?? 0);
    return seen;
  }
  /**
   * Every body as `viewTick` saw it, in roster order, or null to read the present. The list and its bodies are reused: read
   * them before the next call. A body spawned this very tick has no row, and nobody saw it.
   */
  at(viewTick: number): readonly RewoundBody[] | null {
    const tick = this.tickOf(viewTick); if (tick === null) return null;
    const now=this.host.state.tick,requested=((now-viewTick+0x8000)&0xffff)-0x8000;
    const { roster, tracks } = this; roster.length = 0;
    for (const [id, body] of this.host.entities) {
      const track = tracks.get(id);
      if (track?.body === body){const seen=this.stand(track,tick);if(this.measureRewinds)seen.rewind={requested,applied:now-Math.max(tick,track.first),clamped:requested>REWIND_TICKS};roster.push(seen);}
    }
    return roster;
  }
}
/** The host's history, kept from now on. */
export function keepHitHistory(host: SimHost): HitHistory { return hitHistoryOf(host) ?? new HitHistory(host); }
