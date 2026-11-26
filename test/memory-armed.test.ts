// oxlint-disable-next-line import/no-nodejs-modules -- Check workflow wiring without starting CI.
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { armedMemory, comparePhoneFootprint, footprintBootFor, footprintLines, guardZone, judgeFootprint, ledgerZones, parseArmedMemory, phoneFootprint } from '../src/scripts/memory/armed.mjs';
import { readCaps } from '../src/scripts/budgets/files.mjs';
import { checkReads, ledgerFailure } from '../src/scripts/memory/ledgerVerdict.mjs';
import { loadPhoneModel } from '../src/scripts/memory/phoneModel.mjs';
import { compareLedger, ledgerBudget } from '../src/scripts/memory/ratchet.mjs';

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

test('release memory gates measure all shipped armed products and retain historical readings', () => {
  const pins = JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as {shards: {slug: string}[]};
  const shipped = new Set(pins.shards.map(pin => pin.slug));
  const release = armedMemory();
  expect(release.zones).toEqual(new Set([...release.readings.keys()].filter(zone => shipped.has(zone))));
});

test('a partial recording always includes every named zone assigned to its ledger host', () => {
  const armed = new Set([...policy.zones, 'nalati-grasslands', 'nine-dragon-stack']);
  expect(ledgerZones(['brasscap-mesa', 'driftwood-isle', 'nalati-grasslands', 'pine-hollow'], armed, ['brasscap-mesa']))
    .toEqual(['brasscap-mesa', 'driftwood-isle', 'nalati-grasslands']);
  expect(() => ledgerZones(['brasscap-mesa', 'pine-hollow'], armed, ['brasscap-mesa']))
    .toThrow('No ledger preview for driftwood-isle');
});

test('an armed pin outside the world uses its supported standalone boot', () => {
  const armed = new Set(['driftwood-isle', 'open-plot-thin-ice']);
  const placed = new Set(['driftwood-isle', 'pine-hollow']);
  expect(footprintBootFor('driftwood-isle', armed, placed)).toBe('online');
  expect(footprintBootFor('open-plot-thin-ice', armed, placed)).toBe('standalone');
  expect(footprintBootFor('pine-hollow', armed, placed)).toBe('standalone');
});

test('the same ledger regression fails only an armed zone', async () => {
  const reading = ledgerBudget([{ step: 'control', ledger: { ram: { 'array-buffer': 100_000_000 } } }]);
  const regression = ledgerBudget([{ step: 'control', ledger: { ram: { 'array-buffer': 120_000_000 } } }]);
  const compare = (): Promise<void> => {
    compareLedger(reading, [regression], 'driftwood-isle');
    return Promise.resolve();
  };
  const report = vi.fn<(line: string) => void>();
  await expect(guardZone('pine-hollow', policy.zones, compare, report)).resolves.toBeUndefined();
  expect(report).toHaveBeenCalledWith(expect.stringContaining('control total: 120000000 B > 110000000 B'));
  await expect(guardZone('driftwood-isle', policy.zones, compare, report)).rejects.toThrow('Armed memory gate for driftwood-isle');
  await expect(guardZone('driftwood-isle', policy.zones, () => Promise.reject(new Error('no reading')), report)).rejects.toThrow('no reading');
});

test('J445: past the 1.0 GB playing target reports, past the 1.5 GB loading line refuses', async () => {
  const model = loadPhoneModel();
  const good = { host: 'webkit', boot: 'online', instrument: model.instrument, ready: true, refused: null,
    settled: { webcontent: 500_000_000, gpu: 200_000_000 },
    checkpoints: [{ step: 'control', peak: { webcontent: 700_000_000, gpu: 220_000_000 } }] };
  expect(phoneFootprint('driftwood-isle', [good], model, 'online').playing).toBeLessThan(lines.playingBytes);
  expect(() => phoneFootprint('driftwood-isle', [{ ...good, boot: 'standalone' }], model, 'online')).toThrow('missing comparable');
  expect(() => phoneFootprint('driftwood-isle', [{ ...good, ready: false }], model, 'online')).toThrow('missing comparable');
  expect(() => phoneFootprint('driftwood-isle', [{ ...good, instrument: 'full' }], model, 'online')).toThrow('missing comparable');
  // the lines come from budgets/caps.json: memory/playing/* is J445's target, memory/loading/* the one refusal
  expect(footprintLines(readCaps())).toEqual(lines);
  expect(comparePhoneFootprint({ playing: lines.playingBytes, loading: 1 }, lines)).toBeNull();
  expect(comparePhoneFootprint({ playing: lines.playingBytes + 1, loading: 1 }, lines)).toMatch(/past the 1000000000 B playing target \(J445/u);
  const report = vi.fn<(line: string) => void>();
  const loading = (): Promise<void> => {
    comparePhoneFootprint({ playing: 1, loading: lines.loadingBytes + 1 }, lines);
    return Promise.resolve();
  };
  await expect(guardZone('nine-dragon-stack', policy.zones, loading, report)).resolves.toBeUndefined();
  await expect(guardZone('driftwood-isle', policy.zones, loading, report)).rejects.toThrow('EM11 upper loading');
});

// BUDGET-CAPS BC11 (J445): an armed zone's EM11 footprint goes through the verdict. Its baseline is the zone's own
// reading on its pinned revision; a new revision moves the line (raised), the same one past +10% is a fix row.
const budgets = (playing: number, loading: number, contentKey = 'far-reach@4') => ({ caps: readCaps(), baselines: { schema: 1, about: '', baselines: {
  'memory/playing/far-reach': { value: playing, contentKey }, 'memory/loading/far-reach': { value: loading, contentKey } } } });
const status = (rows: ReturnType<typeof judgeFootprint>) => Object.fromEntries(rows.map(row => [row.key, row.status]));

test('J445: Sky Reach at 1,027 MB playing ships past the target; a new revision moves its own line', () => {
  const armed = budgets(999_952_196, 1_415_754_105);
  const sky = { playing: 1_027_117_876, loading: 1_370_876_896 };
  const same = judgeFootprint({ zone: 'far-reach', reads: [sky], contentKey: 'far-reach@4', budgets: armed });
  expect(status(same)).toEqual({ 'memory/playing/far-reach': 'ok', 'memory/loading/far-reach': 'ok' });
  expect(same[0]).toMatchObject({ target: 1_000_000_000, value: sky.playing, reads: [sky.playing] });
  expect(ledgerFailure(same)).toBeNull();
  const next = judgeFootprint({ zone: 'far-reach', reads: [{ playing: 1_300_000_000, loading: 1_490_000_000 }], contentKey: 'far-reach@5', budgets: armed });
  expect(status(next)).toEqual({ 'memory/playing/far-reach': 'raised', 'memory/loading/far-reach': 'raised' });
  const over = judgeFootprint({ zone: 'far-reach', reads: [{ playing: 1_300_000_000, loading: 1_500_000_001 }], contentKey: 'far-reach@5', budgets: armed });
  expect(status(over)['memory/loading/far-reach']).toBe('over-hard');
  expect(ledgerFailure(over)).toMatch(/memory\/loading\/far-reach over-hard/u);
});

test('an engine regression of 12% on the same revision is confirmed by three fresh reads, never on one', async () => {
  const armed = budgets(900_000_000, 1_200_000_000), contentKey = 'far-reach@4';
  const judge = (reads: readonly { playing: number, loading: number }[]) => judgeFootprint({ zone: 'far-reach', reads, contentKey, budgets: armed });
  const spike = { playing: 1_008_000_000, loading: 1_210_000_000 }, calm = { playing: 905_000_000, loading: 1_205_000_000 };
  const flake = vi.fn(async () => [calm, spike, calm]);
  const once = await checkReads({ first: spike, remeasure: flake, judge });
  expect(flake).toHaveBeenCalledExactlyOnceWith(3);
  expect(ledgerFailure(once.rows)).toBeNull();
  const leak = vi.fn(async () => [spike, calm, spike]);
  const confirmed = await checkReads({ first: spike, remeasure: leak, judge });
  expect(status(confirmed.rows)['memory/playing/far-reach']).toBe('regressed');
  expect(ledgerFailure(confirmed.rows)).toMatch(/memory\/playing\/far-reach regressed \(median of 3\): 1008000000 B/u);
  const quiet = vi.fn(async () => [calm, calm]);
  expect((await checkReads({ first: calm, remeasure: quiet, judge })).reads).toEqual([calm]);
  expect(quiet).not.toHaveBeenCalled();
  expect((await checkReads({ first: calm, remeasure: quiet, judge, record: true })).reads).toEqual([calm, calm, calm]);
  expect(quiet).toHaveBeenCalledExactlyOnceWith(2);
});

test('CI runs both armed measurement jobs without a job-level bypass, the native one in its own workflow', () => {
  const read = (file: string): string => readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8');
  const section = (workflow: string, job: string): string => {
    const body = workflow.split(`\n  ${job}:\n`)[1]?.split(/\n {2}[a-z-]+:\n/u)[0];
    if (body === undefined) throw new Error(`Missing CI job ${job}`);
    return body;
  };
  const ci = read('ci.yml'), footprint = read('memory-footprint.yml');
  // BUDGET-CAPS BC9: the ledger runs in budgets.yml after ci; ci's verdict waits on neither measurement.
  const ledger = section(read('budgets.yml'), 'budgets'), native = section(footprint, 'memory-footprint-guard');
  expect(ci).not.toMatch(/\n {2}memory-ledger-guard:\n/u);
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
  expect(ledger).toContain('node src/scripts/budgets/cli.mjs check tmp/budgets/measures.json');
  expect(native).not.toContain('continue-on-error');
  // BC11: the native footprint, Nine's ledger and its walk leave their measures in a `budgets` artifact (record --run),
  // and Nine's boot measures from ci's nine-ring1 load are judged in the budgets job.
  expect(native).toContain('name: budgets');
  expect(ledger).toContain('name: nine-ring1-load');
});

test('both native baselines require an online boot', () => {
  for (const mode of ['footprint', 'webkit-ledger']) {
    const baseline = JSON.parse(readFileSync(new URL(`../src/scripts/memory/${mode}-ratchet.json`, import.meta.url), 'utf8'));
    expect(baseline).toMatchObject({ mode, boot: 'online', instrument: 'minimal' });
  }
});
