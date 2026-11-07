/**
 * The ambient forager (G466 H6, the ground sibling of `./ambientFlock`): small render-free animals that feed, keep
 * watch and bolt, driven from one row (`@wildshard/format/ambientLife#ForagerPolicySchema`). Server-safe; no callback
 * crosses it (G454): the caller owns the population, its placement, clocks and draw (it adds the ground height to the
 * hop lift `motion.y`), and lends its seeded `Rng` and the planted trees. The row's `ground` (null: anywhere) is where a
 * forager may step: inside the chunk, dry, off the pond / cabin pads / creeks, gentle, clear of trunks (`canStep`).
 *
 * Modes: graze → (sentry: up on the hind legs, watching) → alert → flee → (hide: down the home burrow) → graze.
 *   - `grazing.gait` 'hop': a turn and the odd short hop between pauses; 'walk': a slow shuffle to points near home.
 *   - `escape.to` 'away': zig-zag bounds away from the player for `distance` metres, then alert;
 *     'home': a run to the home point, then hidden for `hide` seconds, peeking back up once the player is `emerge` away.
 *   - the scare radius is `scare[0]` (walking), `scare[1]` (fast) or `crouched`; a sentry sees `sentry.sight` times
 *     as far, and with `sentry.alarm` the first sentry that sees the player raises the alarm (`step` returns true; the
 *     caller sends its population home with `bolt`).
 * `ForagerPopulation` owns a population of them (rows, band clocks, private Rng, placement, save / restore).
 * Users: Pine Hollow's hares (hop, away, roaming), Nalati's marmot colonies (walk, home, sentries, saved).
 */
import * as v from 'valibot';
import { Rng } from '../core/rng';
import { BodyBandClocks, DEFAULT_TICK_RATES, bandAt } from '../sim/bands';
import { cabinMask, inChunk, normalAt, pondMask, streamAt, waterLevel } from '../world/Heightfield';
import { terrainHeight } from '../world/terrainHeight';
import type { TreeInstance } from '../world/forest/placement';
import { ForagerContinuation, type ForagerPolicyRows, type ForagerPopulationRows, type ForagerSnapshot } from '@wildshard/format/ambientLife';

export type ForagerMode = 'graze' | 'sentry' | 'alert' | 'flee' | 'hide';
/** One forager's caller-owned state (`foragerState` makes one). `sit` 0..1 is up on the hind legs, `sink` 0..1 down
 *  the burrow; (bx, bz) is home. */
export interface ForagerState {
  mode: ForagerMode; x: number; z: number; yaw: number; bx: number; bz: number;
  fx: number; fz: number; tx: number; tz: number; t: number; dur: number; h: number;
  timer: number; fleeLeft: number; zig: number; headPitch: number; ears: number; sit: number; sink: number;
}
/** Borrowed motion channels (hop lift above the ground, hind / fore leg swing, body pitch); the caller maps them. */
export interface ForagerMotion { y: number; hind: number; fore: number; pitch: number }
/** where the player is and how it moves (fast: running / sprinting) */
export interface ForagerPlayer { readonly x: number; readonly z: number }
type Posture = ForagerPolicyRows['posture']['graze'];
const TAU = Math.PI * 2, CELL = 16;
const cellKey = (cx: number, cz: number): number => (cx + 512) * 1024 + (cz + 512);
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** A forager at rest at (x, z) facing `yaw`, home at (bx, bz) (default: where it stands). */
export function foragerState(x: number, z: number, yaw: number, bx: number = x, bz: number = z): ForagerState {
  return { mode: 'graze', x, z, yaw, bx, bz, fx: x, fz: z, tx: x, tz: z, t: 1, dur: 1, h: 0, timer: 0, fleeLeft: 0, zig: 0, headPitch: 0.5, ears: 0.2, sit: 0, sink: 0 };
}

/** One forager row's behaviour; `step` each forager once per scheduled tick. */
export class AmbientForager {
  readonly rows: ForagerPolicyRows;
  private readonly random: Rng;
  private readonly cells = new Map<number, TreeInstance[]>();
  constructor(rows: ForagerPolicyRows, random: Rng, trees: readonly TreeInstance[] = []) {
    this.rows = rows; this.random = random;
    for (const t of trees) { const k = cellKey(Math.floor(t.x / CELL), Math.floor(t.z / CELL)), list = this.cells.get(k); if (list) list.push(t); else this.cells.set(k, [t]); }
  }

  /** open, dry, gentle ground off the trunks, per the row's `ground` (null: anywhere) */
  canStep(x: number, z: number): boolean {
    const g = this.rows.ground;
    if (g === null) return true;
    if (!inChunk(x, z, g.margin) || terrainHeight(x, z) < waterLevel() + g.aboveWater || pondMask(x, z) > g.pond || cabinMask(x, z) > g.cabin) return false;
    if ((g.stream && streamAt(x, z) !== null) || normalAt(x, z)[1] < g.slope) return false;
    for (let cx = Math.floor((x - 3) / CELL); cx <= Math.floor((x + 3) / CELL); cx++) for (let cz = Math.floor((z - 3) / CELL); cz <= Math.floor((z + 3) / CELL); cz++)
      for (const t of this.cells.get(cellKey(cx, cz)) ?? []) if (Math.hypot(t.x - x, t.z - z) < Math.min(3, t.r + g.trunk)) return false;
    return true;
  }
  private posture(s: ForagerState, row: Posture, dt: number): void {
    s.sit = row[1] === 0 ? row[0] : s.sit + (row[0] - s.sit) * Math.min(1, dt * row[1]);
    s.headPitch += (row[2] - s.headPitch) * Math.min(1, dt * row[3]);
    s.ears += (row[4] - s.ears) * Math.min(1, dt * row[5]);
  }
  private hop(s: ForagerState, len: number, dur: number, height: number): void {
    let tx = s.x + Math.sin(s.yaw) * len, tz = s.z + Math.cos(s.yaw) * len;
    if (!this.canStep(tx, tz)) {
      // blocked: turn and try the other ways round
      for (const turn of [0.9, -0.9, 1.8, -1.8, Math.PI]) {
        const y = s.yaw + turn, x2 = s.x + Math.sin(y) * len, z2 = s.z + Math.cos(y) * len;
        if (this.canStep(x2, z2)) { s.yaw = y; tx = x2; tz = z2; break; }
      }
      if (!this.canStep(tx, tz)) { s.mode = 'alert'; s.timer = 1; return; }
    }
    s.fx = s.x; s.fz = s.z; s.tx = tx; s.tz = tz; s.t = 0; s.dur = dur; s.h = height;
  }
  /** a walk toward (tx, tz) at `speed` m/s, facing the way it goes */
  private walk(s: ForagerState, tx: number, tz: number, speed: number, dt: number): void {
    const dx = tx - s.x, dz = tz - s.z, d = Math.hypot(dx, dz);
    if (d <= 0.05) return;
    const k = Math.min(d, speed * dt) / d;
    s.x += dx * k; s.z += dz * k; s.yaw = Math.atan2(dx, dz);
  }
  /** Send a forager running (an alarm from its population): it flees unless it already is or is hidden. */
  bolt(s: ForagerState, player: ForagerPlayer): void {
    if (s.mode === 'flee' || s.mode === 'hide') return;
    const rows = this.rows, e = rows.escape;
    s.mode = 'flee'; s.timer = 3; s.zig = 0;
    if (e.to === 'away') { s.fleeLeft = this.random.range(...e.distance); s.yaw = Math.atan2(s.x - player.x, s.z - player.z); s.t = s.dur; }
  }
  /** One scheduled step against the player's position. true: this forager was a sentry and raised the alarm. */
  step(s: ForagerState, motion: ForagerMotion, dt: number, player: ForagerPlayer, fast: boolean, crouched = false): boolean {
    const rows = this.rows, rng = this.random, gait = rows.grazing, e = rows.escape, sentry = rows.sentry;
    const d = Math.hypot(s.x - player.x, s.z - player.z);
    const scare = (crouched && rows.crouched !== undefined ? rows.crouched : fast ? rows.scare[1] : rows.scare[0]) * (s.mode === 'sentry' && sentry !== null ? sentry.sight : 1);
    let alarm = false;
    if (s.mode !== 'flee' && s.mode !== 'hide' && d < scare) { alarm = s.mode === 'sentry' && sentry?.alarm === true; this.bolt(s, player); }
    else if (s.mode === 'graze' && d < scare + rows.alertMargin) { s.mode = 'alert'; s.timer = rng.range(...rows.alertPause); }
    const hopping = s.t < s.dur;
    if (hopping) {
      s.t += dt;
      const u = Math.min(1, s.t / s.dur);
      s.x = s.fx + (s.tx - s.fx) * u; s.z = s.fz + (s.tz - s.fz) * u;
      motion.y = Math.sin(u * Math.PI) * s.h;
      // the bound: hind legs drive back off the ground, fore legs reach, then land fore-first
      motion.hind = u < 0.35 ? Math.sin((u / 0.35) * Math.PI * 0.5) : 1 - (u - 0.35) / 0.65 * 1.5;
      motion.fore = u < 0.5 ? -0.7 * Math.sin(u * TAU) : 0.5 * Math.sin((u - 0.5) * TAU);
      motion.pitch = (0.5 - u) * (s.mode === 'flee' ? 0.5 : 0.3);
    } else {
      motion.y = 0;
      motion.hind += (0 - motion.hind) * Math.min(1, dt * 10); motion.fore += (0 - motion.fore) * Math.min(1, dt * 10);
      motion.pitch += (s.sit * 0.22 - 0.04 - motion.pitch) * Math.min(1, dt * 6);
    }
    s.timer -= dt;
    const p = rows.posture;
    switch (s.mode) {
      case 'graze':
        this.posture(s, p.graze, dt);
        if (gait.gait === 'walk') this.walk(s, s.tx, s.tz, gait.speed, dt);
        if (hopping || s.timer > 0) break;
        if (sentry !== null && rng.next() < sentry.chance) { s.mode = 'sentry'; s.timer = rng.range(...sentry.duration); break; }
        s.timer = rng.range(...rows.grazePause);
        if (gait.gait === 'walk') { const a = rng.range(0, TAU), r = rng.range(...gait.wander); s.tx = s.bx + Math.cos(a) * r; s.tz = s.bz + Math.sin(a) * r; }
        else { s.yaw += rng.range(...rows.turn); if (rng.next() < gait.chance) this.hop(s, rng.range(...gait.length), gait.duration, gait.height); }
        break;
      case 'sentry':
        this.posture(s, p.sentry ?? p.alert, dt);
        if (s.timer <= 0) { s.mode = 'graze'; s.timer = rng.range(...rows.settlePause); s.tx = s.x; s.tz = s.z; }
        break;
      case 'alert':
        this.posture(s, p.alert, dt);
        if (s.timer <= 0 && d > scare + rows.releaseMargin) { s.mode = 'graze'; s.timer = rng.range(...rows.settlePause); s.tx = s.x; s.tz = s.z; }
        break;
      case 'flee':
        this.posture(s, p.flee, dt);
        if (e.to === 'home') {
          this.walk(s, s.bx, s.bz, e.speed, dt);
          if (Math.hypot(s.x - s.bx, s.z - s.bz) < e.reach) { s.mode = 'hide'; s.timer = rng.range(...e.hide); }
          break;
        }
        if (hopping) break;
        if (s.fleeLeft <= 0) { s.mode = 'alert'; s.timer = rng.range(...e.pause); break; }
        s.zig -= 1;
        {
          const away = Math.atan2(s.x - player.x, s.z - player.z);
          if (s.zig <= 0) { s.zig = rng.int(...e.zigSteps); s.yaw = away + rng.range(...e.spread); } else s.yaw += wrap(away - s.yaw) * e.steer;
        }
        this.hop(s, e.length, e.duration, e.height); s.fleeLeft -= e.length;
        break;
      case 'hide':
        this.posture(s, p.hide ?? p.flee, dt);
        if (e.to === 'home' && s.timer <= 0 && d > e.emerge) { s.mode = sentry === null ? 'graze' : 'sentry'; s.timer = sentry === null ? rng.range(...rows.settlePause) : rng.range(...sentry.duration); s.tx = s.x; s.tz = s.z; }
        break;
      default: break;
    }
    if (e.to === 'home') s.sink += ((s.mode === 'hide' ? 1 : 0) - s.sink) * Math.min(1, dt * e.sink);
    return alarm;
  }
}

const MAX = 256, FX = DEFAULT_TICK_RATES.find(([id]) => id === 'fx')?.[1];
if (FX === undefined) throw new Error('Missing canonical forager FX rate');
const MODES = ['graze', 'sentry', 'flee', 'hide'] as const, STATE = { graze: 0, sentry: 1, alert: 1, flee: 2, hide: 3 } as const;
/** where the population is watched from: the player on the ground and the view's forward (fx, fz; a roaming population reads it) */
export interface ForagerViewer extends ForagerPlayer { readonly fx?: number; readonly fz?: number }
/** The one a forager at some point answers to in a room: its viewer and how that viewer moves. */
export interface ForagerWatcher { readonly viewer: ForagerViewer; readonly fast: boolean; readonly crouched: boolean }
type Roam = Extract<ForagerPopulationRows['place'], { kind: 'roam' }>;

/** One forager population (`@wildshard/format/ambientLife#ForagerPopulationSchema`): its rows on the fx band clocks
 *  and a private Rng, placed as fixed `colonies` round burrow sites or `roam`ing round the viewer (re-seated out of
 *  sight once out of range or behind). `update` steps the due rows (`due[i]`), marks the drawable ones (`shown[i]`)
 *  and returns the sentry that raised the alarm (every awake row then bolts); the caller draws. */
export class ForagerPopulation {
  readonly rows: ForagerState[] = [];
  readonly motion: ForagerMotion[] = [];
  readonly due: Uint8Array<ArrayBuffer> = new Uint8Array(MAX);
  readonly shown: Uint8Array<ArrayBuffer> = new Uint8Array(MAX);
  readonly brain: AmbientForager;
  private readonly retired = new Set<number>();
  private readonly active = new Uint8Array(MAX);
  private readonly retry = new Float32Array(MAX);
  private readonly bands = new BodyBandClocks();
  private readonly rng: Rng;
  private readonly ids: string[];
  readonly row: ForagerPopulationRows;
  constructor(row: ForagerPopulationRows, seed: number, trees: readonly TreeInstance[] = []) {
    this.row = row; this.rng = new Rng(seed); this.brain = new AmbientForager(row.policy, this.rng, trees);
    this.ids = Array.from({ length: row.count }, (_, index) => `${row.id}:${String(index)}`);
  }
  private add(s: ForagerState): void {
    if (this.rows.length >= this.row.count) throw new RangeError('Forager population bound exceeded');
    this.rows.push(s); this.motion.push({ y: 0, hind: 0, fore: 0, pitch: 0 });
  }
  /** Retire an authoritative member; its fixed identity and saved population order remain intact. */
  kill(index: number): void {
    if (!Number.isInteger(index) || this.rows[index] === undefined) throw new RangeError('Unknown forager member');
    this.retired.add(index); this.shown[index] = 0; this.due[index] = 0; this.active[index] = 0;
  }
  isAlive(index: number): boolean { return Number.isInteger(index) && this.rows[index] !== undefined && !this.retired.has(index); }
  /** colonies: `size` foragers round each burrow site, each with its own home by the hole */
  colonies(sites: readonly { x: number; z: number }[]): this {
    const p = this.row.place, rng = this.rng;
    if (p.kind !== 'colonies') throw new Error('Not a colony population');
    for (const s of sites) for (let i = 0, n = rng.int(...p.size); i < n; i++) {
      const a = rng.range(0, TAU), r = rng.range(...p.radius), x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r;
      this.add({ ...foragerState(x, z, rng.range(0, TAU), s.x + Math.cos(a) * p.home, s.z + Math.sin(a) * p.home), timer: rng.range(...p.timer) });
    }
    return this;
  }
  /** roam: `count` foragers seated round the viewer (one with no open ground waits far off) */
  roam(viewer: ForagerViewer): this {
    const p = this.row.place;
    if (p.kind !== 'roam') throw new Error('Not a roaming population');
    for (let i = 0; i < this.row.count; i++) { const s = foragerState(1e5, 1e5, 0); this.add(s); this.seat(s, p, p.seat, viewer, false); }
    return this;
  }
  private static seen(x: number, z: number, viewer: ForagerViewer, cos: number): boolean {
    const dx = x - viewer.x, dz = z - viewer.z, d = Math.hypot(dx, dz) || 1;
    return (dx * (viewer.fx ?? 0) + dz * (viewer.fz ?? 0)) / d > cos;
  }
  private seat(s: ForagerState, p: Roam, ring: readonly [number, number], viewer: ForagerViewer, hidden: boolean): boolean {
    const rng = this.rng;
    for (let k = 0; k < 24; k++) {
      const a = rng.range(0, TAU), r = rng.range(...ring), x = viewer.x + Math.cos(a) * r, z = viewer.z + Math.sin(a) * r;
      if ((hidden && r < p.view[2] && ForagerPopulation.seen(x, z, viewer, p.view[1])) || !this.brain.canStep(x, z)) continue;
      Object.assign(s, foragerState(x, z, rng.range(0, TAU)), { timer: rng.range(1, 4) });
      return true;
    }
    return false;
  }
  /** One frame: re-seat the roaming rows out of sight, step the rows the fx band clocks say are due. With `near` each row
   *  answers to the watcher it names (a room's nearest player); without it, to `viewer`. */
  update(dt: number, viewer: ForagerViewer, fast: boolean, crouched = false, near?: (x: number, z: number) => ForagerWatcher): ForagerState | null {
    const roam = this.row.place.kind === 'roam' ? this.row.place : null;
    this.bands.beginTick(dt);
    let alarm: ForagerState | null = null;
    for (let i = 0; i < MAX; i++) {
      const s = this.rows[i], motion = this.motion[i], id = this.ids[i];
      if (s === undefined || motion === undefined || id === undefined) break;
      this.due[i] = 0; this.active[i] = 0;
      if (this.retired.has(i)) { this.shown[i] = 0; continue; }
      const watcher = near?.(s.x, s.z), seer = watcher?.viewer ?? viewer;
      let d = Math.hypot(s.x - seer.x, s.z - seer.z);
      if (roam !== null && !(d <= roam.range && (d <= roam.visibleRange || ForagerPopulation.seen(s.x, s.z, seer, roam.view[0])))) {
        this.shown[i] = 0; this.bands.forget(id);
        if ((this.retry[i] = (this.retry[i] ?? 0) - dt) > 0) continue;
        if (!this.seat(s, roam, roam.reseat, seer, true)) { this.retry[i] = roam.retry; s.x = 1e5; s.z = 1e5; continue; }
        d = Math.hypot(s.x - seer.x, s.z - seer.z);
      }
      this.shown[i] = 1;
      const step = this.bands.takeBrainDt(id, 'fx', d, false);
      if (FX === undefined || bandAt(FX, d)?.brainHz === 'paused') continue;
      this.active[i] = 1;
      if (step <= 0) continue;
      this.due[i] = 1;
      if (this.brain.step(s, motion, step, seer, watcher?.fast ?? fast, watcher?.crouched ?? crouched) && alarm === null) alarm = s;
    }
    if (alarm !== null) for (let i = 0; i < MAX; i++) { const s = this.rows[i]; if (s === undefined) break; if (this.active[i] === 1) this.brain.bolt(s, near?.(s.x, s.z).viewer ?? viewer); }
    return alarm;
  }
  snapshot(): ForagerSnapshot {
    const rows = this.rows.map((m) => ({ x: m.x, z: m.z, bx: m.bx, bz: m.bz, yaw: m.yaw, stand: m.sit, sink: m.sink, state: STATE[m.mode], t: m.timer, tx: m.tx, tz: m.tz }));
    return v.parse(ForagerContinuation, { rows, acc: 0, rng: this.rng.snapshot(), bands: this.bands.snapshot(),
      ...(this.retired.size === 0 ? {} : { retired: [...this.retired].sort((a, b) => a - b) }) });
  }
  restore(input: unknown): void {
    const saved = v.parse(ForagerContinuation, input);
    if (saved.rng.initial !== this.rng.snapshot().initial) throw new RangeError('Forager seed mismatch');
    if ((this.rows.length > 0 && saved.rows.length !== this.rows.length) || saved.rows.length > this.row.count) throw new RangeError('Forager population identity mismatch');
    const retired = new Set<number>(saved.retired);
    if (retired.size !== (saved.retired?.length ?? 0) || [...retired].some(index => index >= saved.rows.length)) throw new RangeError('Unknown retired forager member');
    const clocks = new Set(saved.bands.rows.map(row => row.id));
    const unclockedRetired = [...retired].filter(index => !clocks.has(this.ids[index] ?? '')).length;
    if (saved.bands.frame > 0 && saved.bands.rows.length + unclockedRetired !== saved.rows.length) throw new RangeError('Missing forager clocks');
    this.bands.restore(saved.bands, new Set(this.ids.slice(0, saved.rows.length))); this.rng.restore(saved.rng);
    this.rows.length = 0; this.motion.length = 0; this.due.fill(0); this.active.fill(0);
    this.retired.clear(); this.shown.fill(0); for (const index of retired) this.retired.add(index);
    for (const r of saved.rows) this.add({ ...foragerState(r.x, r.z, r.yaw, r.bx, r.bz), mode: MODES[r.state], sit: r.stand, sink: r.sink, timer: r.t, tx: r.tx, tz: r.tz });
  }
}
