// oxlint-disable-next-line import/no-nodejs-modules -- Check workflow wiring without starting CI.
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { comparePhoneFootprint, footprintBaseline, footprintBootFor, guardZone, ledgerZones, parseArmedMemory, phoneFootprint } from '../scripts/memory/armed.mjs';
import { checkMemory, ratchetMargin } from '../scripts/memory/gate.mjs';
import { loadPhoneModel } from '../scripts/memory/phoneModel.mjs';
import { compareLedger, ledgerBudget } from '../scripts/memory/ratchet.mjs';

const lines = { playingBytes: 1_000_000_000, loadingBytes: 1_500_000_000 };
const arm = { armed: '2026-11-18', by: 'fixture', playingBytes: 900_000_000, loadingBytes: 1_300_000_000, evidence: 'fixture' };
const policy = parseArmedMemory({ lines, zones: { 'driftwood-isle': arm } });

test('arming comes from zone presence and refuses invalid policy data', () => {
  expect(policy.zones).toEqual(new Set(['driftwood-isle']));
  expect(policy.readings.get('driftwood-isle')).toEqual({ playingBytes: 900_000_000, loadingBytes: 1_300_000_000 });
  expect(parseArmedMemory({ lines, zones: { 'driftwood-isle': { ...arm, playingBytes: 1_010_000_000 } } }).zones.has('driftwood-isle')).toBe(true);
  expect(parseArmedMemory({ lines, zones: {} }).zones.size).toBe(0);
  expect(() => parseArmedMemory({ zones: {} })).toThrow('Invalid armed memory list');
  expect(() => parseArmedMemory({ lines, zones: { 'driftwood-isle': { ...arm, loadingBytes: 0 } } }))
    .toThrow('Invalid armed memory entry');
});

test('a partial recording always includes every named zone assigned to its ledger host', () => {
  const armed = new Set([...policy.zones, 'nalati-grasslands', 'nine-dragon-stack']);
  expect(ledgerZones(['_template', 'driftwood-isle', 'nalati-grasslands', 'pine-hollow'], armed, ['_template']))
    .toEqual(['_template', 'driftwood-isle', 'nalati-grasslands']);
  expect(() => ledgerZones(['_template', 'pine-hollow'], armed, ['_template']))
    .toThrow('No ledger preview for driftwood-isle');
});

test('an armed pin outside the world uses its supported standalone boot', () => {
  const armed = new Set(['driftwood-isle', 'open-plot-thin-ice']);
  const placed = new Set(['driftwood-isle', 'pine-hollow']);
  expect(footprintBootFor('driftwood-isle', armed, placed)).toBe('online');
  expect(footprintBootFor('open-plot-thin-ice', armed, placed)).toBe('standalone');
  expect(footprintBootFor('pine-hollow', armed, placed)).toBe('standalone');
});

test('the same subsystem breach fails only an armed zone', async () => {
  const reading = ledgerBudget([{ step: 'control', ledger: { ram: { 'array-buffer': 1000 } } }]);
  const regression = ledgerBudget([{ step: 'control', ledger: { ram: { 'array-buffer': 1021 } } }]);
  const compare = (): Promise<void> => {
    compareLedger(reading, [regression], 'driftwood-isle');
    return Promise.resolve();
  };
  const report = vi.fn<(line: string) => void>();
  await expect(guardZone('pine-hollow', policy.zones, compare, report)).resolves.toBeUndefined();
  expect(report).toHaveBeenCalledWith(expect.stringContaining('control loading: 1021 B > 1020 B'));
  await expect(guardZone('driftwood-isle', policy.zones, compare, report)).rejects.toThrow('Armed memory gate for driftwood-isle');
  await expect(guardZone('driftwood-isle', policy.zones, () => Promise.reject(new Error('no reading')), report)).rejects.toThrow('no reading');
});

test('an armed zone must finish a comparable native boot and stay within both lines', async () => {
  const model = loadPhoneModel();
  const good = { host: 'webkit', boot: 'online', instrument: model.instrument, ready: true, refused: null,
    settled: { webcontent: 500_000_000, gpu: 200_000_000 },
    checkpoints: [{ step: 'control', peak: { webcontent: 700_000_000, gpu: 220_000_000 } }] };
  expect(phoneFootprint('driftwood-isle', [good], model, 'online').playing).toBeLessThan(lines.playingBytes);
  expect(() => phoneFootprint('driftwood-isle', [{ ...good, boot: 'standalone' }], model, 'online')).toThrow('missing comparable');
  expect(() => phoneFootprint('driftwood-isle', [{ ...good, ready: false }], model, 'online')).toThrow('missing comparable');
  expect(() => phoneFootprint('driftwood-isle', [{ ...good, instrument: 'full' }], model, 'online')).toThrow('missing comparable');
  const report = vi.fn<(line: string) => void>();
  for (const over of [{ playing: lines.playingBytes + 1, loading: 1 }, { playing: 1, loading: lines.loadingBytes + 1 }]) {
    const compare = (): Promise<void> => {
      comparePhoneFootprint(over, lines);
      return Promise.resolve();
    };
    await expect(guardZone('nine-dragon-stack', policy.zones, compare, report)).resolves.toBeUndefined();
    await expect(guardZone('driftwood-isle', policy.zones, compare, report)).rejects.toThrow('EM11 upper playing');
  }
});

test('J431 uses the larger of 2% and 5 MB over an armed reading', async () => {
  const brasscap = 46_478_228;
  const metrics = { 'peak.loading': { baseline: brasscap, previousMargin: Math.floor(brasscap * 0.02) } };
  const remeasure = vi.fn(async () => [{ 'peak.loading': 52_000_000 }, { 'peak.loading': 51_800_000 }, { 'peak.loading': 47_000_000 }]);
  const warn = vi.fn();
  expect(ratchetMargin(brasscap)).toBe(5_000_000);
  expect(ratchetMargin(900_000_000)).toBe(18_000_000);
  await expect(checkMemory({ zone: 'brasscap-mesa', metrics, first: { 'peak.loading': 47_712_804 }, remeasure, warn }))
    .resolves.toEqual({ 'peak.loading': brasscap });
  expect(warn).toHaveBeenCalledWith(expect.objectContaining({ kind: 'margin', metric: 'peak.loading', limit: 47_407_792 }));
  expect(remeasure).not.toHaveBeenCalled();
  await expect(checkMemory({ zone: 'brasscap-mesa', metrics, first: { 'peak.loading': 52_100_000 }, remeasure, warn }))
    .rejects.toThrow('peak.loading (ratchet, median of 3): 51800000 B > 51478228 B');
  expect(remeasure).toHaveBeenCalledExactlyOnceWith(3);
});

test('both absolute phone lines use three fresh boots when a first reading crosses', async () => {
  const nearLine = { playing: 999_000_000, loading: 1_499_000_000 };
  const over = { playing: lines.playingBytes + 10, loading: lines.loadingBytes + 20 };
  const aboveLineBaseline = { playing: { absolute: lines.playingBytes, baseline: 1_023_500_000 },
    loading: { absolute: lines.loadingBytes, baseline: 1_510_000_000 } };
  const once = vi.fn(async () => [nearLine, over, nearLine]);
  const warn = vi.fn();
  await expect(checkMemory({ zone: 'driftwood-isle', metrics: aboveLineBaseline, first: over, remeasure: once, warn }))
    .resolves.toEqual({ playing: 1_023_500_000, loading: 1_510_000_000 });
  expect(once).toHaveBeenCalledExactlyOnceWith(3);
  expect(warn).toHaveBeenCalledTimes(2);
  expect(warn).toHaveBeenCalledWith(expect.objectContaining({ kind: 'gate-flake', arm: 'absolute', metric: 'playing', median: nearLine.playing }));
  expect(warn).toHaveBeenCalledWith(expect.objectContaining({ kind: 'gate-flake', arm: 'absolute', metric: 'loading', median: nearLine.loading }));
  const confirm = vi.fn(async () => [over, nearLine, over]);
  await expect(checkMemory({ zone: 'driftwood-isle', metrics: aboveLineBaseline, first: over, remeasure: confirm, warn }))
    .rejects.toThrow(/playing \(absolute, median of 3\)[^]*loading \(absolute, median of 3\)/u);
  expect(confirm).toHaveBeenCalledExactlyOnceWith(3);
});

test('a ratchet advances only after three clean boots, to their median', async () => {
  const metrics = { playing: { baseline: 100_000_000 } }, first = { playing: 70_000_000 };
  const warn = vi.fn();
  const remeasure = vi.fn(async () => [{ playing: 92_000_000 }, { playing: 97_000_000 }]);
  const check = { zone: 'driftwood-isle', metrics, first, remeasure, warn };
  expect(await checkMemory(check)).toEqual({ playing: 100_000_000 });
  expect(remeasure).not.toHaveBeenCalled();
  expect(await checkMemory({ ...check, record: true })).toEqual({ playing: 92_000_000 });
  expect(remeasure).toHaveBeenCalledExactlyOnceWith(2);
  const noisy = vi.fn(async (count: number) => count === 2
    ? [{ playing: 106_000_000 }, { playing: 95_000_000 }]
    : [{ playing: 91_000_000 }, { playing: 92_000_000 }, { playing: 93_000_000 }]);
  expect(await checkMemory({ ...check, record: true, remeasure: noisy })).toEqual({ playing: 100_000_000 });
  expect(noisy.mock.calls).toEqual([[2], [3]]);
  expect(warn).toHaveBeenCalledWith(expect.objectContaining({ kind: 'gate-flake', arm: 'ratchet', metric: 'playing', median: 92_000_000 }));
});

test('a native recording becomes the next ratchet without arming a zone or raising a reading', async () => {
  const zone = 'driftwood-isle';
  const armed = policy.readings.get(zone);
  expect(footprintBaseline(policy.readings, undefined, zone)).toEqual(armed);
  const first = { playing: 905_000_000, loading: 1_210_000_000 };
  const remeasure = vi.fn(async () => [
    { playing: 906_000_000, loading: 1_230_000_000 },
    { playing: 907_000_000, loading: 1_220_000_000 },
  ]);
  const next = await checkMemory({ zone, first, remeasure, warn: vi.fn(), record: true, metrics: {
    playing: { absolute: lines.playingBytes, baseline: arm.playingBytes },
    loading: { absolute: lines.loadingBytes, baseline: arm.loadingBytes },
  } });
  expect(next).toEqual({ playing: 900_000_000, loading: 1_220_000_000 });
  const { playing, loading } = next;
  const saved = { [zone]: { playingBytes: playing, loadingBytes: loading } };
  expect(footprintBaseline(policy.readings, saved, zone)).toEqual(saved[zone]);
  expect(footprintBaseline(policy.readings, { [zone]: { ...saved[zone], playingBytes: 907_000_000 } }, zone)).toEqual(saved[zone]);
  expect(footprintBaseline(policy.readings, { template: saved[zone] }, 'template')).toBeUndefined();
  expect(() => footprintBaseline(policy.readings, { [zone]: { loadingBytes: 0 } }, zone)).toThrow('Invalid committed native footprint');
});

test('CI runs both armed measurement jobs without a job-level bypass, the native one in its own workflow', () => {
  const read = (file: string): string => readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8');
  const section = (workflow: string, job: string): string => {
    const body = workflow.split(`\n  ${job}:\n`)[1]?.split(/\n {2}[a-z-]+:\n/u)[0];
    if (body === undefined) throw new Error(`Missing CI job ${job}`);
    return body;
  };
  const ci = read('ci.yml'), footprint = read('memory-footprint.yml');
  const ledger = section(ci, 'memory-ledger-guard'), native = section(footprint, 'memory-footprint-guard');
  // ci's verdict never waits on the xcode-27 runner (44392712273); the footprint run follows ci and reads its client.
  expect(ci).not.toMatch(/\n {2}memory-footprint-guard:\n/u);
  expect(footprint).toMatch(/workflow_run:\n {4}workflows: \[ci\]/u);
  expect(native).toContain('run-id: ${{ env.SOURCE_RUN }}');
  expect(ledger).toContain('record+=(--record)');
  expect(native).toContain('record+=(--record)');
  expect(ledger).toContain('name: memory-pinned-client');
  expect(native).toContain('name: memory-pinned-client');
  expect(native).toContain('webkit-ledger tmp/memory-ledger/preview');
  expect(ledger).toMatch(/\n {4}runs-on:/u);
  expect(native).toContain('runs-on: xcode-27');
  expect(ledger).not.toMatch(/\n {4}continue-on-error:/u);
  expect(native).not.toContain('continue-on-error');
});

test('both native baselines require an online boot', () => {
  for (const mode of ['footprint', 'webkit-ledger']) {
    const baseline = JSON.parse(readFileSync(new URL(`../scripts/memory/${mode}-ratchet.json`, import.meta.url), 'utf8'));
    expect(baseline).toMatchObject({ mode, boot: 'online', instrument: 'minimal' });
  }
});
