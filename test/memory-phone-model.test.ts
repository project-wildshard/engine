// ENGINE-MEMORY EM11: the phone chain that replaced "Chromium renderer x 2.0". The one phone anchor is staging v0.1.36
// with Nine rev 2, which Jake's iPhone 17 Pro killed right after the boot trace's last `compile:after` (mini QA 19).
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { CRASH_LINE } from '../src/client/game/grid/budgetOverlay';
import { anchorBounds, ledgerSplit, loadPhoneModel, phoneFromChromium, phoneFromLedger, phoneFromWebKit, phonePeakFromWebKit, rangeText } from '../scripts/memory/phoneModel.mjs';
import { fitPhoneModel, lineFit } from '../scripts/memory/phone-fit.mjs';
import { traceToControl } from '../scripts/memory/measure.mjs';

const MB = 1e6;
interface Window { step: string; peak: { webcontent: number; gpu: number } }
const anchor = JSON.parse(readFileSync(new URL('fixtures/memory/phone-anchor-v0136-nine.json', import.meta.url), 'utf8')) as { runs: Window[][] };
const model = loadPhoneModel() as { limitMB: number; limitHighMB: number; gpuFloorMB: number; alpha: { low: number; high: number }; scale: { low: number; high: number };
  chromium: { loadingPerRenderer: { low: number; central: number; high: number } }; zones: Record<string, { phoneLoadingMB: { low: number; central: number; high: number }; phonePlayingMB: { central: number } }> };

test('the limit is the chip\'s crash line, and the published 2,147 MB is the high end', () => {
  expect(model.limitMB * MB).toBe(CRASH_LINE);
  expect(model.limitHighMB).toBe(2147);
});

test('v0.1.36 Nine, the boot the phone died in: the chain puts its last compile:after window at or over the line, and every window before it under the higher line', () => {
  for (const windows of anchor.runs) {
    const at = windows.map((w) => w.step).lastIndexOf('compile:after');
    const died = phoneFromWebKit(windows[at]!.peak, model);
    expect(died.central).toBeGreaterThanOrEqual(CRASH_LINE);
    expect(died.high).toBeGreaterThanOrEqual(CRASH_LINE);
    for (const lived of windows.slice(0, at)) expect(phoneFromWebKit(lived.peak, model).central).toBeLessThan(model.limitHighMB * MB);
  }
  // the committed range is the runs' median bounds, so it holds for the median run at least at its low end
  const lows = anchor.runs.map((windows) => phoneFromWebKit(windows[windows.map((w) => w.step).lastIndexOf('compile:after')]!.peak, model).low).sort((a, b) => a - b);
  expect(lows[1]).toBeGreaterThanOrEqual(CRASH_LINE * 0.99);
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
});

test('Template, Dunes, Pine and Nine each carry a prediction with its error bar', () => {
  for (const zone of ['_template', 'sunscar-dunes', 'pine-hollow', 'nine-dragon-stack']) {
    const row = model.zones[zone]!;
    expect(row.phoneLoadingMB.low).toBeLessThanOrEqual(row.phoneLoadingMB.central);
    expect(row.phoneLoadingMB.central).toBeLessThanOrEqual(row.phoneLoadingMB.high);
  }
  // Nine on today's main still crosses the line on the phone at its loading peak
  expect(model.zones['nine-dragon-stack']!.phoneLoadingMB.central).toBeGreaterThan(model.limitMB);
  expect(model.chromium.loadingPerRenderer.low).toBeLessThan(model.chromium.loadingPerRenderer.high);
});
