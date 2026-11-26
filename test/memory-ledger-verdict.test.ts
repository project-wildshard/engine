// oxlint-disable-next-line import/no-nodejs-modules -- The replay reads the committed subsystem ledger; BC7 writes a summary.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- BC7's summary fixture sits in the OS temp folder and is removed.
import { tmpdir } from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { readBaselines, readCaps } from '../src/scripts/budgets/files.mjs';
import { checkLedger, judgeLedger, ledgerFailure, ledgerMeasures, ledgerTotal, reportLedger, zoneContentKey } from '../src/scripts/memory/ledgerVerdict.mjs';

// BUDGET-CAPS BC6 (J444): the ledger is judged on a zone's control and peak totals, not 18 subsystem numbers.
type Phases = Record<'control' | 'peak', Record<string, number>>;
const ledger = JSON.parse(readFileSync('src/scripts/memory/ledger-ratchet.json', 'utf8')) as { zones: Record<string, Phases> };
/** A committed zone's ledger as one flat reading (`<phase>.<subsystem>` bytes). */
function flat(zone: string): Record<string, number> {
  const phases = ledger.zones[zone];
  if (phases === undefined) throw new Error(`no committed ledger for ${zone}`);
  return Object.fromEntries(Object.entries(phases).flatMap(([phase, bytes]) => Object.entries(bytes).map(([kind, value]) => [`${phase}.${kind}`, value])));
}
const at = (reading: Record<string, number>, metric: string): number => reading[metric] ?? Number.NaN;
const repeat = (reading: Record<string, number>) => (count: number): Promise<Record<string, number>[]> => Promise.resolve(Array.from({ length: count }, () => reading));
const caps = readCaps();
/** The two totals of a committed zone as its baselines, at one content key. */
function budgetsFor(zone: string, contentKey = `${zone}@1`) {
  const reading = flat(zone);
  return { caps, baselines: { schema: 1, about: '', baselines: Object.fromEntries((['control', 'peak'] as const).map(phase =>
    [`ledger/${zone}/${phase}`, { value: ledgerTotal(reading, phase), contentKey }])) } };
}

test.each([
  ['nalati-grasslands', 'control.workers', 328_479],
  ['driftwood-isle', 'peak.audio', 2_515_875],
  ['brasscap-mesa', 'peak.loading', 298_280],
])('QA 2026-11-18 rows 61-63: %s %s +%i B is ok on all three reads, with no output line', async (zone, metric, rise) => {
  const reading = flat(zone);
  const grown = { ...reading, [metric]: at(reading, metric) + rise };
  const log = vi.spyOn(console, 'log'), warn = vi.spyOn(console, 'warn'), info = vi.spyOn(console, 'info');
  const remeasure = vi.fn(repeat(grown));
  const { rows } = await checkLedger({ mode: 'ledger', zone, first: grown, remeasure, contentKey: `${zone}@1`, budgets: budgetsFor(zone) });
  expect(rows.map(row => row.status)).toEqual(['ok', 'ok']);
  expect(remeasure).not.toHaveBeenCalled();
  expect(ledgerFailure(rows)).toBeNull();
  expect([...log.mock.calls, ...warn.mock.calls, ...info.mock.calls]).toEqual([]);
});

test('a zone 12% over on all three reads is regressed, confirmed by the median of three', async () => {
  const zone = 'pine-hollow', reading = flat(zone);
  const grown = Object.fromEntries(Object.entries(reading).map(([metric, bytes]) => [metric, Math.round(bytes * 1.12)]));
  const remeasure = vi.fn(repeat(grown));
  const { rows } = await checkLedger({ mode: 'ledger', zone, first: grown, remeasure, contentKey: `${zone}@1`, budgets: budgetsFor(zone) });
  expect(remeasure).toHaveBeenCalledWith(3);
  expect(rows.map(row => row.status)).toEqual(['regressed', 'regressed']);
  expect(ledgerFailure(rows)).toContain('ledger/pine-hollow/control regressed (median of 3)');
});

test('one spiked read that three fresh reads do not confirm is ok', async () => {
  const zone = 'pine-hollow', reading = flat(zone);
  const spike = { ...reading, 'control.loading': at(reading, 'control.loading') + 80_000_000 };
  const { rows } = await checkLedger({ mode: 'ledger', zone, first: spike, remeasure: repeat(reading),
    contentKey: `${zone}@1`, budgets: budgetsFor(zone) });
  expect(rows.map(row => row.status)).toEqual(['ok', 'ok']);
});

test('a new pinned revision is new content: raised, never regressed', () => {
  const zone = 'driftwood-isle', reading = flat(zone);
  const grown = Object.fromEntries(Object.entries(reading).map(([metric, bytes]) => [metric, bytes * 2]));
  const rows = judgeLedger({ mode: 'ledger', zone, reads: [grown], contentKey: `${zone}@2`, budgets: budgetsFor(zone) });
  expect(rows.map(row => row.status)).toEqual(['raised', 'raised']);
});

test('the subsystems stay in the measures for the table, the totals are what is judged', () => {
  const zone = 'brasscap-mesa', reading = flat(zone);
  const rows = judgeLedger({ mode: 'ledger', zone, reads: [reading, reading, reading], contentKey: `${zone}@1`, budgets: budgetsFor(zone) });
  const measures = ledgerMeasures(rows);
  expect(measures['ledger/brasscap-mesa/peak']?.reads).toHaveLength(3);
  expect(measures['ledger/brasscap-mesa/peak']?.detail?.['loading']).toBe(ledger.zones[zone]?.peak['loading']);
  expect(zoneContentKey('brasscap-mesa', { 'brasscap-mesa': 'brasscap-mesa@9' })).toBe('brasscap-mesa@9');
  expect(zoneContentKey('nowhere', {})).toBe('engine');
});

test('every committed ledger zone has both totals recorded in budgets/baselines.json', () => {
  const baselines = readBaselines().baselines;
  for (const zone of Object.keys(ledger.zones)) for (const phase of ['control', 'peak']) expect(baselines[`ledger/${zone}/${phase}`], `${zone} ${phase}`).toBeDefined();
});

test('BC7: a ledger run prints one table and appends one table to the job summary, with no ::warning', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ledger-report-'));
  try {
    const zone = 'driftwood-isle', reading = flat(zone);
    const grown = { ...reading, 'peak.audio': at(reading, 'peak.audio') + 2_515_875 };
    const rows = judgeLedger({ mode: 'ledger', zone, reads: [grown], contentKey: `${zone}@1`, budgets: budgetsFor(zone) });
    const lines: string[] = [], summaryFile = join(directory, 'summary.md');
    reportLedger({ rows, mode: 'ledger', directory, commit: 'abc', summaryFile, log: line => { lines.push(line); } });
    expect(lines).toHaveLength(1);
    expect(lines.join('\n')).not.toContain('::warning');
    const summary = readFileSync(summaryFile, 'utf8');
    expect(summary.match(/^\| Budget \|/gmu)).toHaveLength(1);
    expect(summary).toContain('| ledger/driftwood-isle/peak | ok |');
    const written = JSON.parse(readFileSync(join(directory, 'budget-measures.json'), 'utf8')) as { measures: Record<string, { reads: number[] }> };
    expect(written.measures['ledger/driftwood-isle/peak']?.reads).toHaveLength(1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
  expect(readFileSync('src/scripts/memory/ci.mjs', 'utf8')).not.toContain('::warning');
});
