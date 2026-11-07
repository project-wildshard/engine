import type { RespawnRule, RespawnEntry, RespawnTraversal } from '@wildshard/format/populationRespawn';
import type { ReturnProgram } from './returnProgram';
import type { Rng } from '@wildshard/engine/core/rng';

/** Corpse fade/refill mechanics. Timers remain in the caller's original save
 * object; the page can instead observe its actual view's hidden state. */
export const ReturnGate = {
  step(state: { dead: number; fade: number }, row: { readonly delay: number; readonly away: number; readonly fade: number | 'hidden' },
    dt: number, alive: boolean, distance: number, hidden = false): 'none' | 'fade' | 'replace' {
    if (alive) return 'none';
    state.dead += dt;
    if (typeof row.fade === 'number' && state.fade >= 0) state.fade += dt;
    if (state.dead < row.delay || distance < row.away) return 'none';
    if (row.fade === 'hidden') return hidden ? 'replace' : 'fade';
    if (state.fade < 0) { state.fade = 0; return 'fade'; }
    return state.fade >= row.fade ? 'replace' : 'none';
  },
};
/** The player a return must stay out of sight of: in a room, the one nearest the entry. */
type Watcher = (x: number, z: number) => { readonly x: number; readonly z: number };
/** Delayed population returns. Scheduling uses one supplied draw, even for a fixed delay; taking never draws.
 * Native traversal is reverse death order, bounded to 256 and reuses its result; rows select page traversal. */
export class RespawnQueue {
  readonly pending: RespawnEntry[] = [];
  private readonly due: RespawnEntry[] = [];
  private readonly traversal: RespawnTraversal;
  constructor(private rules: Record<string, RespawnRule>, private outOfSight: number,
    traversal?: RespawnTraversal, private readonly program?: ReturnProgram) {
    this.traversal = traversal ?? { order: 'reverse', limit: 256, result: 'reuse' };
    const limit = this.traversal.limit;
    if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1)) throw new RangeError('Invalid population return bound');
  }

  /** The owner draws only for a declared returning kind, preserving lazy stream creation. */
  accepts(kind: string): boolean { return this.rules[kind] !== undefined; }

  /** a kill at `now` (seconds): queue its replacement at (x, z) if the kind comes back at all */
  add(kind: string, variant: string | undefined, herd: number, x: number, z: number, now: number, draw: number, fallback?: RespawnRule): RespawnEntry | null {
    const r = this.rules[kind] ?? fallback;
    if (!r) return null;
    if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new RangeError('Invalid population return draw');
    const due = this.program === undefined ? now + r.delay.min + (r.delay.max - r.delay.min) * draw
      : this.program.project('schedule', { now, minimum: r.delay.min, maximum: r.delay.max, draw })['due'];
    if (due === undefined || !Number.isFinite(due)) throw new Error('Missing return deadline');
    const e: RespawnEntry = { kind, variant, herd, x, z, due, night: r.night === true };
    this.pending.push(e);
    return e;
  }

  /** Remove one eligible entry without copying it; traversal and result ownership stay with each caller. */
  private takeAt(i: number, now: number, first: Watcher, night: number, out: RespawnEntry[]): void {
    const e = this.pending[i];
    if (e === undefined) return;
    const { x: px, z: pz } = first(e.x, e.z);
    if (this.program === undefined) {
      if (now < e.due || (e.night && night < 0.5) || (e.x - px) ** 2 + (e.z - pz) ** 2 < this.outOfSight * this.outOfSight) return;
    } else if (this.program.project('eligible', { now, due: e.due, nocturnal: Number(e.night), night, x: e.x, z: e.z, playerX: px, playerZ: pz, away: this.outOfSight })['eligible'] !== 1) return;
    out.push(e); this.pending.splice(i, 1);
  }

  /** Rows choose traversal and result ownership without changing pending-entry identity. */
  take(now: number, px: number, pz: number, night: number, nearest?: Watcher): RespawnEntry[] {
    const watcher: Watcher = nearest ?? (() => ({ x: px, z: pz }));
    const out = this.traversal.result === 'reuse' ? this.due : []; out.length = 0;
    const length = this.pending.length;
    if (this.traversal.limit !== null && length > this.traversal.limit) throw new Error('Population return queue exceeds its native bound');
    if (this.traversal.order === 'reverse') {
      for (let i = length - 1; i >= 0; i--) this.takeAt(i, now, watcher, night, out);
    } else {
      for (let i = 0; i < this.pending.length;) {
        const before = this.pending.length;
        this.takeAt(i, now, watcher, night, out);
        if (before === this.pending.length) i++;
      }
    }
    return out;
  }

  /** The guest chooses a candidate or a later retry; the queue retains the
   * original entry object, so actor identity ownership never moves into Wasm. */
  place(entry: RespawnEntry, now: number, water: number, fixed: boolean, random: Rng): { x: number; z: number } | null {
    if (this.program === undefined) throw new Error('Return placement requires a program');
    const result = this.program.project('place', { x: entry.x, z: entry.z, now, water, fixed: Number(fixed) }, random);
    const x = result['x'], z = result['z'], retry = result['retry'];
    if (x === undefined || z === undefined || retry === undefined || retry < 0) throw new Error('Missing return placement');
    if (retry > 0) { entry.due = retry; this.pending.push(entry); return null; }
    return { x, z };
  }
}
