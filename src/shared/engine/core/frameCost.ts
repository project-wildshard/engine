/**
 * Where a frame's main-thread time goes (E142 aggro-perf, Jake: "Can't tell if models or triangles or if it's me aggroing
 * all the mobs and its enemy AI") — the collector behind the developer fps panel's timing rows (src/client/engine/ui/Perf.ts).
 *
 * OFF by default and free while off: every hook below starts with `if (!frameCost.on) return` (or the caller's own `on`
 * test), so the game pays one boolean read per system. The panel switches it on while it is open or recording.
 *
 * What it measures, per drawn frame (Game.ts's loop):
 *   update   input → the fixed steps (physics) → every updater → the late phase: all the game logic
 *   render   sky.update + composer.render: the CPU side of drawing (three's scene walk + the WebGL calls handed to the GPU)
 *   frame    the time between drawn frames (Game.frameMs)
 *   gpu~     frame − max(update + render, the cap's interval): what the next frame waited for beyond its own work and
 *            the 30 fps cap — the GPU, iOS's compositor, a missed vsync. WebKit cannot time the GPU, so it is inferred.
 *   idle     the cap's interval − the work, when the work fits in it: the headroom
 * and inside update, by BUCKET (each registered system by its label's prefix, Game.onUpdate / onFixed; plus `section`s
 * inside main.ts's big updater): physics · animals · elites · player · hud · audio · world · quest; `other` = the rest.
 * SUBS break a bucket down further (not summed): the animals' think (10 Hz AI), pose (gait + bones per animal), motor
 * (their Rapier character controllers), nav (navmesh path / probe queries, also counted).
 *
 * iOS clamps performance.now() to ~1 ms, so a sub-millisecond part reads 0 or 1 on any one frame; the panel shows the
 * parts as MEANS over ~2 s (unbiased), the totals as p50 / p95.
 */

export const BUCKETS = ['physics', 'animals', 'elites', 'player', 'hud', 'audio', 'world', 'quest'] as const;
export type Bucket = (typeof BUCKETS)[number];
export const SUBS = ['think', 'pose', 'motor', 'nav'] as const;
export type Sub = (typeof SUBS)[number];
const NB = BUCKETS.length, NS = SUBS.length;
const BI: Record<Bucket, number> = { physics: 0, animals: 1, elites: 2, player: 3, hud: 4, audio: 5, world: 6, quest: 7 };
const SI: Record<Sub, number> = { think: 0, pose: 1, motor: 2, nav: 3 };

/** a system's bucket from its label's prefix ('physics.step' → physics); null = unclaimed (it lands in `other`) */
function bucketOfLabel(label: string): number {
  const head = label.split(/[.#:]/)[0] ?? '';
  return (BUCKETS as readonly string[]).indexOf(head);
}

/** frames kept (~8 s at 30 fps, ~2 s at 120) for the 2-second windows and the sparkline */
const RING = 256;
/** frames kept for the 30-second spike counts (120 fps × 30 s) */
const LONG = 4096;

export interface FrameCostSnapshot {
  frames: number;
  frame: [number, number]; update: [number, number]; render: [number, number]; gpu: [number, number]; idle: number;
  /** means, ms per frame */
  buckets: Record<Bucket | 'other', number>;
  subs: Record<Sub, number>;
  /** navmesh queries per frame (mean) */
  navQueries: number;
  /** the last 30 s */
  over50: number; over100: number;
  worst: { ms: number; cause: string; ago: number } | null;
  /** update spikes (> 2.5× its p50 and > 6 ms) in the last 30 s, and the system that took them the last time */
  jumps: number; lastJump: string;
  longTasks: number | null;
}

class FrameCost {
  /** collect? (the panel open, a recording) */
  on = false;
  // ── this frame ──
  private readonly cur = new Float64Array(NB);
  private readonly curSub = new Float64Array(NS);
  private curNav = 0;
  private topMs = 0; private topLabel = '';
  // ── the ring (struct of arrays) ──
  private n = 0; // frames written
  private readonly tR = new Float64Array(RING);
  private readonly frameR = new Float32Array(RING);
  private readonly updateR = new Float32Array(RING);
  private readonly renderR = new Float32Array(RING);
  private readonly gpuR = new Float32Array(RING);
  private readonly idleR = new Float32Array(RING);
  private readonly bucketR = new Float32Array(RING * NB);
  private readonly subR = new Float32Array(RING * NS);
  private readonly navR = new Uint16Array(RING);
  // ── the 30 s ring: time, frame ms, the frame's cause ──
  private ln = 0;
  private readonly lt = new Float64Array(LONG);
  private readonly lms = new Float32Array(LONG);
  private readonly lcause: string[] = Array.from({ length: LONG }, () => '');
  private readonly jumpT = new Float64Array(64); private jn = 0; private jumpLabel = '';
  private longTaskT: Float64Array | null = null; private ltn = 0;
  /** a per-frame listener (the panel's recorder) */
  onFrame: ((f: FrameRecord) => void) | null = null;
  private readonly rec: FrameRecord = { t: 0, frame: 0, update: 0, render: 0, gpu: 0, idle: 0, buckets: new Float32Array(NB), subs: new Float32Array(NS), nav: 0, top: '', topMs: 0 };

  constructor() {
    try {
      if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
        const ring = this.longTaskT = new Float64Array(256);
        new PerformanceObserver((list) => { for (const e of list.getEntries()) { ring[this.ltn % ring.length] = e.startTime; this.ltn++; } }).observe({ type: 'longtask', buffered: false });
      }
    } catch { this.longTaskT = null; } // WebKit: no long tasks
  }

  /** start of a drawn frame */
  begin(): void { this.cur.fill(0); this.curSub.fill(0); this.curNav = 0; this.topMs = 0; this.topLabel = ''; }

  /** one Game system ran for `ms` (Game.ts, while `on`) */
  system(label: string, ms: number): void {
    let b = this.labels.get(label);
    if (b === undefined) { b = bucketOfLabel(label); this.labels.set(label, b); }
    if (b >= 0) this.cur[b] = (this.cur[b] ?? 0) + ms;
    // a system split into sections (main.ts's) is not a cause itself: its sections are
    if (!this.split && ms > this.topMs) { this.topMs = ms; this.topLabel = label; }
    this.split = false;
  }
  private readonly labels = new Map<string, number>();
  private split = false;

  /** a stretch of an unclaimed system (main.ts's big updater) that belongs to `bucket`, begun at `t0` = performance.now() */
  section(bucket: Bucket, t0: number): void {
    const ms = performance.now() - t0;
    this.cur[BI[bucket]] = (this.cur[BI[bucket]] ?? 0) + ms;
    this.split = true;
    if (ms > this.topMs) { this.topMs = ms; this.topLabel = `main:${bucket}`; }
  }
  /** a breakdown inside a bucket (not summed into it again) */
  sub(sub: Sub, t0: number): void { const i = SI[sub]; this.curSub[i] = (this.curSub[i] ?? 0) + performance.now() - t0; }
  /** one navmesh query that took `ms` (src/shared/engine/physics/navmesh.ts) */
  nav(ms: number): void { if (!this.on) return; this.curNav++; this.curSub[SI.nav] = (this.curSub[SI.nav] ?? 0) + ms; }

  /** end of a drawn frame: the frame interval, the work split, the cap's interval (0 = uncapped) */
  end(frameMs: number, updateMs: number, renderMs: number, capMs: number): void {
    const now = performance.now(), i = this.n % RING;
    const work = updateMs + renderMs, floor = Math.max(work, capMs);
    const gpu = Math.max(0, frameMs - floor), idle = Math.max(0, Math.min(frameMs, capMs) - work);
    this.tR[i] = now; this.frameR[i] = frameMs; this.updateR[i] = updateMs; this.renderR[i] = renderMs; this.gpuR[i] = gpu; this.idleR[i] = idle;
    let claimed = 0;
    for (let b = 0; b < NB; b++) { const v = this.cur[b] ?? 0; this.bucketR[i * NB + b] = v; claimed += v; }
    for (let s = 0; s < NS; s++) this.subR[i * NS + s] = this.curSub[s] ?? 0;
    this.navR[i] = Math.min(65535, this.curNav);
    this.n++;
    // the frame's cause: the largest of the buckets / other / render / gpu~, and the longest single system in it
    let cause = 'other', cms = Math.max(0, updateMs - claimed);
    for (let b = 0; b < NB; b++) { const v = this.cur[b] ?? 0; if (v > cms) { cms = v; cause = BUCKETS[b] ?? ''; } }
    if (renderMs > cms) { cms = renderMs; cause = 'render'; }
    if (gpu > cms) { cms = gpu; cause = 'gpu~'; }
    const li = this.ln % LONG;
    this.lt[li] = now; this.lms[li] = frameMs;
    this.lcause[li] = `${cause} ${cms.toFixed(0)}ms${this.topLabel !== '' && cause !== 'render' && cause !== 'gpu~' ? ` (${this.topLabel} ${this.topMs.toFixed(0)})` : ''}`;
    this.ln++;
    // an update spike: well over its recent median — name the system that took it
    if (updateMs > 6 && this.n > 30) {
      const med = this.median(this.updateR, 30);
      if (updateMs > med * 2.5) { this.jumpT[this.jn % this.jumpT.length] = now; this.jn++; this.jumpLabel = `${this.topLabel || 'other'} ${this.topMs.toFixed(0)}ms`; }
    }
    if (this.onFrame) {
      const r = this.rec;
      r.t = now; r.frame = frameMs; r.update = updateMs; r.render = renderMs; r.gpu = gpu; r.idle = idle; r.nav = this.curNav;
      r.buckets.set(this.cur); r.subs.set(this.curSub); r.top = this.topLabel; r.topMs = this.topMs;
      this.onFrame(r);
    }
  }

  private median(ring: Float32Array, count: number): number {
    const k = Math.min(count, this.n, RING), v: number[] = [];
    for (let j = 1; j <= k; j++) v.push(ring[(this.n - j + RING) % RING] ?? 0);
    v.sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)] ?? 0;
  }

  /** the last `ms` of frames, newest first: ring indices */
  private window(ms: number): number[] {
    const out: number[] = [], now = performance.now(), k = Math.min(this.n, RING);
    for (let j = 1; j <= k; j++) { const i = (this.n - j) % RING; if (now - (this.tR[i] ?? 0) > ms) break; out.push(i); }
    return out;
  }

  /** the panel's numbers: ~2 s windows, the 30 s spike counts */
  snapshot(): FrameCostSnapshot {
    const w = this.window(2000), m = Math.max(1, w.length);
    const pct = (r: Float32Array): [number, number] => {
      const v = w.map((i) => r[i] ?? 0).sort((a, b) => a - b);
      return [v[Math.floor(v.length * 0.5)] ?? 0, v[Math.min(v.length - 1, Math.floor(v.length * 0.95))] ?? 0];
    };
    const mean = (f: (i: number) => number): number => w.reduce((s, i) => s + f(i), 0) / m;
    const buckets = { other: 0 } as Record<Bucket | 'other', number>;
    let claimed = 0;
    for (const [b, name] of BUCKETS.entries()) { const v = mean((i) => this.bucketR[i * NB + b] ?? 0); buckets[name] = v; claimed += v; }
    buckets.other = Math.max(0, mean((i) => this.updateR[i] ?? 0) - claimed);
    const subs = {} as Record<Sub, number>;
    for (const [s, name] of SUBS.entries()) subs[name] = mean((i) => this.subR[i * NS + s] ?? 0);
    // the last 30 s
    const now = performance.now(), k = Math.min(this.ln, LONG);
    let over50 = 0, over100 = 0, worst = -1;
    for (let j = 1; j <= k; j++) {
      const i = (this.ln - j) % LONG;
      if (now - (this.lt[i] ?? 0) > 30_000) break;
      const f = this.lms[i] ?? 0;
      if (f > 50) over50++;
      if (f > 100) over100++;
      if (worst < 0 || f > (this.lms[worst] ?? 0)) worst = i;
    }
    let jumps = 0;
    for (let j = 1; j <= Math.min(this.jn, this.jumpT.length); j++) if (now - (this.jumpT[(this.jn - j) % this.jumpT.length] ?? 0) < 30_000) jumps++;
    let longTasks: number | null = null;
    const lt = this.longTaskT;
    if (lt !== null) { longTasks = 0; for (let j = 1; j <= Math.min(this.ltn, lt.length); j++) if (now - (lt[(this.ltn - j) % lt.length] ?? 0) < 30_000) longTasks++; }
    return {
      frames: w.length, frame: pct(this.frameR), update: pct(this.updateR), render: pct(this.renderR), gpu: pct(this.gpuR), idle: mean((i) => this.idleR[i] ?? 0),
      buckets, subs, navQueries: mean((i) => this.navR[i] ?? 0), over50, over100,
      worst: worst < 0 ? null : { ms: this.lms[worst] ?? 0, cause: this.lcause[worst] ?? '', ago: (now - (this.lt[worst] ?? now)) / 1000 },
      jumps, lastJump: this.jumpLabel, longTasks,
    };
  }

  /** the last `count` frames, oldest first, for the sparkline: frame ms and which of update / render / gpu~ dominated (0 / 1 / 2) */
  spark(count: number, frame: Float32Array, kind: Uint8Array): number {
    const k = Math.min(count, this.n, RING);
    for (let j = 0; j < k; j++) {
      const i = (this.n - k + j) % RING, u = this.updateR[i] ?? 0, r = this.renderR[i] ?? 0, g = this.gpuR[i] ?? 0;
      frame[j] = this.frameR[i] ?? 0; kind[j] = g > u && g > r ? 2 : r > u ? 1 : 0;
    }
    return k;
  }
}

/** one frame as the recorder sees it (the object is reused: copy what you keep) */
export interface FrameRecord {
  t: number; frame: number; update: number; render: number; gpu: number; idle: number;
  buckets: Float32Array; subs: Float32Array; nav: number; top: string; topMs: number;
}

export const frameCost: FrameCost = new FrameCost();
