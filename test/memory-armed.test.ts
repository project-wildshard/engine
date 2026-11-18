// oxlint-disable-next-line import/no-nodejs-modules -- Check workflow wiring without starting CI.
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { comparePhoneFootprint, footprintBootFor, guardZone, ledgerZones, parseArmedMemory, phoneFootprint } from '../scripts/memory/armed.mjs';
import { loadPhoneModel } from '../scripts/memory/phoneModel.mjs';
import { compareLedger, ledgerBudget } from '../scripts/memory/ratchet.mjs';

const lines = { playingBytes: 1_000_000_000, loadingBytes: 1_500_000_000 };
const arm = { armed: '2026-11-18', by: 'fixture', playingBytes: 900_000_000, loadingBytes: 1_300_000_000, evidence: 'fixture' };
const policy = parseArmedMemory({ lines, zones: { 'driftwood-isle': arm } });

test('arming comes from zone presence and refuses invalid policy data', () => {
  expect(policy.zones).toEqual(new Set(['driftwood-isle']));
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

// J424 + Coordinator 2026-11-18 (run 44375696856): the Ubuntu ledger blocks an armed zone; the native footprint job
// reports one and never fails main's run.
test('CI keeps the armed ledger blocking and the native footprint job advisory', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const section = (job: string): string => {
    const body = workflow.split(`\n  ${job}:\n`)[1]?.split(/\n {2}[a-z-]+:\n/u)[0];
    if (body === undefined) throw new Error(`Missing CI job ${job}`);
    return body;
  };
  const ledger = section('memory-ledger-guard'), native = section('memory-footprint-guard');
  expect(ledger).toContain('record+=(--record)');
  expect(native).toContain('record+=(--record)');
  expect(ledger).toContain('name: memory-pinned-client');
  expect(native).toContain('name: memory-pinned-client');
  expect(native).toContain('webkit-ledger tmp/memory-ledger/preview');
  expect(ledger).toMatch(/\n {4}runs-on:/u);
  expect(native).toContain('runs-on: xcode-27');
  expect(ledger).not.toMatch(/\n {4}continue-on-error:/u);
  expect(native).toMatch(/\n {4}continue-on-error: true\n/u);
});

test('both native baselines require an online boot', () => {
  for (const mode of ['footprint', 'webkit-ledger']) {
    const baseline = JSON.parse(readFileSync(new URL(`../scripts/memory/${mode}-ratchet.json`, import.meta.url), 'utf8'));
    expect(baseline).toMatchObject({ mode, boot: 'online', instrument: 'minimal' });
  }
});
