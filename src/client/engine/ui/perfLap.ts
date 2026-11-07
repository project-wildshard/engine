import type { Scope } from '../../../shared/engine/app/scope';
import { uiScope } from './ownership';
import { engineString } from '../../../shared/engine/strings';
import { saveStorage } from '../saves/slots';
/**
 * The PERF LAP (E350 F-J1, Jake picked "Automate it": the iPhone reading of Pine Hollow's locked 30 fps at the gate, the
 * cabin, the pond, the hamlet, the lookout and the King's clearing, without doing it by hand). One tap on PERF LAP in the
 * fps panel (src/client/engine/ui/Perf.ts) and, on a shard that registered a host (src/shared/engine/core/perfLap.ts; Pine Hollow's is
 * src/shards/pine-hollow/runtime/dev/perfLap.ts):
 *
 *   for each spot   stand there (a teleport), SETTLE_MS still to let the streaming / LODs land, then REC_MS of frames
 *                   (frameCost's split, the renderer's counts) while the view turns one slow 360° — the whole spot, not one
 *                   view
 *   then            back where the player stood, and the summary (src/client/engine/ui/perfLapSummary.ts) in the panel: COPY, and kept
 *                   in localStorage like REC 30 S
 *
 * Safe: it will not start in a practice room, mid-fight, riding or swimming (a toast says why); any touch or key cancels
 * it (the player goes back, the spots done so far are summarised); a fight, the menu or the page going to the background
 * cancels it too. `perfLap.active` holds every x / z trigger that saves or starts something while it runs.
 */
import type { Game } from '../core/Game';
import { TIER, frameCapFps } from '../core/tier';
import { frameCost, BUCKETS, type FrameRecord } from '../../../shared/engine/core/frameCost';
import { perfLap, type PerfLapHost, type LapSpot } from '../../../shared/engine/core/perfLap';
import { lapSummary, type LapFrame, type LapSpotResult } from './perfLapSummary';

const savedStorage = saveStorage('device');

declare const __BUILD_ID__: string; // vite.config.ts define
function buildId(): string { try { return __BUILD_ID__; } catch { return ''; } }

export const LAP_STORE = 'perf.lap';
/** still at the spot before recording (the teleport's streaming, LOD swaps and first-draw uploads land here) */
const SETTLE_MS = 3000;
/** the recording at each spot, one full turn */
const REC_MS = 8000;

/** the largest share of a frame (frameCost.end's rule) and its longest single system */
function frameCause(f: FrameRecord): string {
  let claimed = 0;
  for (const v of f.buckets) claimed += v;
  let cause = 'other', cms = Math.max(0, f.update - claimed);
  f.buckets.forEach((v, i) => { if (v > cms) { cms = v; cause = BUCKETS[i] ?? ''; } });
  if (f.render > cms) { cms = f.render; cause = 'render'; }
  if (f.gpu > cms) { cms = f.gpu; cause = 'gpu~'; }
  return engineString('s_1238155d5b75', [cause, cms.toFixed(0), f.top !== '' && cause !== 'render' && cause !== 'gpu~' ? engineString('s_c8abc4b4ead7', [f.top, f.topMs.toFixed(0)]) : '']);
}

interface Run {
  scope: Scope;
  host: PerfLapHost;
  start: { x: number; y: number; z: number; yaw: number; pitch: number };
  t0: number; startedAt: string;
  i: number; phase: 'settle' | 'rec'; phaseT0: number;
  frames: LapFrame[]; worst: number;
  done: LapSpotResult[];
  raf: { n: number; id: number; t0: number };
  frameCostWas: boolean;
}

export class PerfLap {
  readonly scope: ReturnType<typeof uiScope> = uiScope('PerfLap');
  private run: Run | null = null;
  private readonly onInput = (): void => { this.cancel('touch / key'); };
  private readonly onHidden = (): void => { if (document.visibilityState === 'hidden') this.cancel('the app went to the background'); };
  lastText = '';
  /** the lap's progress line (null = the lap is over) */
  onStatus: ((text: string | null) => void) | null = null;
  onDone: ((text: string) => void) | null = null;

  private readonly game: Game;
  constructor(game: Game) {
    this.game = game;
    try { this.lastText = savedStorage.getItem(LAP_STORE) ?? ''; } catch { this.lastText = ''; }
  }

  get running(): boolean { return this.run !== null; }

  /** start the lap; returns why it cannot (shown as a toast), or null when it started */
  start(recording: boolean): string | null {
    if (this.run !== null) return engineString('s_89458684f9d5');
    const host = perfLap.host;
    if (host === null || host.game !== this.game) return engineString('s_8d282280dca8');
    const refuse = (why: string): string => { host.toast(why); return why; };
    if (recording) return refuse('PERF LAP: not while REC 30 S is recording');
    const busy = host.busy();
    if (busy !== null) return refuse(`PERF LAP: ${busy}`);
    const p = host.player;
    const now = performance.now();
    const raf = { n: 0, id: 0, t0: now };
    const scope = this.scope.child('run');
    const count = (): void => { raf.n++; raf.id = scope.raf(count); };
    raf.id = scope.raf(count);
    this.run = {
      scope, host, start: { x: p.position.x, y: p.position.y, z: p.position.z, yaw: p.yaw, pitch: p.pitch },
      t0: now, startedAt: localIso(new Date()), i: 0, phase: 'settle', phaseT0: now, frames: [], worst: -1, done: [], raf, frameCostWas: frameCost.on,
    };
    perfLap.active = true;
    host.hold(true);
    // any touch or key cancels (capture: before the look layer or a button sees it)
    for (const t of ['pointerdown', 'touchstart', 'keydown'] as const) scope.listen(window, t, this.onInput, { capture: true });
    scope.listen(document, 'visibilitychange', this.onHidden);
    this.goTo(0, now);
    return null;
  }

  /** every frame (Perf.update) */
  tick(now: number): void {
    const r = this.run;
    if (r === null) return;
    const busy = r.host.busy();
    if (busy !== null) { this.cancel(busy.replace(/^not /, '')); return; }
    const spot = r.host.spots[r.i];
    if (spot === undefined) { this.finish(null); return; }
    const p = r.host.player;
    if (r.phase === 'settle') {
      p.yaw = spot.yaw; p.pitch = 0;
      if (now - r.phaseT0 >= SETTLE_MS) {
        r.phase = 'rec'; r.phaseT0 = now; r.frames = []; r.worst = -1;
        frameCost.on = true;
        frameCost.onFrame = (f) => { this.frame(f); };
      }
    } else {
      const k = Math.min(1, (now - r.phaseT0) / REC_MS);
      p.yaw = spot.yaw + k * Math.PI * 2; p.pitch = 0;
      if (k >= 1) {
        frameCost.onFrame = null;
        r.done.push({ id: spot.id, frames: r.frames });
        if (r.i + 1 >= r.host.spots.length) { this.finish(null); return; }
        this.goTo(r.i + 1, now);
      }
    }
    this.status(spot, now);
  }

  /** stop now: the player back where they stood, the spots done so far summarised */
  cancel(why: string): void {
    const r = this.run;
    if (r === null) return;
    r.host.toast(engineString('s_c0b5cc9cfad9', [why]));
    this.finish(why);
  }

  private frame(f: FrameRecord): void {
    const r = this.run;
    if (r === null) return;
    const worst = f.frame > r.worst;
    if (worst) r.worst = f.frame;
    r.frames.push({ frame: f.frame, update: f.update, render: f.render, gpu: f.gpu, calls: this.game.lastFrame.calls, tris: this.game.lastFrame.triangles, cause: worst ? frameCause(f) : '' });
  }

  private goTo(i: number, now: number): void {
    const r = this.run;
    if (r === null) return;
    const spot = r.host.spots[i];
    if (spot === undefined) return;
    r.i = i; r.phase = 'settle'; r.phaseT0 = now;
    r.host.player.spawn(spot.x, spot.z, spot.yaw, spot.y);
    r.host.player.pitch = 0;
  }

  private lastStatus = '';
  private status(spot: LapSpot, now: number): void {
    const r = this.run;
    if (r === null) return;
    const left = Math.ceil(((r.phase === 'settle' ? SETTLE_MS : REC_MS) - (now - r.phaseT0)) / 1000);
    const text = `PERF LAP · ${r.i + 1}/${r.host.spots.length} ${spot.id.toUpperCase()} · ${r.phase === 'settle' ? 'SETTLE' : 'REC'} ${left} S · TAP TO CANCEL`;
    if (text === this.lastStatus) return;
    this.lastStatus = text;
    this.onStatus?.(text);
  }

  private finish(cancelled: string | null): void {
    const r = this.run;
    if (r === null) return;
    this.run = null;
    frameCost.onFrame = null;
    frameCost.on = r.frameCostWas;
    r.scope.dispose();
    const s = r.start;
    r.host.player.spawn(s.x, s.z, s.yaw, s.y);
    r.host.player.pitch = s.pitch;
    r.host.hold(false);
    perfLap.active = false;
    const now = performance.now(), cv = this.game.renderer.domElement, ua = navigator.userAgent;
    const text = lapSummary({
      build: buildId(), startedAt: r.startedAt, shard: r.host.shard, tier: TIER,
      dpr: devicePixelRatio, pixelRatio: this.game.renderer.getPixelRatio(), canvas: `${cv.width}×${cv.height}`,
      engine: ua.includes('AppleWebKit') && !/Chrome|Chromium|Edg/.test(ua) ? 'WebKit' : 'Blink',
      capFps: frameCapFps(), rafHz: r.raf.n / Math.max(0.001, (now - r.raf.t0) / 1000),
      elapsedS: (now - r.t0) / 1000, total: r.host.spots.length, cancelled,
    }, r.done);
    this.lastText = text; this.lastStatus = '';
    try { savedStorage.setItem(LAP_STORE, text); } catch { /* not kept past this load */ }
    console.info(`[perf lap]\n${text}`);
    Object.assign(window, { __perfLap: { text } });
    this.onStatus?.(null);
    this.onDone?.(text);
  }
}

/** local wall time, minutes (the phone's clock: when Jake ran it) */
function localIso(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return engineString('s_86cd35de379d', [d.getFullYear(), p(d.getMonth() + 1), p(d.getDate()), p(d.getHours()), p(d.getMinutes())]);
}
