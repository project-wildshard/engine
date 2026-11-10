import { appIdentity, currentProbe } from '../../../shared/engine/app/identity';
import { uiScope, mountUi } from './ownership';
import { perfDockChip, perfDockSections } from './perfDock';
import { activeDevPixels, drawingBuffer } from '../render/devPixels';
import { viewportHeight } from '../core/viewport';
import { engineString } from '../../../shared/engine/strings';
import { saveStorage } from '../saves/slots';
/**
 * Frame meter (A14: the Developer dock, perfDock.ts; bottom-right on desktop): completed draws per wall-clock second and the worst
 * interval over three seconds; the details retain the game's frame p50 / p95,
 * draw calls and triangles from renderer.info, the tier and DPR.
 * Repainted at most twice a second and written to the DOM only when the text changed, so the meter
 * costs the phone nothing. `?perf=0` hides it.
 *
 * Phones (E47, Jake: "a compact FPS counter next to the pause button … '59 fps 17 ms' … when you tap it it can expand to
 * show calls and tris … on top of the mini map"): perf.css turns the meter into a small glass pill on PAUSE's row showing
 * only fps + worst ms; it is a button, and a tap opens `.ws-perf-panel` over the minimap (p50 / p95, draw calls, triangles,
 * tier · DPR, GL losses). It stays up until the pill is tapped again (a toggle — E142). The pill cancels its own touch events (no
 * double-tap zoom, no callout / selection on iOS) and toggles on pointerup, so it never starts a look drag. Desktop keeps
 * the one-line readout, click-through as before.
 * Developer mode only (E140, the user's 3a; src/client/engine/core/devMode.ts): players never see it; the Settings ▸ Developer switch
 * shows / hides it live. `?perf=0` hides it even in developer mode, `?perf=1` shows it (with the budget check) without it.
 * `?perf=1` adds the budget check: the worst draw calls / triangles of the last ~10 s against the tier's budget
 * (derived limits and each level's recorded rollout ceilings),
 * `OK` / `OVER` on the meter (red when over), and `window.__perfBudget` for scripted checks.
 */
import * as THREE from 'three';
import type { Game } from '../core/Game';
import { activeLevel } from '../../../shared/engine/level/selection';
import { TIER } from '../core/tier';
import { frameBudget } from '../render/budgetReport';
import { tierPickInfo, tierPickLine, forgetTierPick } from '../render/tierBoot';
import { markReload } from '../boot/lastEnd';
import { isDev, onDev } from '../core/devMode';
import type { PerfHud, Counts } from './perfHud';
import { loadModuleWithProgress } from './loadProgress';
import { withOwner } from '../../../shared/engine/app/ownership';
import type { PerfLap } from './perfLap';
import { FrameWindow } from './frameWindow';
import './perf.css';

const savedStorage = saveStorage('device');

declare const __BUILD_ID__: string; // vite.config.ts define
/** the last probe's full report (E189: COPY), kept across a reload */
const PROBE_KEY = 'perf.probe';

const PAINT_MS = 500;
/** the open panel's timing / counts block (src/client/engine/ui/perfHud.ts): ≤ 4 repaints a second */
const STATS_MS = 250;
const WINDOW = 20; // paints (~10 s)
export interface PerfBudget { maxCalls: number; maxTris: number; calls: number; tris: number; over: boolean }
const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

/** the fps / draw-call / triangle panel, with the level's budgets */
export class Perf {
  readonly scope: ReturnType<typeof uiScope> = uiScope('Perf');
  readonly root: HTMLElement;
  private lastPaint = 0;
  private lastText = '';
  private sorted = new Float32Array(120);
  private readonly budgetOn = new URLSearchParams(location.search).get('perf') === '1';
  private readonly recent: { calls: number; tris: number }[] = [];
  readonly budget: PerfBudget = { maxCalls: 0, maxTris: 0, calls: Infinity, tris: Infinity, over: false };
  private panel: HTMLElement;
  private live: { box: HTMLElement; fps: HTMLElement; ms: HTMLElement };
  private rows: { p50: HTMLElement; p95: HTMLElement; calls: HTMLElement; tris: HTMLElement; tier: HTMLElement; gl: HTMLElement };

  private game: Game;
  private readonly frameWindow: FrameWindow;
  constructor(game: Game) {
    this.game = game;
    this.scope.onDispose(() => { this.pendingCounts.length = 0; });
    this.frameWindow = new FrameWindow(performance.now(), game.frameCount);
    const limit = frameBudget(game.level.id, TIER, game.level.budgets);
    this.budget.calls = limit.draws ?? Infinity; this.budget.tris = limit.tris ?? Infinity;
    game.app.debug.expose('render.tierPick', { read: tierPickInfo, repick: () => { forgetTierPick(); markReload('tier pick: repick'); location.reload(); } });
    const root = this.root = document.createElement('button');
    root.className = 'ws-perf';
    root.setAttribute('type', 'button');
    root.setAttribute('aria-label', engineString('s_35e2fdf884d2'));
    root.innerHTML = engineString('s_241e06199e3e');
    const panel = this.panel = document.createElement('div');
    panel.className = 'ws-perf-panel';
    panel.innerHTML = engineString('s_83cf0416a0bd');
    const row = (r: string): HTMLElement => { const e = panel.querySelector<HTMLElement>(`[data-r="${r}"]`); if (e === null) throw new Error(`Perf: missing row ${r}`); return e; };
    this.rows = { p50: row('p50'), p95: row('p95'), calls: row('calls'), tris: row('tris'), tier: row('tier'), gl: row('gl') };
    // the open panel covers the pill on phones: its header carries a live copy (fps + ms, the same slow / bad colours)
    const livePill = panel.querySelector<HTMLElement>('.ws-perf-live');
    const liveFps = livePill?.querySelector<HTMLElement>('b'), liveMs = livePill?.querySelector<HTMLElement>('span');
    if (livePill === null || liveFps === null || liveFps === undefined || liveMs === null || liveMs === undefined) throw new Error('Perf: missing live pill');
    this.live = { box: livePill, fps: liveFps, ms: liveMs };
    // A14: the pill is the Developer dock's first chip (the memory card sits beside it); the other readouts' sections open
    // with the panel, right under its header
    perfDockChip(root, this.scope, 0); mountUi(panel, this.scope, document.body);
    panel.querySelector('.ws-perf-head')?.after(perfDockSections());
    // the pill is a button on phones: toggle on the lift; cancel its touches (iOS double-tap zoom / callout / selection)
    // and never let them reach the look layer. The panel closes on a tap on it or anywhere else (not cancelled, so a
    // look drag that starts outside still looks).
    const cancel = (e: Event): void => { e.stopPropagation(); if (e.cancelable) e.preventDefault(); };
    for (const t of ['touchstart', 'touchmove', 'touchend'] as const) this.scope.listen(root, t, cancel, { passive: false });
    for (const t of ['pointerdown', 'dragstart', 'contextmenu'] as const) this.scope.listen(root, t, cancel);
    this.scope.listen(root, 'pointerup', (e) => { cancel(e); this.open(!panel.classList.contains('open')); });
    for (const n of [root, ...root.querySelectorAll('*'), panel, ...panel.querySelectorAll('*')]) n.setAttribute('draggable', 'false');
    // E142: the on-device probe (src/client/engine/ui/perfProbe.ts) — RUN PROBE in the panel, or `?probe=1` 15 s after the world is entered
    const probe = panel.querySelector<HTMLButtonElement>('.ws-perf-probe'), probeOut = panel.querySelector<HTMLElement>('.ws-perf-probe-out');
    if (probe === null || probeOut === null) throw new Error('Perf: missing probe row');
    this.probeOut = probeOut;
    for (const t of ['touchstart', 'touchmove', 'touchend'] as const) this.scope.listen(probe, t, cancel, { passive: false });
    this.scope.listen(probe, 'pointerdown', cancel);
    this.scope.listen(probe, 'pointerup', (e) => { cancel(e); void this.runProbe(); });
    // E189 (Jake: "you need a copy button after running this probe … lots and lots of data"): the whole report to the clipboard
    const probeCopy = panel.querySelector<HTMLButtonElement>('.ws-perf-probe-copy');
    if (probeCopy === null) throw new Error('Perf: missing probe copy');
    for (const t of ['touchstart', 'touchmove', 'touchend'] as const) this.scope.listen(probeCopy, t, cancel, { passive: false });
    this.scope.listen(probeCopy, 'pointerdown', cancel);
    this.scope.listen(probeCopy, 'pointerup', (e) => {
      cancel(e);
      let text = this.probeText;
      if (text === '') { try { text = savedStorage.getItem(PROBE_KEY) ?? ''; } catch { /* storage blocked */ } }
      if (text === '') { probeCopy.textContent = engineString('s_7acd554c3676'); this.scope.timeout(1500, () => { probeCopy.textContent = engineString('s_dc26bc50abf8'); }); return; }
      const done = (ok: boolean): void => { probeCopy.textContent = ok ? engineString('s_2c9f6d96316f') : engineString('s_2221caed08d3'); this.scope.timeout(1500, () => { probeCopy.textContent = engineString('s_dc26bc50abf8'); }); };
      // no clipboard API (an http page, an old WebKit): the report goes in the panel, selected for a manual copy
      const fallback = (): void => { probeOut.textContent = text; const r = document.createRange(); r.selectNodeContents(probeOut); const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(r); done(false); };
      const copy = async (): Promise<void> => { try { await navigator.clipboard.writeText(text); done(true); } catch { fallback(); } };
      void copy();
    });
    // the open panel covers the pill on phones, so it carries its own CLOSE (sticky at the top while it scrolls)
    const close = panel.querySelector<HTMLButtonElement>('.ws-perf-close');
    if (close === null) throw new Error('Perf: missing close button');
    for (const t of ['touchstart', 'touchmove', 'touchend'] as const) this.scope.listen(close, t, cancel, { passive: false });
    this.scope.listen(close, 'pointerdown', cancel);
    this.scope.listen(close, 'pointerup', (e) => { cancel(e); this.open(false); });
    // E142 aggro-perf: the timing / counts block, the sparkline, REC 30 S + COPY (src/client/engine/ui/perfHud.ts)
    const q = (sel: string): HTMLElement => { const e = panel.querySelector<HTMLElement>(sel); if (e === null) throw new Error(`Perf: missing ${sel}`); return e; };
    this.prepareHud = async () => {
      const loading = this.hudLoading ??= this.installHud(q, cancel);
      try { await loading; }
      catch (error) { this.hudLoading = null; throw error; }
    };
    // a toggle (E142, Jake: "detail mode on, move around a lot and keep looking at it — it shouldn't just fade away"): only a
    // tap on the pill closes the panel; moving, looking and shooting leave it up
    const param = new URLSearchParams(location.search).get('perf');
    const hide = (): boolean => (param === '0' ? true : param === '1' ? false : !isDev());
    this.userHidden = hide(); this.root.hidden = this.userHidden;
    this.scope.onDispose(onDev(() => { this.userHidden = hide(); if (this.active) this.setActive(true); }));
    if (this.budgetOn) this.scope.expose(window, '__perfBudget', this.budget);
    game.onUpdate(() => this.update(performance.now()), 'hud.perf');
    // A stalled game cannot drive its own meter. The existing widget timer
    // reads completed draws, including a growing gap when there are none.
    this.scope.interval(PAINT_MS, () => {
      if (!this.active) return;
      // QA8: a closed frame gate (the held loading card, a gated reveal) draws nothing on purpose, like a menu: its time is
      // not a stall. Counted, Jake's 8 s on the hold card read "0 fps · max 8954 ms" for 3 s after PLAY
      if (!game.frameGate()) this.frameWindow.reset(performance.now(), game.frameCount);
      else this.frameWindow.observe(game.frameCount, game.frameRafTime);
      this.paint(performance.now());
    });
    // DL24 (G1008): the meter starts at control. Its window still held the loader's last hidden frame, so the first live
    // one read as one 10.4 s frame (Nine on 69fa647: '5 fps · max 10395 ms' 0.5 s after control) while the card had kept
    // moving all along
    this.scope.listen(document, 'ws:control-ready', () => { this.frameWindow.reset(performance.now(), game.frameCount); });
  }

  /** Hidden while the menu is up (the world is not rendering, so there is nothing to measure). */
  setActive(on: boolean): void {
    if (!on) this.lap?.cancel('the menu opened');
    if (on !== this.active) { this.frameWindow.reset(performance.now(), this.game.frameCount); this.lastPaint = -Infinity; }
    this.active = on; this.root.hidden = on ? this.userHidden : true;
    // A14: the Developer sections are one host per page; the level in front holds it in its panel (a resident shard's
    // meter may have taken it, and its disposal takes the host out of the page with its panel)
    if (on) this.panel.querySelector('.ws-perf-head')?.after(perfDockSections());
    if (!on || this.userHidden) this.open(false);
  }
  private readonly probeOut: HTMLElement;
  private async installHud(q: (selector: string) => HTMLElement, cancel: (event: Event) => void): Promise<void> {
    const [{ PerfHud }, { PerfLap }] = await loadModuleWithProgress('Performance', () => Promise.all([import('./perfHud'), import('./perfLap')]));
    if (this.scope.disposed) return;
    const recBtn = q('.ws-perf-rec'), copyBtn = q('.ws-perf-copy'), recOut = q('.ws-perf-rec-out'), spark = q('.ws-perf-spark');
    if (!(spark instanceof HTMLCanvasElement)) throw new Error('Perf: the sparkline is not a canvas');
    this.recBtn = recBtn;
    const hud = this.hud = withOwner(this.scope, () => new PerfHud(this.game, q('.ws-perf-stats'), spark, [this.root, this.panel]));
    hud.mountSwitches(q('.ws-perf-abs'), cancel); // E142: take one suspect out mid-fight, read gpu~
    if (hud.lastRecText !== '') recOut.textContent = engineString('s_1567ae2c94b8', [hud.lastRecText.split('\n').slice(0, 4).join('\n')]);
    hud.onRecDone = (text) => { recOut.textContent = text; recBtn.textContent = engineString('s_df9d72a2dfbf'); console.info(`[perf rec]\n${text}`); };
    for (const b of [recBtn, copyBtn]) {
      for (const t of ['touchstart', 'touchmove', 'touchend'] as const) this.scope.listen(b, t, cancel, { passive: false });
      this.scope.listen(b, 'pointerdown', cancel);
    }
    this.scope.listen(recBtn, 'pointerup', (e) => { cancel(e); if (!hud.recording && this.lap?.running !== true) { hud.startRec(); recOut.textContent = engineString('s_309443a755a0'); } });
    this.scope.listen(copyBtn, 'pointerup', (e) => {
      cancel(e);
      const text = hud.lastRecText !== '' ? hud.lastRecText : q('.ws-perf-stats').textContent;
      const done = (ok: boolean): void => { copyBtn.textContent = ok ? engineString('s_2c9f6d96316f') : engineString('s_2221caed08d3'); this.scope.timeout(1500, () => { copyBtn.textContent = engineString('s_dc26bc50abf8'); }); };
      const fallback = (): void => { recOut.textContent = text; const r = document.createRange(); r.selectNodeContents(recOut); const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(r); done(false); };
      // (no clipboard API — an http page, an old WebKit — throws in here too: the text is selected for a manual copy)
      const copy = async (): Promise<void> => { try { await navigator.clipboard.writeText(text); done(true); } catch { fallback(); } };
      void copy();
    });
    for (const read of this.pendingCounts) hud.addCounts(read);
    this.pendingCounts.length = 0;
    // E350 F-J1: PERF LAP — the six spots, one slow turn at each, the summary to COPY (src/client/engine/ui/perfLap.ts). The panel closes
    // while it runs (the reading is the frame as played, the pill up); a line at the top says where it is; a tap cancels
    const lapBtn = q('.ws-perf-lap'), lapCopy = q('.ws-perf-lap-copy'), lapOut = q('.ws-perf-lap-out');
    const lapStatus = document.createElement('div');
    lapStatus.className = 'ws-perf-lap-status'; lapStatus.hidden = true;
    mountUi(lapStatus, this.scope, document.body);
    const lap = this.lap = withOwner(this.scope, () => new PerfLap(this.game));
    if (lap.lastText !== '') lapOut.textContent = engineString('s_f4bfc750414c', [lap.lastText.split('\n').slice(0, 2).join('\n')]);
    lap.onStatus = (text) => { lapStatus.hidden = text === null; if (text !== null) lapStatus.textContent = text; };
    lap.onDone = (text) => { lapOut.textContent = text; this.open(true); };
    for (const b of [lapBtn, lapCopy]) {
      for (const t of ['touchstart', 'touchmove', 'touchend'] as const) this.scope.listen(b, t, cancel, { passive: false });
      this.scope.listen(b, 'pointerdown', cancel);
    }
    this.scope.listen(lapBtn, 'pointerup', (e) => {
      cancel(e);
      this.open(false);
      const why = lap.start(hud.recording);
      if (why !== null) { lapOut.textContent = why; this.open(true); }
    });
    this.scope.listen(lapCopy, 'pointerup', (e) => {
      cancel(e);
      const text = lap.lastText;
      if (text === '') { lapCopy.textContent = engineString('s_7acd554c3676'); this.scope.timeout(1500, () => { lapCopy.textContent = engineString('s_dc26bc50abf8'); }); return; }
      const done = (ok: boolean): void => { lapCopy.textContent = ok ? engineString('s_2c9f6d96316f') : engineString('s_2221caed08d3'); this.scope.timeout(1500, () => { lapCopy.textContent = engineString('s_dc26bc50abf8'); }); };
      const fallback = (): void => { lapOut.textContent = text; const r = document.createRange(); r.selectNodeContents(lapOut); const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(r); done(false); };
      const copy = async (): Promise<void> => { try { await navigator.clipboard.writeText(text); done(true); } catch { fallback(); } };
      void copy();
    });
    this.scope.expose(window, '__perfLapRun', lap);
    this.scope.expose(window, '__perfHud', hud);
    hud.setOpen(this.panel.classList.contains('open'));
  }

  private async openDetails(): Promise<void> {
    try { await this.prepareHud(); }
    catch (error) { console.warn('Performance controls unavailable', error); }
  }

  /** the last probe's full report (COPY) */
  private probeText = '';
  /** run the on-device probe; its table stays in the panel (and the console, `window.__perfProbe`) */
  private async runProbe(): Promise<void> {
    const out = this.probeOut, g = this.game;
    this.panel.classList.add('probed');
    const header = this.probeHeader(); // before the rows switch things off: the frame as played
    const { runPerfProbe, probeLines, probeReport, probeSamples } = await loadModuleWithProgress('Performance probe', () => import('./perfProbe'));
    if (this.scope.disposed) return;
    const rows = await runPerfProbe(g, (line) => { out.textContent = line; });
    if (this.scope.disposed || rows.length === 0) return;
    const head = `${g.renderer.domElement.width}×${g.renderer.domElement.height} · ${TIER} · ${Math.round(devicePixelRatio)}× screen`;
    const lines = probeLines(rows, head);
    out.textContent = lines.join('\n');
    console.info(`[probe]\n${lines.join('\n')}`);
    this.probeText = probeReport(rows, probeSamples, header);
    try { savedStorage.setItem(PROBE_KEY, this.probeText); } catch { /* not kept past this load */ }
    this.scope.expose(window, '__perfProbe', rows);
    this.open(true);
  }
  /** the report's header: what ran, on what, where (E189) */
  private probeHeader(): string[] {
    const g = this.game, r = g.renderer, cv = r.domElement, info = r.info, w: unknown = currentProbe()?.world ?? null;
    let build = ''; try { build = __BUILD_ID__; } catch { /* a dev page */ }
    let settings = ''; try { settings = saveStorage('global').getItem('settings') ?? ''; } catch { /* storage blocked */ }
    const pl: unknown = typeof w === 'object' && w !== null ? Reflect.get(w, 'player') : null;
    const pos: unknown = typeof pl === 'object' && pl !== null ? Reflect.get(pl, 'position') : null;
    const where = pos instanceof THREE.Vector3 ? `${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}` : '?';
    return [
      `${appIdentity().name.toUpperCase()} PROBE · ${new Date().toISOString()} · build ${build}`,
      `${engineString('s_level_word_lower')} ${activeLevel().id} · tier ${TIER} · canvas ${String(cv.width)}×${String(cv.height)} · dpr ${String(devicePixelRatio)} · screen ${String(screen.width)}×${String(screen.height)} · ${String(navigator.hardwareConcurrency)} cores`,
      `ua ${navigator.userAgent}`,
      `player at ${where} · calls ${String(g.lastFrame.calls)} · tris ${String(g.lastFrame.triangles)} · programs ${String(info.programs?.length ?? 0)} · textures ${String(info.memory.textures)} · geometries ${String(info.memory.geometries)}`,
      `settings ${settings}`,
    ];
  }
  private active = true; // until the menu first hides it (main.ts)
  /** the details panel over the minimap (phones) */
  private open(on: boolean): void { const show = on && this.root.hidden === false; this.panel.classList.toggle('open', show); this.root.classList.toggle('open', show); this.hud?.setOpen(show); if (show) void this.openDetails(); }
  private hud: PerfHud | null = null;
  private hudLoading: Promise<void> | null = null;
  private readonly prepareHud: () => Promise<void>;
  private readonly pendingCounts: (() => Counts)[] = [];
  private lap: PerfLap | null = null;
  private recBtn: HTMLElement | null = null;
  private lastStats = 0;
  /** main.ts: the game's counts for the panel (animals, the elite, Rapier …) — read ≤ 4× a second while it is open */
  addCounts(fn: () => Counts): void { if (this.hud === null) this.pendingCounts.push(fn); else this.hud.addCounts(fn); }
  private userHidden = false;

  private update(now: number) {
    this.frameWindow.observe(this.game.frameCount, this.game.frameRafTime);
    this.hud?.tick(now);
    this.lap?.tick(now);
    if ((this.panel.classList.contains('open') || (this.hud?.recording ?? false)) && now - this.lastStats >= STATS_MS) {
      this.lastStats = now;
      this.hud?.paint();
      if (this.hud?.recording === true && this.recBtn !== null) this.recBtn.textContent = engineString('s_a9470d9be8b3');
    }
  }

  private paint(now: number): void {
    if (!this.active || now - this.lastPaint < PAINT_MS) return;
    this.lastPaint = now;
    const g = this.game;
    this.sorted.set(g.frameMs); this.sorted.sort();
    const n = this.sorted.findIndex((v) => v > 0); // unfilled slots are 0 and sort first
    const valid = n === -1 ? 0 : this.sorted.length - n;
    const q = (p: number): number => valid === 0 ? 0 : this.sorted[n + Math.min(valid - 1, Math.floor(valid * p))] ?? 0;
    const p50 = q(0.5), p95 = q(0.95);
    const { fps, worst } = this.frameWindow.read(now);
    const r = g.lastFrame;
    const gl = g.gl.events ? ` · gl lost ×${g.gl.events}${g.gl.restoredAt > g.gl.lostAt ? ` restored ${Math.round(g.gl.restoredAt - g.gl.lostAt)} ms` : ''}` : '';
    let check = '';
    if (this.budgetOn) {
      this.recent.push({ calls: r.calls, tris: r.triangles });
      if (this.recent.length > WINDOW) this.recent.shift();
      const b = this.budget;
      b.maxCalls = Math.max(...this.recent.map((x) => x.calls)); b.maxTris = Math.max(...this.recent.map((x) => x.tris));
      b.over = b.maxCalls > b.calls || b.maxTris > b.tris;
      check = ` · max ${b.maxCalls}c / ${k(b.maxTris)}${Number.isFinite(b.calls) && Number.isFinite(b.tris) ? ` ${b.over ? 'OVER' : 'OK'} (≤${b.calls}c / ${k(b.tris)})` : ''}`;
    }
    const peak = engineString('s_perf_worst_frame', [Math.round(worst), '']);
    const text = `${Math.round(fps)}|${p50.toFixed(1)} / ${p95.toFixed(1)} ms · ${peak} · ${r.calls} calls · ${k(r.triangles)} tris · ${tierPickLine()} · ${g.renderer.getPixelRatio().toFixed(2)}×${gl}${check}`;
    if (text === this.lastText) return;
    this.lastText = text;
    const [fpsText = '', rest = ''] = text.split('|');
    (this.root.firstElementChild as HTMLElement).textContent = fpsText;
    (this.root.querySelector('.ws-perf-long') as HTMLElement).textContent = rest;
    // phones: the pill shows wall-clock fps + recent worst ms; the panel carries the draw calls / triangles the phone-tier budget is measured in
    // (project/archive/2026-09-22-play-perf.md), the p95, the tier and DPR
    (this.root.querySelector('.ws-perf-ms') as HTMLElement).textContent = engineString('s_perf_worst_frame', [Math.round(worst), check]);
    const R = this.rows;
    R.p50.textContent = engineString('s_f3813306296c', [p50.toFixed(1)]);
    R.p95.textContent = engineString('s_f3813306296c', [p95.toFixed(1)]);
    R.calls.textContent = String(r.calls);
    R.tris.textContent = k(r.triangles);
    // QA row 25: the drawing buffer the ratio makes, so a screenshot carries the Developer pixel pick (render/devPixels.ts)
    // (the size Game.fitSize gives the canvas at this ratio)
    const ratio = g.renderer.getPixelRatio(), buffer = drawingBuffer(window.innerWidth, viewportHeight(), ratio), pick = activeDevPixels();
    R.tier.textContent = engineString('s_perf_tier_buffer', [TIER, ratio.toFixed(2), buffer.width, buffer.height, (buffer.pixels / 1e6).toFixed(2), pick === null ? '' : engineString('s_perf_tier_dev', [pick.screen, pick.density])]);
    R.gl.textContent = gl === '' ? engineString('s_2689367b205c') : gl.replace(/^ · /, '');
    this.root.classList.toggle('slow', fps < 50);
    this.root.classList.toggle('bad', worst > 100 || fps < 30 || (this.budgetOn && this.budget.over));
    this.mirror();
  }

  /** copy the pill into the panel header's live pill */
  private mirror(): void {
    const L = this.live;
    L.fps.textContent = (this.root.firstElementChild as HTMLElement).textContent;
    L.ms.textContent = (this.root.querySelector('.ws-perf-ms') as HTMLElement).textContent;
    L.box.classList.toggle('slow', this.root.classList.contains('slow'));
    L.box.classList.toggle('bad', this.root.classList.contains('bad'));
  }
}
