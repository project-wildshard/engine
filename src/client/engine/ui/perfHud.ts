import { appIdentity } from '../../../shared/engine/app/identity';
import { app } from '../app/runtime';
import { uiScope } from './ownership';
import { engineString } from '../../../shared/engine/strings';
import { saveStorage } from '../saves/slots';
/**
 * The developer fps panel's on-device perf HUD (E142 aggro-perf; Jake: "Can you add the debug info you need for the game
 * loop that's not rendering for the fps drop? Or anything else you can think of I can't think of."). Perf.ts owns the
 * pill and the panel; this file owns what the panel says below its rows, while it is open (≤ 4 repaints a second, one
 * textContent write, a 120-px canvas — no layout reads):
 *
 *   TIME      frame / update / render / gpu~ p50 · p95 over ~2 s, idle (see src/shared/engine/core/frameCost.ts for each term)
 *   UPDATE    where update goes, mean ms a frame: physics · animals · elites · player · hud · audio · world · quest · other,
 *             and the animals' think / pose / motor / nav, navmesh queries a frame
 *   SPIKES    frames > 50 / > 100 ms in the last 30 s, the worst one and what took it, update jumps (+ the system),
 *             long tasks where the browser reports them (Chrome; WebKit: n/a)
 *   COUNTS    the game's (main.ts `addCounts`: animals alive / near / on motors / chasing / fleeing, the elite, Rapier
 *             bodies …), audio sources playing, DOM mutations a second, draw calls, triangles, shader programs, GPU memory
 *   DEVICE    dpr, canvas, tier, the fps cap, visibility, engine; the texture mode (KTX2 / images), why, and the KTX2 probe
 *   the sparkline: the last 120 frames' ms (the 33 ms line), coloured by what dominated each — update (amber), render
 *             (cyan), gpu~ (magenta)
 *   REC 30 S  a 30-second recording (every frame's split + the counts at 4 Hz) → a summary with the top 5 spike frames and
 *             their causes; COPY puts it on the clipboard; the last one is kept in localStorage (it survives a reload)
 */
import type { Game } from '../core/Game';
import { TIER, frameCapFps } from '../core/tier';
import { frameCost, BUCKETS, SUBS, type FrameRecord } from '../../../shared/engine/core/frameCost';
import { textureReport } from '../boot/gpuFiles';
import { ktx2ProbeLine } from '../render/ktx2Probe';
import { isDev } from '../core/devMode';
import { drawBudgetCounter } from './drawBudgetCounter';

const savedStorage = saveStorage('device');

declare const __BUILD_ID__: string; // vite.config.ts define
function buildId(): string { try { return __BUILD_ID__; } catch { return ''; } }


export type Counts = Record<string, number>;
const REC_MS = 30_000;
const STORE = 'perf.rec';
const f1 = (n: number): string => n.toFixed(1);
const k = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const pad = (s: string, n: number): string => s.padEnd(n).slice(0, n);
const num = (n: number, w = 6): string => f1(n).padStart(w);

/** DOM mutations a second (a MutationObserver on the body, the panel's own writes left out) — only while observing */
class DomWrites {
  private obs: MutationObserver | null = null;
  private count = 0; private since = performance.now(); rate = 0;
  private readonly own: readonly HTMLElement[];
  constructor(own: readonly HTMLElement[]) {
    this.own = own;
  }
  set(on: boolean): void {
    if (on === (this.obs !== null)) return;
    if (!on) { this.obs?.disconnect(); this.obs = null; return; }
    this.count = 0; this.since = performance.now();
    this.obs = new MutationObserver((list) => {
      for (const m of list) if (!this.own.some((o) => o.contains(m.target))) this.count++;
    });
    this.obs.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  }
  /** mutations a second since the last call */
  sample(): number {
    const now = performance.now(), dt = (now - this.since) / 1000;
    if (dt > 0.2) { this.rate = this.count / dt; this.count = 0; this.since = now; }
    return this.rate;
  }
}

/** audio sources playing (started, not ended), counted from the first time the panel opened (a dev-only hook on start) */
const shellScope = uiScope('audioCounter', app.engineScope);
const audioSrc = { live: 0, started: 0, hooked: false };
function hookAudio(): void {
  if (audioSrc.hooked || typeof AudioScheduledSourceNode === 'undefined') return;
  audioSrc.hooked = true;
  // AudioBufferSourceNode declares its own start (offset, duration): hook each prototype that owns one
  const protos: object[] = [AudioScheduledSourceNode.prototype];
  if (typeof AudioBufferSourceNode !== 'undefined') protos.push(AudioBufferSourceNode.prototype);
  for (const proto of protos) {
    if (!Object.hasOwn(proto, 'start')) continue;
    const start: unknown = Reflect.get(proto, 'start');
    if (typeof start !== 'function') continue;
    Reflect.set(proto, 'start', function countedStart(this: AudioScheduledSourceNode, ...args: number[]): void {
      audioSrc.live++; audioSrc.started++;
      shellScope.listen(this, 'ended', () => { audioSrc.live = Math.max(0, audioSrc.live - 1); }, { once: true });
      Reflect.apply(start, this, args);
    });
  }
}

/**
 * The on-phone A/B switches (E142: Jake's fight read gpu~ 35–48 ms against 0 walking — the GPU / compositor, not the
 * game logic): each one takes one suspect out while he plays, and the panel's gpu~ row says within ~2 s what it cost.
 * Nothing is saved; a reload (or tapping it again) brings it back.
 *   anim   every CSS animation / transition in the HUD (the engaged elite's skull pulse, blinks, sheens)
 *   blur   every backdrop-filter (the glass discs, chips)
 *   elite  the elite's bar + the minimap skulls
 *   map    the minimap
 *   hud    the whole HUD (the touch controls too — stand still)
 *   post   the post chain (the scene straight to the canvas)
 */
const AB: readonly { id: string; css?: string }[] = [
  { id: 'anim', css: '#hud *, #hud *::before, #hud *::after { animation: none !important; transition: none !important; }' },
  { id: 'blur', css: '* { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }' },
  { id: 'elite', css: '.ws-elite, .ws-elite-skulls { display: none !important; }' },
  { id: 'map', css: '.ws-minimap { display: none !important; }' },
  { id: 'hud', css: '#hud { visibility: hidden !important; }' },
  { id: 'post' },
];

interface RecFrame { t: number; frame: number; update: number; render: number; gpu: number; buckets: number[]; subs: number[]; nav: number; top: string; topMs: number }

export class PerfHud {
  readonly scope: ReturnType<typeof uiScope> = uiScope('PerfHud');
  private readonly counters: (() => Counts)[] = [];
  private readonly dom: DomWrites;
  private readonly spark: HTMLCanvasElement;
  private readonly sparkFrame = new Float32Array(120);
  private readonly sparkKind = new Uint8Array(120);
  private startedLast = 0; private startedAt = performance.now(); private startRate = 0;
  // recording
  private rec: { t0: number; frames: RecFrame[]; maxCounts: Counts; samples: number } | null = null;
  lastRecText = '';
  onRecDone: ((text: string) => void) | null = null;

  private readonly game: Game;
  private readonly out: HTMLElement;
  constructor(game: Game, out: HTMLElement, spark: HTMLCanvasElement, own: readonly HTMLElement[]) {
    this.game = game;
    this.out = out;
    this.spark = spark;
    this.dom = new DomWrites(own);
    this.scope.onDispose(() => { this.dom.set(false); this.counters.length = 0; this.onRecDone = null; this.rec = null; });
    try { const s = savedStorage.getItem(STORE); if (s !== null) this.lastRecText = s; } catch { this.lastRecText = ''; }
  }

  /** the A/B switches into `host` (buttons; `guard` cancels a touch so it never reaches the look layer) */
  mountSwitches(host: HTMLElement, guard: (e: Event) => void): void {
    const style = document.createElement('style');
    document.head.append(style); this.scope.capture('nodes', () => { style.remove(); });
    const off = new Set<string>();
    for (const ab of AB) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ws-perf-btn ws-perf-ab'; b.textContent = ab.id;
      for (const t of ['touchstart', 'touchmove', 'touchend'] as const) this.scope.listen(b, t, guard, { passive: false });
      this.scope.listen(b, 'pointerdown', guard);
      this.scope.listen(b, 'pointerup', (e) => {
        guard(e);
        const now = !off.has(ab.id);
        if (now) off.add(ab.id); else off.delete(ab.id);
        b.classList.toggle('off', now);
        style.textContent = AB.filter((x) => off.has(x.id) && x.css !== undefined).map((x) => x.css).join('\n');
        if (ab.id === 'post') { const passes = this.game.composer.passes, first = passes[0]; for (const p of passes) if (p !== first) p.enabled = !now; if (first) first.renderToScreen = now; } // (the composer is built after the panel)
        this.abLabel = [...off].join(' ');
      });
      host.append(b);
    }
  }
  /** what the A/B switches have off (the panel's text and a recording say so) */
  private abLabel = '';

  /** a source of counts (main.ts: the animals, the elite, Rapier) — read only when the panel paints or records */
  addCounts(fn: () => Counts): void { this.counters.push(fn); }

  /** the panel is open (or not): collect, observe the DOM, count audio */
  setOpen(open: boolean): void {
    this.open = open;
    frameCost.on = open || this.rec !== null;
    this.dom.set(open || this.rec !== null);
    if (open) hookAudio();
  }
  private open = false;

  get recording(): boolean { return this.rec !== null; }

  startRec(): void {
    if (this.rec !== null) return;
    hookAudio();
    this.rec = { t0: performance.now(), frames: [], maxCounts: {}, samples: 0 };
    frameCost.on = true; this.dom.set(true);
    frameCost.onFrame = (f: FrameRecord) => {
      const r = this.rec;
      if (r === null) return;
      r.frames.push({ t: f.t - r.t0, frame: f.frame, update: f.update, render: f.render, gpu: f.gpu, buckets: Array.from(f.buckets), subs: Array.from(f.subs), nav: f.nav, top: f.top, topMs: f.topMs });
    };
  }

  /** every frame from Perf.update (cheap unless painting / finishing a recording) */
  tick(now: number): void {
    const r = this.rec;
    if (r !== null && now - r.t0 >= REC_MS) this.finishRec();
  }

  /** all the counts now: the game's, audio, DOM, the renderer's */
  counts(): Counts {
    const c: Counts = {};
    for (const fn of this.counters) Object.assign(c, fn());
    const info = this.game.renderer.info, now = performance.now();
    if (now - this.startedAt > 900) { this.startRate = (audioSrc.started - this.startedLast) / ((now - this.startedAt) / 1000); this.startedLast = audioSrc.started; this.startedAt = now; }
    c['audio live'] = audioSrc.live; c['audio starts/s'] = this.startRate;
    c['dom writes/s'] = this.dom.sample();
    c['calls'] = this.game.lastFrame.calls; c['tris'] = this.game.lastFrame.triangles;
    c['programs'] = info.programs?.length ?? 0; c['textures'] = info.memory.textures; c['geometries'] = info.memory.geometries;
    return c;
  }

  private sampleRecCounts(c: Counts): void {
    const r = this.rec;
    if (r === null) return;
    r.samples++;
    for (const [key, v] of Object.entries(c)) r.maxCounts[key] = Math.max(r.maxCounts[key] ?? 0, v);
  }

  /** the panel's text (and the sparkline) — call ≤ 4× a second, only while the panel is open or recording */
  paint(): void {
    const c = this.counts();
    this.sampleRecCounts(c);
    if (!this.open) return;
    const s = frameCost.snapshot(), b = s.buckets, u = s.subs;
    const L: string[] = [];
    L.push(`TIME ms      p50    p95   (${s.frames} frames, 2 s)`);
    L.push(`frame     ${num(s.frame[0])} ${num(s.frame[1])}`);
    L.push(`update    ${num(s.update[0])} ${num(s.update[1])}   game logic`);
    L.push(`render    ${num(s.render[0])} ${num(s.render[1])}   CPU draw submit`);
    L.push(`gpu~      ${num(s.gpu[0])} ${num(s.gpu[1])}   wait: GPU/compositor`);
    L.push(`idle      ${num(s.idle)}          ${frameCapFps() > 0 ? `under the ${frameCapFps()} cap` : 'uncapped'}`);
    L.push('UPDATE mean ms a frame');
    L.push(`physics ${f1(b.physics)} · animals ${f1(b.animals)} · elites ${f1(b.elites)}`);
    L.push(`player ${f1(b.player)} · hud ${f1(b.hud)} · audio ${f1(b.audio)}`);
    L.push(`world ${f1(b.world)} · quest ${f1(b.quest)} · other ${f1(b.other)}`);
    L.push(` animals: think ${f1(u.think)} pose ${f1(u.pose)} motor ${f1(u.motor)}`);
    L.push(` nav ${f1(u.nav)} ms · ${f1(s.navQueries)} queries/frame`);
    L.push(`SPIKES 30 s  >50ms ${s.over50} · >100ms ${s.over100}`);
    if (s.worst) L.push(` worst ${s.worst.ms.toFixed(0)}ms ${s.worst.ago.toFixed(0)}s ago: ${s.worst.cause}`);
    L.push(` update jumps ${s.jumps}${s.lastJump ? ` (last ${s.lastJump})` : ''} · longtasks ${s.longTasks ?? 'n/a'}`);
    L.push('COUNTS');
    const g = (key: string): string => k(c[key] ?? 0);
    if ('animals' in c) L.push(`animals ${g('animals')} · near ${g('near')} · motors ${g('motors')}`);
    if ('chase' in c) L.push(`chasing ${g('chase')} · fleeing ${g('flee')} · elite ${c['elite'] === 1 ? 'ENGAGED' : '-'}`);
    if ('bodies' in c) L.push(`rapier ${g('bodies')} bodies · ${g('colliders')} colliders`);
    L.push(`audio ${g('audio live')} live · ${f1(c['audio starts/s'] ?? 0)} starts/s · fx ${g('fx chips')}`);
    L.push(`DOM ${g('dom writes/s')} writes/s`);
    L.push(`calls ${g('calls')} · tris ${g('tris')} · programs ${g('programs')}`);
    if (isDev()) {
      const i = (this.game.frameI + this.game.renderMs.length - 1) % this.game.renderMs.length;
      L.push(drawBudgetCounter({ draws: this.game.lastFrame.calls, renderMs: this.game.renderMs[i] ?? Number.NaN }, TIER));
    }
    L.push(`gpu mem: ${g('textures')} textures · ${g('geometries')} geometries`);
    L.push('DEVICE');
    L.push(device(this.game));
    L.push(textureLine());
    if (this.abLabel !== '') L.push(`A/B OFF: ${this.abLabel}`);
    this.out.textContent = L.join('\n');
    this.drawSpark();
  }

  private drawSpark(): void {
    const cv = this.spark, ctx = cv.getContext('2d');
    if (ctx === null) return;
    const n = frameCost.spark(120, this.sparkFrame, this.sparkKind), W = cv.width, H = cv.height, top = 120; // 0 … 120 ms
    ctx.clearRect(0, 0, W, H);
    const bw = W / 120;
    for (let i = 0; i < n; i++) {
      const v = Math.min(top, this.sparkFrame[i] ?? 0), h = Math.max(1, (v / top) * H);
      const kind = this.sparkKind[i] ?? 0;
      ctx.fillStyle = kind === 2 ? '#e86bff' : kind === 1 ? '#8fe3ff' : '#ffc46b';
      ctx.fillRect((120 - n + i) * bw, H - h, Math.max(1, bw - 0.5), h);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(0, H - (33.3 / top) * H, W, 1); // the 30 fps line
  }

  private finishRec(): void {
    const r = this.rec;
    if (r === null) return;
    this.rec = null;
    frameCost.onFrame = null;
    frameCost.on = this.open;
    this.dom.set(this.open);
    const text = recSummary(r.frames, r.maxCounts, this.game, this.abLabel);
    this.lastRecText = text;
    try { savedStorage.setItem(STORE, text); } catch { /* not kept this session */ }
    this.onRecDone?.(text);
  }
}


function device(game: Game): string {
  const cv = game.renderer.domElement, cap = frameCapFps();
  const ua = navigator.userAgent, webkit = ua.includes('AppleWebKit') && !/Chrome|Chromium|Edg/.test(ua);
  return engineString('s_eca1db0e98e6', [devicePixelRatio, cv.width, cv.height, TIER, cap > 0 ? engineString('s_49bfa9d144a2', [cap]) : engineString('s_b4dc66dde806'), document.visibilityState, webkit || /iPhone|iPad/.test(ua) ? engineString('s_c5228b57a26a') : engineString('s_a37430e22cd0'), navigator.hardwareConcurrency]);
}

/** textures: what this page loads (KTX2 / images) and why, and the KTX2 capability probe's verdict (render/ktx2Probe.ts) */
function textureLine(): string {
  const t = textureReport();
  return `textures ${t.mode} · ${t.why}\nktx2 probe ${ktx2ProbeLine(t.probe)}`;
}

function pct(v: number[], p: number): number { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0; }

/** the recording's summary: what Jake pastes back */
function recSummary(frames: readonly RecFrame[], max: Counts, game: Game, abOff: string): string {
  const L: string[] = [];
  const secs = frames.length > 0 ? ((frames[frames.length - 1]?.t ?? 0) / 1000) : 0;
  L.push(`${appIdentity().name.toUpperCase()} PERF REC · build ${buildId() || '?'} · ${new Date().toISOString().slice(0, 16)}`);
  L.push(`${location.pathname}${location.search}`);
  L.push(device(game).replace('\n', ' · '));
  L.push(textureLine());
  if (abOff !== '') L.push(`A/B off at the end: ${abOff}`);
  L.push(`${frames.length} frames in ${f1(secs)} s = ${f1(frames.length / Math.max(0.001, secs))} fps`);
  L.push(`${pad('ms', 9)}   p50    p95    max`);
  const row = (name: string, v: number[]): void => { L.push(`${pad(name, 9)}${num(pct(v, 0.5))} ${num(pct(v, 0.95))} ${num(pct(v, 1))}`); };
  row('frame', frames.map((f) => f.frame)); row('update', frames.map((f) => f.update)); row('render', frames.map((f) => f.render)); row('gpu~', frames.map((f) => f.gpu));
  const m = Math.max(1, frames.length);
  const mean = (g: (f: RecFrame) => number): number => frames.reduce((s, f) => s + g(f), 0) / m;
  const parts = BUCKETS.map((name, i) => `${name} ${f1(mean((f) => f.buckets[i] ?? 0))}`);
  const other = mean((f) => Math.max(0, f.update - f.buckets.reduce((s, x) => s + x, 0)));
  L.push(`update mean: ${parts.join(' · ')} · other ${f1(other)}`);
  L.push(`animals: ${SUBS.map((name, i) => `${name} ${f1(mean((f) => f.subs[i] ?? 0))}`).join(' · ')} · nav ${f1(mean((f) => f.nav))} q/frame`);
  L.push(`frames > 50 ms: ${frames.filter((f) => f.frame > 50).length} · > 100 ms: ${frames.filter((f) => f.frame > 100).length}`);
  L.push('top 5 frames:');
  const worst = [...frames].sort((a, b) => b.frame - a.frame).slice(0, 5);
  for (const f of worst) {
    const bi = f.buckets.reduce((best, v, i) => (v > (f.buckets[best] ?? 0) ? i : best), 0);
    L.push(` ${f.frame.toFixed(0)}ms @${f1(f.t / 1000)}s: update ${f1(f.update)} (${BUCKETS[bi] ?? ''} ${f1(f.buckets[bi] ?? 0)}; top ${f.top || '-'} ${f1(f.topMs)}) render ${f1(f.render)} gpu~ ${f1(f.gpu)}`);
  }
  L.push(`max counts: ${Object.entries(max).map(([key, v]) => `${key} ${k(v)}`).join(' · ')}`);
  return L.join('\n');
}
