// ENGINE-MEMORY EM11: the phone chain that replaced "Chromium renderer x 2.0". The one phone anchor is staging v0.1.36
// with Nine rev 2, which Jake's iPhone 17 Pro killed right after the boot trace's last `compile:after` (mini QA 19).
// EM11b: the anchor and the zones are read with measure.mjs's instrument minimal (no Web Inspector Network retention);
// the first anchor reading (instrument full) is kept beside it to pin what that changed.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { CRASH_LINE, MEMORY_AMBER, MEMORY_RED } from '../src/client/game/grid/budgetOverlay';
import { IPHONE_13_MODEL, anchorBounds, ledgerSplit, loadPhoneModel, phoneFromChromium, phoneFromLedger, phoneFromWebKit, phonePeakFromWebKit, rangeText, t90, upperOverRuns, zoneOverRuns } from '../src/scripts/memory/phoneModel.mjs';
import { ANCHOR_RENDERER_MB, fitPhoneModel, lineFit } from '../src/scripts/memory/phone-fit.mjs';
import { phoneLine, summaryMarkdown, traceToControl } from '../src/scripts/memory/measure.mjs';

const MB = 1e6;
interface Window { step: string; peak: { webcontent: number; gpu: number } }
const anchor = JSON.parse(readFileSync(new URL('fixtures/memory/phone-anchor-v0136-nine.json', import.meta.url), 'utf8')) as { instrument: string; runs: Window[][] };
const anchorFull = JSON.parse(readFileSync(new URL('fixtures/memory/phone-anchor-v0136-nine-full.json', import.meta.url), 'utf8')) as { instrument: string; runs: Window[][] };
const model = loadPhoneModel() as { instrument: string; limitMB: number; limitHighMB: number; gpuFloorMB: number; alpha: { low: number; high: number }; scale: { low: number; high: number };
  chromium: { loadingPerRenderer: { low: number; central: number; high: number } }; zones: Record<string, { phoneLoadingMB: { low: number; central: number; high: number }; phonePlayingMB: { central: number } }> };

test('the chip and the calibration use the one device limit, ActiveHard 2048 MiB', () => {
  expect(CRASH_LINE).toBe(2048 * 1024 ** 2);
  expect(model.limitMB).toBe(Math.round(CRASH_LINE / MB));
  expect(model.limitHighMB).toBe(model.limitMB);
});

test('EM37 derives the staircase factors from last completed decimal MB and the one process line', () => {
  const staircase = loadPhoneModel().staircase!;
  expect(staircase.processLineBytes).toBe(CRASH_LINE);
  expect(MEMORY_AMBER).toBe(1.5e9);
  expect(MEMORY_RED).toBe(1.75e9);
  expect(Object.keys(staircase.effectiveFactors)).toHaveLength(11);
  for (const [kind, factor] of Object.entries(staircase.effectiveFactors)) {
    expect(factor).toBeCloseTo(CRASH_LINE / (staircase.lastCompletedMB[kind]! * MB), 3);
  }
});

test('nominal heap and canvas receive their own factors once, with estimated cache and collider storage still pooled', () => {
  const { staircase, ...old } = loadPhoneModel();
  const bare = { ram: { 'cache-document': 4 * MB, physics: 3 * MB }, gpu: { geometry: 5 * MB } };
  const counters = { ...bare, ram: { ...bare.ram, jsheap: 8 * MB, canvas: 3 * MB } };
  const base = phoneFromLedger(bare, old), fitted = phoneFromLedger(counters, { ...old, staircase: staircase! });
  const extra = (8 * staircase!.effectiveFactors.jsheap + 3 * staircase!.effectiveFactors.canvas2d) * MB;
  expect(fitted.central - base.central).toBeCloseTo(extra, 5);
  expect(fitted.high - base.high).toBeCloseTo(extra * (1 + old.ledger.missPct / 100), 5);
  expect(phoneFromLedger(counters, old).central - base.central).toBeCloseTo(11 * MB * old.ledger.webcontent.perMB, 5);
});

test('IP11 names the unmeasured inputs and keeps the 17 Pro reading in the report', () => {
  const device = loadPhoneModel().devices?.[IPHONE_13_MODEL];
  expect(device).toEqual({ name: 'iPhone 13', status: 'unmeasured', reportOnly: true,
    alpha: null, scale: null, limitMB: null, limitHighMB: null, fitInputs: { killLineFromIP7: expect.objectContaining({ limitMB: 1536 }), pairedFootprintsFromIP9: null } });
  const out = execFileSync(process.execPath, ['src/scripts/memory/phone-fit.mjs', `--device=${IPHONE_13_MODEL}`], { encoding: 'utf8' });
  expect(JSON.parse(out)).toEqual(device);
  const run = { instrument: 'minimal', build: 'test', settled: { webcontent: 500 * MB, gpu: 300 * MB },
    checkpoints: [{ peak: { webcontent: 600 * MB, gpu: 400 * MB } }] };
  const { devices: _devices, ...pro } = loadPhoneModel();
  expect(phoneLine(run)).toBe(phoneLine(run, pro));
  const report = summaryMarkdown('brasscap-mesa', [run], null, null);
  expect(report).toContain(rangeText(phoneFromWebKit(run.settled, pro)));
  expect(report).toContain("iPhone 13, iPhone14,5, report only]: unmeasured. Kill line 1536 MB (IP7). Awaiting IP9's paired footprints.");
});

test('a 17 Pro CLI refit keeps the separate iPhone 13 entry', () => {
  mkdirSync('tmp', { recursive: true });
  const scratch = mkdtempSync('tmp/ip11-fit-');
  try {
    const anchorPath = join(scratch, 'anchor.json'), zones = [join(scratch, 'a.json'), join(scratch, 'b.json')];
    writeFileSync(anchorPath, JSON.stringify({ webkit: anchor.runs.map(traceCheckpoints => ({ traceCheckpoints, instrument: anchor.instrument })) }));
    for (const [index, path] of zones.entries()) {
      const ram = (50 + 100 * index) * MB, gpu = (300 + 600 * index) * MB;
      const settled = { webcontent: (500 + 400 * index) * MB, gpu };
      writeFileSync(path, JSON.stringify({ webkit: [{ chunk: `test-${index}`, build: 'fixture', ready: true, instrument: anchor.instrument,
        settled, counters: { ram: { bytes: ram }, gpu: { bytes: gpu } }, checkpoints: [{ peak: settled }] }] }));
    }
    const out = join(scratch, 'fit.json');
    execFileSync(process.execPath, ['src/scripts/memory/phone-fit.mjs', `--anchor=${anchorPath}`, `--zones=${zones.join(',')}`, `--out=${out}`]);
    expect(JSON.parse(readFileSync(out, 'utf8'))).toMatchObject({ alpha: model.alpha, scale: model.scale, limitMB: model.limitMB,
      devices: loadPhoneModel().devices, staircase: loadPhoneModel().staircase });
    const evidence = join(scratch, 'staircase.json');
    const expected = loadPhoneModel().staircase!;
    writeFileSync(evidence, JSON.stringify({ ...expected, effectiveFactors: {} }));
    execFileSync(process.execPath, ['src/scripts/memory/phone-fit.mjs', `--staircase=${evidence}`, `--out=${out}`]);
    expect(JSON.parse(readFileSync(out, 'utf8'))).toMatchObject({
      alpha: model.alpha, scale: model.scale, limitMB: model.limitMB, staircase: expected,
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('v0.1.36 Nine, the boot the phone died in: the chain puts its last compile:after window at or over the line, and every window before it under the higher line', () => {
  // The committed range is the runs' median bounds: the run whose death window held the least GPU (837 MB, where the
  // other three held 1.7 GB) needs alpha over 0.62, so its central figure sits under the line; every high end is over it.
  const centrals: number[] = [];
  for (const windows of anchor.runs) {
    const at = windows.map((w) => w.step).lastIndexOf('compile:after');
    const died = phoneFromWebKit(windows[at]!.peak, model);
    centrals.push(died.central);
    expect(died.high).toBeGreaterThanOrEqual(model.limitMB * MB);
    for (const lived of windows.slice(0, at)) expect(phoneFromWebKit(lived.peak, model).central).toBeLessThan(model.limitHighMB * MB);
  }
  // the committed range is the runs' median bounds, so it holds for the median run at least at its low end
  expect(centrals.sort((a, b) => a - b)[Math.floor(centrals.length / 2)]).toBeGreaterThanOrEqual(model.limitMB * MB);
  const lows = anchor.runs.map((windows) => phoneFromWebKit(windows[windows.map((w) => w.step).lastIndexOf('compile:after')]!.peak, model).low).sort((a, b) => a - b);
  expect(lows[1]).toBeGreaterThanOrEqual(model.limitMB * MB * 0.99);
});

test('EM11b: the model, its anchor and its zones are all read without the inspector\'s Network retention', () => {
  expect(anchor.instrument).toBe('minimal');
  expect(model.instrument).toBe('minimal');
  expect(anchorFull.instrument).toBe('full');
});

test('EM11b: the inspector inflated the anchor\'s death window, and the anchor absorbed it into the GPU share', () => {
  const died = (runs: Window[][]) => runs.map((w) => w[w.map((x) => x.step).lastIndexOf('compile:after')]!.peak.webcontent).sort((a, b) => a - b);
  const clean = died(anchor.runs), full = died(anchorFull.runs);
  // WebContent in the window the phone died in: ~1.63 GB clean against ~1.80 GB with the Network domain on
  expect(full[1]! - clean[1]!).toBeGreaterThan(120 * MB);
  // the same phone death on lower WebContent needs a larger share of the GPU process: alpha rose (was 0.20-0.47)
  const before = anchorFull.runs.map((w) => anchorBounds(w, 'compile:after', model).alpha.low).sort((a, b) => a - b);
  expect(model.alpha.low).toBeGreaterThan(before[1]!);
});

test('the anchor bounds both families from both sides and agrees with itself', () => {
  for (const windows of anchor.runs) {
    const b = anchorBounds(windows, 'compile:after', model);
    expect(b.consistent).toBe(true);
    expect(b.alpha.low).toBeLessThan(b.alpha.high);
    expect(b.scale.low).toBeLessThan(b.scale.high);
  }
  expect(model.alpha.low).toBeGreaterThan(0);
  expect(model.alpha.high).toBeLessThan(1);
});

test('a window shape the phone would contradict is flagged, not fitted', () => {
  const w = (step: string, wc: number, gpu: number): Window => ({ step, peak: { webcontent: wc * MB, gpu: gpu * MB } });
  // lived through 2,100 MB of WebContent alone, died at 1,000: no share of the GPU side explains both
  const b = anchorBounds([w('a', 2100, 600), w('compile:after', 1000, 600)], 'compile:after', { limitMB: 2050, limitHighMB: 2147, gpuFloorMB: 17.6 });
  expect(b.consistent).toBe(false);
  expect(() => anchorBounds([w('compile:after', 1, 1)], 'compile:after', model)).toThrow('windows before it');
});

test('the chain: WebContent plus a share of the GPU process over its floor; the bar is both families\' envelope', () => {
  const m = { gpuFloorMB: 20, alpha: { low: 0.2, high: 0.4 }, scale: { low: 0.6, high: 0.8 } };
  const p = phoneFromWebKit({ webcontent: 1000 * MB, gpu: 520 * MB }, m);
  expect(p.central / MB).toBeCloseTo(1150);
  expect(p.low / MB).toBeCloseTo(Math.min(1100, 0.6 * 1500));
  expect(p.high / MB).toBeCloseTo(Math.max(1200, 0.8 * 1500));
  expect(phonePeakFromWebKit([{ peak: { webcontent: 500 * MB, gpu: 20 * MB } }, { peak: { webcontent: 1000 * MB, gpu: 520 * MB } }], m).central).toBe(p.central);
  expect(rangeText(p)).toBe('1.15 GB (0.90-1.20)');
});

test('the ledger and Chromium readers use the committed fits', () => {
  const m = { gpuFloorMB: 0, alpha: { low: 0.5, high: 0.5 }, scale: { low: 1, high: 1 }, ledger: { webcontent: { floorMB: 100, perMB: 2 }, gpu: { floorMB: 50, perMB: 3 }, missPct: 10 },
    peakOverSettled: { low: 1.2, central: 1.3, high: 1.5 }, chromium: { loadingPerRenderer: { low: 1.8, central: 2.2, high: 2.6 } } };
  const counters = { ram: { 'array-buffer': 40 * MB }, workers: { 'w/wasm': 10 * MB }, gpu: { texture: 20 * MB, buffer: 10 * MB } };
  expect(ledgerSplit(counters)).toEqual({ ram: 50 * MB, gpu: 30 * MB });
  const playing = phoneFromLedger(counters, m); // WebContent 200, GPU 140 -> 200 + 0.5 x 140 = 270
  expect(playing.central / MB).toBeCloseTo(270);
  expect(playing.high / MB).toBeCloseTo(374); // family B at scale 1 (340) over A at 0.5 (270), plus the 10% miss
  expect(phoneFromLedger(counters, m, 'loading').central / MB).toBeCloseTo(351);
  expect(phoneFromChromium(1000 * MB, m)).toEqual({ low: 1800 * MB, central: 2200 * MB, high: 2600 * MB });
  expect(lineFit([[0, 100], [10, 120], [20, 140]])).toEqual({ floorMB: 100, perMB: 2 });
});

test('the trace windows end at control', () => {
  expect(traceToControl([[1, 'a', null], [5, 'b', null], [9, 'late', null]], [[0, 'page', null], [7, 'control', null]]).map((m) => m[1])).toEqual(['a', 'b', 'control']);
});

test('the fit reproduces the committed alpha and scale from the committed anchor', () => {
  const zone = { chunk: 'z', build: 'b', ready: true, refused: null, settled: { webcontent: 500 * MB, gpu: 300 * MB }, counters: { ram: { a: 50 * MB }, gpu: { t: 30 * MB } },
    checkpoints: [{ step: 'control', peak: { webcontent: 600 * MB, gpu: 400 * MB } }] };
  const zone2 = { ...zone, chunk: 'y', settled: { webcontent: 900 * MB, gpu: 900 * MB }, counters: { ram: { a: 150 * MB }, gpu: { t: 150 * MB } } };
  const zone3 = { ...zone, chunk: 'x', settled: { webcontent: 700 * MB, gpu: 500 * MB }, counters: { ram: { a: 100 * MB }, gpu: { t: 80 * MB } } };
  const fitted = fitPhoneModel({ anchor: anchor.runs.map((traceCheckpoints) => ({ traceCheckpoints })), last: 'compile:after', zones: [[zone], [zone2], [zone3]], chromium: { z: [300 * MB] },
    limitMB: model.limitMB, limitHighMB: model.limitHighMB, gpuFloorMB: model.gpuFloorMB });
  expect(fitted.alpha).toEqual(model.alpha);
  expect(fitted.scale).toEqual(model.scale);
  expect(fitted.anchor.consistent).toBe(true);
  expect(fitted.chromium?.loadingPerRenderer.central).toBeGreaterThan(0);
  // the zones' ratio here is ~2.7; held to the anchor's floor, a light ratio still puts v0.1.36's lowest renderer at the line
  const light = fitPhoneModel({ anchor: anchor.runs.map((traceCheckpoints) => ({ traceCheckpoints })), last: 'compile:after', zones: [[zone], [zone2], [zone3]], chromium: { z: [3000 * MB] },
    limitMB: model.limitMB, limitHighMB: model.limitHighMB, gpuFloorMB: model.gpuFloorMB });
  expect(light.chromium!.loadingPerRenderer.central * Math.min(...ANCHOR_RENDERER_MB)).toBeGreaterThanOrEqual(model.limitMB - 1);
  expect(light.chromium!.loadingPerRenderer.high).toBeGreaterThanOrEqual(light.chromium!.loadingPerRenderer.central);
});

test('Template, Dunes, Pine and Nine each carry a prediction with its error bar', () => {
  for (const zone of ['_template', 'sunscar-dunes', 'pine-hollow', 'nine-dragon-stack']) {
    const row = model.zones[zone]!;
    expect(row.phoneLoadingMB.low).toBeLessThanOrEqual(row.phoneLoadingMB.central);
    expect(row.phoneLoadingMB.central).toBeLessThanOrEqual(row.phoneLoadingMB.high);
  }
  // Nine on 037d9f15: its loading peak's upper bound is under the crash line but over J410's 1.5 GB loading line
  expect(model.zones['nine-dragon-stack']!.phoneLoadingMB.high).toBeLessThan(model.limitMB);
  expect(model.zones['nine-dragon-stack']!.phoneLoadingMB.high).toBeGreaterThan(1500);
  expect(model.chromium.loadingPerRenderer.low).toBeLessThan(model.chromium.loadingPerRenderer.high);
});

test('EM11c: a zone\'s upper bound is the 90% prediction bound on one more cold boot, and more runs narrow it', () => {
  expect(t90(1)).toBe(3.078);
  expect(t90(5)).toBe(1.476);
  expect(t90(30)).toBe(1.31);
  expect(t90(31)).toBeCloseTo(1.309, 3);
  expect(t90(10_000)).toBeCloseTo(1.2817, 4);
  expect(upperOverRuns([1200 * MB])).toBe(1200 * MB);
  // mean 1,500, sd 100: 1,500 + 1.638 x 100 x sqrt(1.25)
  expect(upperOverRuns([1400, 1500, 1500, 1600].map((x) => x * MB)) / MB).toBeCloseTo(1500 + 1.638 * Math.sqrt(20_000 / 3) * Math.sqrt(1.25), 6);
  // the same spread read with more runs: the highest run never moves, the bound comes down towards mean + 1.28 sd
  const round = [1400, 1550, 1700].map((x) => x * MB);
  const bounds = [1, 2, 4, 8].map((k) => upperOverRuns(Array.from({ length: k }, () => round).flat()));
  for (let i = 1; i < bounds.length; i++) expect(bounds[i]!).toBeLessThan(bounds[i - 1]!);
  expect(bounds[3]! / MB).toBeGreaterThan(1550 + 1.28 * 130);
  // a run that reads far out still moves it: an honest bound is not a trimmed one
  expect(upperOverRuns([...round, 2000 * MB])).toBeGreaterThan(upperOverRuns(round));
});

test('EM11c: the bound stays conservative against the v0.1.36 anchor: over the anchor\'s death-window runs it reads the boot the phone died in over the line', () => {
  const died = anchor.runs.map((windows) => phoneFromWebKit(windows[windows.map((w) => w.step).lastIndexOf('compile:after')]!.peak, model));
  expect(upperOverRuns(died.map((p) => p.high))).toBeGreaterThanOrEqual(model.limitMB * MB);
  // even the runs' central figures, bounded the same way, put that boot over the line
  expect(upperOverRuns(died.map((p) => p.central))).toBeGreaterThanOrEqual(model.limitMB * MB);
});

test('EM11c: zoneOverRuns reads the median run\'s central figure and the bound over every run\'s high', () => {
  const m = { gpuFloorMB: 0, alpha: { low: 0.5, high: 0.5 }, scale: { low: 0.5, high: 0.5 } };
  const run = (wc: number) => ({ settled: { webcontent: wc * MB, gpu: 0 }, checkpoints: [{ peak: { webcontent: (wc + 100) * MB, gpu: 0 } }] });
  const z = zoneOverRuns([run(700), run(800), run(900)], m);
  expect(z.runs).toBe(3);
  expect(z.playing.central / MB).toBeCloseTo(800);
  expect(z.loading.central / MB).toBeCloseTo(900);
  expect(z.playing.upper / MB).toBeCloseTo(800 + 1.886 * 100 * Math.sqrt(4 / 3), 6);
  expect(z.loading.upper - z.playing.upper).toBeCloseTo(100 * MB, 0);
});
