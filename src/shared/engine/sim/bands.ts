import type { TickBand, TickRate } from '../app/scheduler';
import { fnv1a32 } from '../core/rng';

/**
 * The distance bands the page updates creatures on, as pure data and arithmetic shared by the page and the renderer-free
 * host (SF72): the page's `TickScheduler` (app/scheduler.ts) and `CreatureBodies` (physics/creatures.ts) run on these
 * functions, and `SimHost.useBodyBands` (sim.ts) runs the same ones on its fixed step, so a headless witness moves a far
 * herd exactly as often as the page does.
 *
 * - **Cadence:** a tick rate is a list of bands by distance to the player (3D). The scheduler's 'ai' rate decides at
 *   20 Hz and updates the body every frame within 60 m, decides at 10 Hz and updates the body every other frame
 *   ('half', the two frames' time as one step) to 160 m, and pauses both beyond (the time away is discarded, never
 *   replayed on return).
 * - **Physics body:** a live, un-driven creature gains a physics body (a creature `CharacterMotor`) within 45 m of the
 *   player (horizontal distance) and loses it past 55 m; far creatures move without collision.
 */

/** One subject's clock on one tick rate: the page scheduler's per-subject brain or body clock, plain JSON values. */
export interface TickClock { elapsed: number; credit: number; frame: number; dt: number; last: number; due: boolean; tickFrame: number }

/** The scheduler's 'ai' rate (also 'npc'): decisions 20 Hz / 10 Hz / paused, the body every frame / 'half' / paused. */
export const AI_TICK_RATE: TickRate = { bands: [
  { upTo: 60, brainHz: 20, body: 'frame' },
  { upTo: 160, brainHz: 10, body: 'half' },
  { upTo: Infinity, brainHz: 'paused', body: 'paused' },
] };
/** A pinned, driven or fight-scripted subject: it decides and moves every frame at any distance. */
export const ALWAYS_TICK_RATE: TickRate = { bands: [{ upTo: Infinity, brainHz: Infinity, body: 'frame' }] };
/** The scheduler's built-in rates by id; a level's tier `ticks` add to or replace them. */
export const DEFAULT_TICK_RATES: readonly (readonly [string, TickRate])[] = [
  ['always', ALWAYS_TICK_RATE], ['ai', AI_TICK_RATE], ['npc', AI_TICK_RATE],
  ['fx', { bands: [{ upTo: 120, brainHz: 30, body: 'frame' }, { upTo: Infinity, brainHz: 'paused', body: 'paused' }] }],
  ['weather', { bands: [{ upTo: Infinity, brainHz: 10, body: 'frame' }] }],
];

/** The creature manager's 'legacy' rate (AnimalManager.configureTicks), set over any level override: a self-thinking
 *  species' decisions at 10 Hz and its body every frame at any distance. */
export const LEGACY_TICK_RATE: TickRate = { bands: [{ upTo: Infinity, brainHz: 10, body: 'frame' }] };

/** Refuse a rate whose bands do not rise strictly, with a positive rate each, up to an unbounded last band. */
export function checkTickRate(id: string, rate: TickRate): void {
  let previous = -Infinity;
  for (const band of rate.bands) {
    if (!(band.upTo > previous) || (band.brainHz !== 'paused' && !(band.brainHz > 0))) throw new Error(`Invalid tick rate: ${id}`);
    previous = band.upTo;
  }
  if (previous !== Infinity) throw new Error(`Tick rate must cover every distance: ${id}`);
}

/** A subject's fresh clock: it starts one frame ago (`time - frameDt`), so its first step is one frame, never a catch-up. */
export function freshClock(time: number, frameDt: number): TickClock {
  return { elapsed: 0, credit: 0, frame: -1, dt: 0, last: time - frameDt, due: false, tickFrame: -1 };
}

/** The scheduler's distance: straight-line 3D from the player. */
export function tickDistance(at: { readonly x: number; readonly y: number; readonly z: number }, player: { readonly x: number; readonly y: number; readonly z: number }): number {
  return Math.hypot(at.x - player.x, at.y - player.y, at.z - player.z);
}

/** The first band covering `distance` (undefined only for a rate that `checkTickRate` refuses). */
export function bandAt(rate: TickRate, distance: number): TickBand | undefined {
  return rate.bands.find((entry) => distance < entry.upTo);
}

/**
 * Advance one clock to frame `frame` at time `time` (s) and return its step (s; 0 = not due this frame). A clock asked
 * twice in one frame answers the first step again, unless `urgent` (an interrupt: it wakes decisions at once, without
 * catching up time spent paused). A brain is due once its credit reaches one period of its band's rate (the remainder
 * carried); a 'frame' body every frame; a 'half' body every other frame, its step the time since its last update; a
 * paused clock discards the time and starts again one frame's step after the pause.
 * A supplied stable body identity splits unstarted half-body wakes by parity;
 * existing positive tickFrame phases, decision clocks and the save shape stay intact.
 */
export function tickClock(state: TickClock, band: TickBand, body: boolean, time: number, frame: number, urgent: boolean, bodyIdentity?: string): number {
  if (state.frame === frame && !urgent) return state.dt;
  const step = time - state.last;
  state.last = time;
  const paused = body ? band.body === 'paused' : band.brainHz === 'paused';
  if (paused) { state.elapsed = 0; state.credit = 0; state.tickFrame = -1; }
  else { state.elapsed += step; state.credit += step; }
  state.frame = frame; state.dt = 0; state.due = false;
  // Only an unstarted half-body clock chooses a phase. Zero-time warm-up
  // does not choose it; restored positive tickFrame values retain their phase.
  if (body && band.body === 'half' && state.tickFrame < 0 && state.elapsed > 0
    && bodyIdentity !== undefined && (fnv1a32(bodyIdentity) & 1) !== 0) state.tickFrame = frame - 1;
  if (urgent || (!paused && (body ? band.body === 'frame' || state.tickFrame < 0 || frame - state.tickFrame >= 2 : band.brainHz !== 'paused' && state.credit + 1e-9 >= 1 / band.brainHz))) {
    state.due = urgent || state.elapsed > 0; state.dt = state.elapsed; state.elapsed = 0;
    if (state.due) state.tickFrame = frame;
    state.credit = urgent || body || band.brainHz === 'paused' || band.brainHz === Infinity ? 0
      : Math.max(0, state.credit - Math.floor((state.credit + 1e-9) * band.brainHz) / band.brainHz);
  }
  return state.dt;
}

/** A creature gains its physics body within this horizontal distance of the player (m). */
export const CREATURE_BODY_NEAR = 45;
/** … and loses it past this one (m): the 10 m between keeps a creature at the edge from churning colliders. */
export const CREATURE_BODY_FAR = 55;

/** The physics body LOD's distance: horizontal, from the player. */
export function creatureBodyDistance(at: { readonly x: number; readonly z: number }, player: { readonly x: number; readonly z: number }): number {
  return Math.hypot(at.x - player.x, at.z - player.z);
}

/** Whether a creature holds a physics body after this sync: gained live, un-driven and within NEAR; lost dead, driven or past FAR. */
export function keepsCreatureBody(has: boolean, live: boolean, driven: boolean, distance: number): boolean {
  return has ? !(!live || distance > CREATURE_BODY_FAR || driven) : live && distance < CREATURE_BODY_NEAR && !driven;
}

/** The page's creature body capsule for a body of these dimensions and scale (CreatureBodies' motor recipe). */
export function creatureBodyShape(dims: { readonly bodyRadius: number; readonly bodyHalfLen: number; readonly bodyY: number }, scale: number): { radius: number; height: number; step: number; maxClimbDeg: number; snap: number } {
  const radius = Math.max(0.12, Math.min(0.9, Math.min(dims.bodyRadius, dims.bodyHalfLen) * scale));
  return { radius, height: Math.max(radius * 2 + 0.05, (dims.bodyY + dims.bodyRadius) * scale), step: 0.3 * Math.max(1, scale), maxClimbDeg: 45, snap: 0.3 };
}

/** One host body's band row: its rate id and its brain and body clocks. */
export interface BandRow { rate: string; brain: TickClock; body: TickClock }
/** A host's band state as plain JSON (SimSnapshot.bands). */
export interface BandsState { rates: number; time: number; frame: number; frameDt: number; rows: ({ id: string } & BandRow)[] }

/**
 * Per-body band clocks for a fixed-step host (the page scheduler's rates plus the creature manager's 'legacy'), keyed by stable body id (serializable, unlike the page scheduler's
 * object-keyed subjects). Each `beginTick` is one page frame; a body that changes rate id starts a fresh clock, as a
 * page subject that switches cadence does.
 */
export class BodyBandClocks {
  private readonly rates = new Map<string, TickRate>(DEFAULT_TICK_RATES);
  private readonly rows = new Map<string, BandRow>();
  private readonly contract: number;
  private time = 0;
  private frame = 0;
  private frameDt = 0;
  constructor(overrides: Readonly<Record<string, TickRate>> = {}) {
    for (const [id, rate] of Object.entries(overrides)) { checkTickRate(id, rate); this.rates.set(id, { bands: structuredClone(rate.bands) }); }
    this.rates.set('legacy', LEGACY_TICK_RATE);
    this.contract = fnv1a32(JSON.stringify([...this.rates].sort(([a], [b]) => a.localeCompare(b)), (_key, value: unknown) => value === Infinity ? 'infinity' : value));
  }
  /** One frame of `dt` seconds. */
  beginTick(dt: number): void { this.time += dt; this.frameDt = dt; this.frame++; }
  has(rate: string): boolean { return this.rates.has(rate); }
  private row(id: string, rate: string): { row: BandRow; band: (distance: number) => TickBand } {
    const table = this.rates.get(rate);
    if (table === undefined) throw new Error(`Unknown tick rate: ${rate}`);
    let row = this.rows.get(id);
    if (row?.rate !== rate) { row = { rate, brain: freshClock(this.time, this.frameDt), body: freshClock(this.time, this.frameDt) }; this.rows.set(id, row); }
    return { row, band: (distance) => { const band = bandAt(table, distance); if (band === undefined) throw new Error(`Uncovered tick distance: ${rate}`); return band; } };
  }
  /** This frame's body step for `id` at `distance` (m) on `rate`; 0 = paused or the off frame of 'half'. */
  bodyDt(id: string, rate: string, distance: number): number {
    const { row, band } = this.row(id, rate);
    return tickClock(row.body, band(distance), true, this.time, this.frame, false, id);
  }
  /** This frame's decision step for `id`; `urgent` (a hit, a lost sight line) wakes it now. The step is taken (consumed). */
  takeBrainDt(id: string, rate: string, distance: number, urgent: boolean): number {
    const { row, band } = this.row(id, rate);
    const dt = tickClock(row.brain, band(distance), false, this.time, this.frame, urgent);
    row.brain.dt = 0; row.brain.due = false;
    return dt;
  }
  forget(id: string): void { this.rows.delete(id); }
  snapshot(): BandsState {
    return { rates: this.contract, time: this.time, frame: this.frame, frameDt: this.frameDt,
      rows: [...this.rows].map(([id, row]) => ({ id, rate: row.rate, brain: { ...row.brain }, body: { ...row.body } })) };
  }
  /** Exact restore; `ids` are the bodies the host holds. A different rate table, an unknown body or rate refuses. */
  restore(saved: BandsState, ids: ReadonlySet<string>): void {
    if (saved.rates !== this.contract || !Number.isSafeInteger(saved.frame) || saved.frame < 0 || saved.rows.some((row) => !ids.has(row.id) || !this.rates.has(row.rate)
      || [row.brain, row.body].some((clock) => clock.frame > saved.frame || clock.tickFrame > saved.frame || clock.last > saved.time))
      || new Set(saved.rows.map((row) => row.id)).size !== saved.rows.length) throw new RangeError('Incompatible body band continuation');
    this.time = saved.time; this.frame = saved.frame; this.frameDt = saved.frameDt;
    this.rows.clear();
    for (const { id, rate, brain, body } of saved.rows) this.rows.set(id, { rate, brain: { ...brain }, body: { ...body } });
  }
}
