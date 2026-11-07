import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual maintained grader without browsers or a Simulator.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Load only the maintained pure policy functions from the CLI.
import { runInNewContext } from 'node:vm';
import { assessDrawBudget, renderCpuUsPerDraw, type DrawSample } from '../src/client/engine/core/drawBudget';
import { drawBudgetCounter } from '../src/client/engine/ui/drawBudgetCounter';
import { validateFrameFloorArgs, frameFloorDrawBudgetMode } from '../scripts/frame-floor-args.mjs';

const phone4 = { tier: 'phone', cpuRate: 4 };
test('inclusive per-frame draw and 4x CPU limits pass exactly at the budget', () => {
  expect(assessDrawBudget([{ draws: 150, renderMs: 4.5 }], 1, phone4))
    .toMatchObject({ pass: true, applied: true, cpuApplied: true, maxDraws: 150, maxRenderCpuUsPerDraw: 30 });
  expect(assessDrawBudget([{ draws: 151, renderMs: 1 }], 1, phone4)).toMatchObject({ pass: false, drawsPass: false });
  expect(assessDrawBudget([{ draws: 150, renderMs: 4.501 }], 1, phone4)).toMatchObject({ pass: false, cpuPass: false });
});

test('keeps paired samples and catches a bad frame hidden by medians or pooled ratios', () => {
  const samples = [{ draws: 150, renderMs: 1 }, { draws: 1, renderMs: .04 }];
  expect(assessDrawBudget(samples, 2, phone4)).toMatchObject({ pass: false, maxRenderCpuUsPerDraw: 40 });
  expect(assessDrawBudget([...Array.from({ length: 119 }, () => samples[0]).filter(row => row !== undefined), { draws: 151, renderMs: 1 }], 120, phone4))
    .toMatchObject({ pass: false, maxDraws: 151 });
});

test('missing coverage, invalid measurements and a zero denominator cannot earn CPU acceptance', () => {
  expect(assessDrawBudget(undefined, 1, phone4).pass).toBe(false);
  expect(assessDrawBudget([], 0, phone4).pass).toBe(false);
  expect(assessDrawBudget([{ draws: 10, renderMs: 1 }], 2, phone4).pass).toBe(false);
  for (const sample of [{ draws: -1, renderMs: 1 }, { draws: 1.5, renderMs: 1 }, { draws: Number.NaN, renderMs: 1 },
    { draws: 1, renderMs: Infinity }, { draws: 1, renderMs: -1 }, { draws: 0, renderMs: 0 }]) {
    expect(renderCpuUsPerDraw(sample)).toBeNull();
    expect(assessDrawBudget([sample], 1, phone4).pass).toBe(false);
  }
});

test('1x phone and desktop readings never pretend to be measured 4x CPU', () => {
  expect(assessDrawBudget([{ draws: 150, renderMs: 10 }], 1, { tier: 'phone', cpuRate: 1 }))
    .toMatchObject({ pass: true, drawsPass: true, cpuPass: null, cpuApplied: false });
  expect(assessDrawBudget([{ draws: 151, renderMs: 1 }], 1, { tier: 'phone', cpuRate: 1 }).pass).toBe(false);
  expect(assessDrawBudget(undefined, 0, { tier: 'desktop', cpuRate: 1 })).toMatchObject({ applied: false, pass: true });
});

test('Developer counter reports actual unscaled cost and the 4x reference without a new setting', () => {
  expect(drawBudgetCounter({ draws: 151, renderMs: 3.02 }, 'phone')).toBe('DRAW BUDGET 151/150 OVER · 20.0 us/draw (unscaled; target 30 at 4x)');
  expect(drawBudgetCounter({ draws: 0, renderMs: 1 }, 'phone')).toContain('n/a us/draw');
  expect(drawBudgetCounter({ draws: 151, renderMs: 1 }, 'desktop')).toContain('phone gate only');
});

test('wrapper-free draw-budget protocol requires exactly 4x phone Chromium and preserves quiet rules', () => {
  const args = ['--surface=desktop', '--chromium-phone', '--chromium-cpu=4', '--draw-budget'];
  expect(() => validateFrameFloorArgs(args)).not.toThrow();
  for (const bad of [args.filter(arg => arg !== '--chromium-cpu=4'), [...args, '--quiet'],
    args.map(arg => arg === '--chromium-cpu=4' ? '--chromium-cpu=2' : arg),
    args.map(arg => arg === '--surface=desktop' ? '--surface=sim' : arg), args.filter(arg => arg !== '--chromium-phone'),
    [...args, '--cpu-profile=tmp/profile'], [...args, '--gl-observer=on'], [...args, '--gl-time']])
    expect(() => validateFrameFloorArgs(bad)).toThrow();
});

interface Graded { pass: boolean; results: { rows: { pass: boolean; rows: { pass: boolean; drawBudget: { cpuApplied: boolean } }[] }[] }[] }
type Grade = (record: unknown) => Graded;
const isGrade = (value: unknown): value is Grade => typeof value === 'function';
function grade(samples: DrawSample[], surface = 'desktop', cpuRate = 4, mode: 'enforce' | 'report-only' = 'enforce', maxMs = 34): Graded {
  const source = readFileSync('scripts/frame-floor.mjs', 'utf8');
  const start = source.indexOf('function assess('), end = source.indexOf('\nfunction printVerdict(', start);
  const loaded: unknown = runInNewContext(`${source.slice(start, end)};grade`, { chromiumPhone: false, chromiumCpuRate: 1, softwareCensus: null, assessDrawBudget });
  if (!isGrade(loaded)) throw new Error('Missing real frame-floor grader');
  return loaded({ underTenMinutes: true, chromiumCpuRate: cpuRate, drawBudgetMode: mode, settings: { tier: 'phone' }, results: [{ surface,
    rows: [{ complete: true, errors: [], metadata: { settings: { tier: 'phone' } }, rows: [{ frames: samples.length, skipped: 0, contextLost: false,
      maxMs, medianFps: 30, p95Ms: 34, workP95Ms: 5, drawSamples: samples,
      cpu: { enabled: true, frames: samples.length, owners: [{ p95Ms: 1 }] } }] }] }] });
}
test('real frame-floor rows and aggregate verdict fail above budget even when cadence passes', () => {
  expect(grade([{ draws: 150, renderMs: 4.5 }]).pass).toBe(true);
  expect(grade([{ draws: 151, renderMs: 1 }]).pass).toBe(false);
  expect(grade([{ draws: 150, renderMs: 4.501 }]).pass).toBe(false);
  expect(grade([{ draws: 150, renderMs: 10 }], 'sim').results[0]?.rows[0]?.rows[0]?.drawBudget.cpuApplied).toBe(false);
});


test('report-only budget retains misses while all original floor gates remain blocking', () => {
  const over = [{ draws: 151, renderMs: 5 }];
  expect(grade(over).pass).toBe(false);
  const reported = grade(over, 'desktop', 4, 'report-only');
  expect(reported.pass).toBe(true);
  expect(reported.results[0]?.rows[0]?.rows[0]?.drawBudget).toMatchObject({ pass: false, drawsPass: false, cpuPass: false, samples: 1 });
  expect(grade(over, 'desktop', 4, 'report-only', 201).pass).toBe(false);
  expect(grade(over, 'desktop', 4, 'enforce').pass).toBe(false);
});

test('report-only protocol is explicit, wrapper-free 4x and cannot silently replace enforcement', () => {
  const args = ['--surface=desktop', '--chromium-phone', '--chromium-cpu=4', '--draw-budget-report-only'];
  expect(frameFloorDrawBudgetMode(args)).toBe('report-only');
  expect(frameFloorDrawBudgetMode([])).toBe('enforce');
  expect(() => validateFrameFloorArgs(args)).not.toThrow();
  for (const bad of [[...args, '--draw-budget'], [...args, '--quiet'], [...args, '--gl-time'], [...args, '--gl-observer=on'],
    args.map(value => value === '--chromium-cpu=4' ? '--chromium-cpu=1' : value), args.filter(value => value !== '--chromium-phone')])
    expect(() => validateFrameFloorArgs(bad)).toThrow();
});


test('pooled mean uses every paired draw without weakening the worst-frame gate', () => {
  const samples = [{ draws: 150, renderMs: 1 }, { draws: 1, renderMs: .04 }];
  const result = assessDrawBudget(samples, 2, phone4);
  expect(result.meanRenderCpuUsPerDraw).toBeCloseTo(1040 / 151);
  expect(result.meanRenderCpuUsPerDraw).not.toBeCloseTo((1000 / 150 + 40) / 2);
  expect(result).toMatchObject({ maxRenderCpuUsPerDraw: 40, cpuPass: false, pass: false });
});

test('missing or invalid paired coverage earns no mean and no clock extrapolation', () => {
  for (const samples of [undefined, [], [{ draws: 1, renderMs: 1 }], [{ draws: 0, renderMs: 0 }, { draws: 10, renderMs: 1 }],
    [{ draws: 10, renderMs: Infinity }, { draws: 10, renderMs: 1 }]]) {
    expect(assessDrawBudget(samples, 2, phone4).meanRenderCpuUsPerDraw).toBeNull();
  }
  const unscaled = assessDrawBudget([{ draws: 100, renderMs: 1 }], 1, { tier: 'phone', cpuRate: 1 });
  expect(unscaled).toMatchObject({ meanRenderCpuUsPerDraw: 10, cpuApplied: false, cpuPass: null });
});
