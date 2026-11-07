/**
 * The PERF LAP's summary (E350 F-J1): the text Jake copies from the fps panel and pastes back. Pure (no DOM, no game), so
 * test/perf-lap.test.ts pins its format; src/client/engine/ui/perfLap.ts records the frames and fills the meta.
 *
 *   WILDSHARD PERF LAP · build <id>
 *   <start, local ISO> · <shard> · 6/6 spots · 1m14s
 *   <tier> · dpr 3 · render 2.00× · 804×1748 · cap 30 fps · WebKit
 *   rAF 60 Hz · Low Power Mode: no
 *   gpu~ p50 start 3.1 → end 4.0 ms (thermal drift +0.9)
 *   spot    fps50 fps5 @33ms >50 >100 gpu50 gpu95 calls tris
 *   gate     30.0 29.4   98%   0    0   2.1   3.0    88 1.2M
 *   …
 *   ALL      …
 *   worst frame per spot:
 *    gate    41ms render 30ms
 *
 * fps50 / fps5 = 1000 ÷ the frame interval's p50 / p95 (fps5 is the 5th-percentile fps); @33ms = the share of frames
 * within ±4 ms of the cap's interval (the "lock"; 16.7 ms uncapped); >50 / >100 = frames over 50 / 100 ms; gpu50 / gpu95
 * = frameCost's gpu~ (the wait beyond the work and the cap: the GPU, iOS's compositor); calls / tris = the p50 frame's.
 */
import { appIdentity } from '../../../shared/engine/app/identity';

/** one recorded frame (frameCost's split, the renderer's counts; `cause` is filled on a spot's worst frames only) */
export interface LapFrame { frame: number; update: number; render: number; gpu: number; calls: number; tris: number; cause: string }
export interface LapSpotResult { id: string; frames: readonly LapFrame[] }
export interface LapMeta {
  build: string; startedAt: string; shard: string; tier: string;
  dpr: number; pixelRatio: number; canvas: string; engine: string;
  /** the game's frame cap (0 = off) */
  capFps: number;
  /** requestAnimationFrame callbacks a second over the lap (iOS Low Power Mode halves it to ~30) */
  rafHz: number;
  elapsedS: number; total: number;
  /** why it stopped early, or null */
  cancelled: string | null;
}

const f1 = (n: number): string => n.toFixed(1);
const k = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(Math.round(n)));
export function pct(v: readonly number[], p: number): number {
  if (v.length === 0) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
}
const fps = (ms: number): string => (ms > 0 ? f1(1000 / ms) : '-');
const mmss = (s: number): string => `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;

/** the Low Power Mode hint: iOS caps requestAnimationFrame at 30 Hz in it (the game's own 30 cap does not change rAF) */
export function lowPower(rafHz: number): string {
  if (rafHz <= 0) return 'n/a';
  return rafHz < 40 ? `likely (rAF ~${Math.round(rafHz)} Hz)` : 'no';
}

/** a spot's row cells: fps50 fps5 lock% >50 >100 gpu50 gpu95 calls tris */
function row(name: string, frames: readonly LapFrame[], targetMs: number): string {
  const ms = frames.map((f) => f.frame), gpu = frames.map((f) => f.gpu);
  const lock = frames.length > 0 ? Math.round((100 * ms.filter((m) => Math.abs(m - targetMs) <= 4).length) / frames.length) : 0;
  return `${name.padEnd(8).slice(0, 8)}${fps(pct(ms, 0.5)).padStart(5)}${fps(pct(ms, 0.95)).padStart(5)}${`${lock}%`.padStart(6)}`
    + `${String(ms.filter((m) => m > 50).length).padStart(4)}${String(ms.filter((m) => m > 100).length).padStart(5)}`
    + `${f1(pct(gpu, 0.5)).padStart(6)}${f1(pct(gpu, 0.95)).padStart(6)}`
    + `${k(pct(frames.map((f) => f.calls), 0.5)).padStart(6)} ${k(pct(frames.map((f) => f.tris), 0.5))}`;
}

/** the p50 gpu~ of the first / last `n` frames recorded: the lap's start and end (the phone's throttle climbs over minutes) */
function edgeGpu(spots: readonly LapSpotResult[], n: number): { start: number; end: number } {
  const all = spots.flatMap((s) => s.frames.map((f) => f.gpu));
  return { start: pct(all.slice(0, n), 0.5), end: pct(all.slice(-n), 0.5) };
}

export function lapSummary(meta: LapMeta, spots: readonly LapSpotResult[]): string {
  const L: string[] = [];
  const targetMs = 1000 / (meta.capFps > 0 ? meta.capFps : 60);
  L.push(`${appIdentity().name.toUpperCase()} PERF LAP · build ${meta.build || '?'}`);
  L.push(`${meta.startedAt} · ${meta.shard} · ${spots.length}/${meta.total} spots · ${mmss(meta.elapsedS)}${meta.cancelled !== null ? ` · CANCELLED: ${meta.cancelled}` : ''}`);
  L.push(`${meta.tier} · dpr ${meta.dpr} · render ${meta.pixelRatio.toFixed(2)}× · ${meta.canvas} · cap ${meta.capFps > 0 ? `${meta.capFps} fps` : 'off'} · ${meta.engine}`);
  L.push(`rAF ${Math.round(meta.rafHz)} Hz · Low Power Mode: ${lowPower(meta.rafHz)}`);
  if (spots.length > 0) {
    const g = edgeGpu(spots, 60), d = g.end - g.start;
    L.push(`gpu~ p50 start ${f1(g.start)} → end ${f1(g.end)} ms (thermal drift ${d >= 0 ? '+' : ''}${f1(d)})`);
  }
  L.push(`spot    fps50 fps5 @${Math.round(targetMs)}ms >50 >100 gpu50 gpu95 calls tris`);
  for (const s of spots) L.push(row(s.id, s.frames, targetMs));
  if (spots.length > 1) L.push(row('ALL', spots.flatMap((s) => s.frames), targetMs));
  if (spots.length > 0) {
    L.push('worst frame per spot:');
    for (const s of spots) {
      const w = s.frames.reduce<LapFrame | null>((best, f) => (best === null || f.frame > best.frame ? f : best), null);
      L.push(` ${s.id.padEnd(8).slice(0, 8)}${w === null ? '-' : `${w.frame.toFixed(0)}ms ${w.cause || '-'}`}`);
    }
  }
  return L.join('\n');
}
