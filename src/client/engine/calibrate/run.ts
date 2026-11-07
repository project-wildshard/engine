import { CalibrationGpu, type Timing, type Work } from '../render/calibrationGpu';
import { measureJs } from './js';
import { measureWasm, type CalibrationScript, type WasmCalibration } from './wasm';
import { fit, median, type Fit } from './math';
import { Scope } from '../../../shared/engine/app/scope';
import { mountUi } from '../ui/ownership';
import type { Calibration, CalibrationCosts } from '../render/budgets';

export interface Observation { sweep: string; kind: string; n: number; baseline: Timing; work: Timing }
export interface CalibrationRun extends Calibration {
  renderer: string; userAgent: string; pixels: number;
  cold: Observation[]; hot: Observation[]; js: Awaited<ReturnType<typeof measureJs>>;
  coldJs: Awaited<ReturnType<typeof measureJs>>; coldLinks: { n: number; ms: number }[]; links: { n: number; ms: number }[];
  /** WASM-HOST H0: the script boundary's prices on this device */
  wasm: WasmCalibration;
  heat: { seconds: number; ms: number; change: number | null }[];
  fits: Record<string, Fit>;
  stable: boolean; lowPowerMode: 'unknown'; flags: string[];
  protocol: { timing: string; combine: string; vertexClasses: string; js: string };
}
export interface CalibrationMeasurements {
  cold: Observation[]; hot: Observation[]; js: CalibrationRun['js']; coldJs: CalibrationRun['js'];
  coldLinks: CalibrationRun['links']; links: CalibrationRun['links']; heat: CalibrationRun['heat']; stable: boolean;
}
declare global { interface Window { __calibration?: { status: string; result: CalibrationRun | null; error: string | null; inbox: string; measurements?: CalibrationMeasurements | undefined } } }
async function sweeps(g: CalibrationGpu, scope: Scope, progress: (s: string) => void): Promise<Observation[]> {
  const rows: Observation[] = [];
  const sample = async (sweep: string, kind: string, n: number, work: Work): Promise<void> => {
    progress(`${sweep} · ${kind} · ${n}`); const empty = g.draws(0);
    try { const baseline = g.measure(empty); const timing = g.measure(work); rows.push({ sweep, kind, n, baseline, work: timing }); } finally { empty.dispose(); work.dispose(); }
    await new Promise<void>((resolve) => { scope.timeout(0, resolve); });
  };
  for (const n of [0, 100, 200, 400, 800]) await sample('draws', 'one-program', n, g.draws(n));
  for (const programs of [1, 8, 32]) for (const textures of [1, 16]) await sample('state', `${textures}-textures`, programs, g.draws(400, programs, textures));
  for (const kind of ['static', 'skinned', 'wind'] as const) for (const n of [250000, 1000000, 4000000]) await sample('triangles', kind, n, g.triangles(n, kind));
  for (const kind of ['flat', 'toon', 'pbr', 'alphaTest', 'blend'] as const) for (const n of [1, 2, 4, 8]) await sample('fill', kind, n, g.fill(n, kind));
  for (const halfFloat of [false, true]) for (const scale of [1, 0.5, 0.25]) for (const n of [8, 32, 128]) await sample('passes', `${halfFloat ? 'RGBA16F' : 'RGBA8'}@${scale}`, n, g.passes(n, scale, halfFloat));
  for (const n of [100, 400, 800]) {
    const draws = g.draws(n), fill = g.fill(4, 'pbr');
    await sample('overlap', 'draws+fill', n, { draw: () => { draws.draw(); fill.draw(); }, dispose: () => { draws.dispose(); fill.dispose(); } });
  }
  return rows;
}
export async function runCalibration(progress: (s: string) => void = () => undefined, measured: (samples: CalibrationMeasurements) => void = () => undefined,
  scripts: readonly CalibrationScript[] = []): Promise<CalibrationRun> {
  if (document.querySelector('canvas')) throw new Error('Calibration requires the empty capture state');
  const g = new CalibrationGpu(), scope = new Scope('calibration');
  mountUi(g.renderer.domElement, scope, document.body);
  try {
    const gl = g.renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer: string = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unavailable';
    const cold = await sweeps(g, scope, (s) => { progress(`Cold · ${s}`); });
    progress('Cold · JS'); const coldJs = await measureJs(), coldLinks = [];
    for (const n of [64, 256, 1024]) { progress(`Cold · Link · ${n}`); coldLinks.push({ n, ms: g.link(n) }); }
    const heater = g.fill(8, 'pbr'), heat: CalibrationRun['heat'] = [];
    let stable = false;
    try {
      const start = performance.now(); let lastWindow = start, windowMs: number[] = [];
      while (performance.now() - start < 120000) {
        progress('Preheat · full-screen PBR'); windowMs.push(g.measure(heater).throughputMs); await new Promise<void>((resolve) => { scope.timeout(0, resolve); });
        if (performance.now() - lastWindow < 30000) continue;
        const ms = median(windowMs), previousMs = heat[heat.length - 1]?.ms, change = previousMs === undefined ? null : Math.abs(ms / previousMs - 1);
        heat.push({ seconds: (performance.now() - start) / 1000, ms, change }); windowMs = []; lastWindow = performance.now();
        if (change !== null && change < 0.02) { stable = true; break; }
      }
    } finally { heater.dispose(); }
    const hot = await sweeps(g, scope, (s) => { progress(`Hot · ${s}`); });
    progress('JS · rigs, bodies, navigation'); const js = await measureJs();
    const links = [];
    for (const n of [64, 256, 1024]) { progress(`Link · ${n} programs`); links.push({ n, ms: g.link(n) }); }
    const points = (sweep: string, kind: string, cpu = false): { n: number; ms: number }[] => hot.filter((r) => r.sweep === sweep && r.kind === kind).map((r) => ({ n: sweep === 'triangles' ? r.work.tris : r.n, ms: cpu ? r.work.submitMs - r.baseline.submitMs : r.work.throughputMs - r.baseline.throughputMs }));
    measured({ cold, hot, js, coldJs, coldLinks, links, heat, stable });
    const wasm = await measureWasm(scripts, progress);
    const fits: Record<string, Fit> = {};
    const fitted = (name: string, samples: { n: number; ms: number }[]): number => {
      try { const result = fit(samples); fits[name] = result; return result.slope; }
      catch (error) { throw new Error(`Calibration fit ${name} refused`, { cause: error }); }
    };
    const costs: CalibrationCosts = {
      drawCpuMs: fitted('drawCpuMs', points('draws', 'one-program', true)),
      triangleGpuMs: { static: fitted('triangleGpuMs.static', points('triangles', 'static')), skinned: fitted('triangleGpuMs.skinned', points('triangles', 'skinned')), wind: fitted('triangleGpuMs.wind', points('triangles', 'wind')) },
      fragmentGpuMs: { flat: fitted('fragmentGpuMs.flat', points('fill', 'flat')) / (804 * 1748), toon: fitted('fragmentGpuMs.toon', points('fill', 'toon')) / (804 * 1748), pbr: fitted('fragmentGpuMs.pbr', points('fill', 'pbr')) / (804 * 1748), alphaTest: fitted('fragmentGpuMs.alphaTest', points('fill', 'alphaTest')) / (804 * 1748), blend: fitted('fragmentGpuMs.blend', points('fill', 'blend')) / (804 * 1748) },
      passGpuMs: Object.fromEntries([...new Set(hot.filter((r) => r.sweep === 'passes').map((r) => r.kind))].map((kind) => [kind, fitted(`passGpuMs.${kind}`, points('passes', kind))])),
      linkMs: fitted('linkMs', links), rigCpuMs: fitted('rigCpuMs', js.rig), bodyCpuMs: fitted('bodyCpuMs', js.body), agentCpuMs: fitted('agentCpuMs', js.agent),
    };
    return { schema: 1, measuredAt: new Date().toISOString(), device: 'Apple M5 Max', renderer, userAgent: navigator.userAgent, pixels: 804 * 1748,
      source: 'budgets/calibration.json (scripts/calibrate.mjs)', phone: { ratio: 10, source: 'docs/tasks/asks/E283.md; hot phone:M5 ≈10× (cool ≈6×)', assumption: 'ASSUMPTION: hot iPhone costs equal measured M5 costs × 10; no phone calibration was run (decision 99)' },
      combine: 'serial', costs, fits, cold, hot, js, coldJs, coldLinks, links, wasm, heat, stable, lowPowerMode: 'unknown',
      flags: [...stable ? [] : ['preheat did not converge below 2% in 30-second windows'], 'Low Power Mode cannot be detected reliably by Web APIs; unknown'],
      protocol: { timing: '5 batches ×16–128 frozen draws (100ms pilot target); pass range 8/32/128, pending 1px write/readPixels sync; p50; interleaved empty baselines; positive linear fits require r² >=0.9. Fresh 64/256/1024-program compile + first-use + readback measures link/warm-up including conservative first-use overhead, without 10ms async polling. Throughput is a GPU ruler including submission, not timer-query GPU time.',
        combine: 'serial (conservative): frozen throughput overlap sweep cannot establish live CPU/GPU overlap; do not infer pipelining from throughput alone', vertexClasses: 'static and wind; skinned is synthetic two-matrix vertex blending, not a production creature shader', js: '16-bone skeleton pose/skin-matrix update; Rapier step plus capsule character-controller queries; nearest-poly query on a synthetic 64-poly tile' } };
  } finally { g.dispose(); scope.dispose(); }
}
