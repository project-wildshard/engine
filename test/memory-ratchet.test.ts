// oxlint-disable-next-line import/no-nodejs-modules -- the test reads the committed baselines and ci.yml.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { blockingRun } from '../scripts/main-watch.mjs';
import { compareFootprint, compareLedger, confirmFootprint, footprintOverLine, confirmLedger, confirmZone, footprintBudget, ledgerOverLine, footprintInstrument, ledgerBudget, guardZones, guardFootprint } from '../scripts/memory/ratchet.mjs';

const MB = 1e6;
const points = (held: number): Parameters<typeof ledgerBudget>[0] => [
  { step: 'props', ledger: { gpu: { buffer: 8 * MB }, ram: { 'array-buffer': 70 * MB } } },
  { step: 'finish', ledger: { gpu: { buffer: 20 * MB }, ram: { 'array-buffer': (50 + held) * MB } } },
  { step: 'control', ledger: { gpu: { buffer: 18 * MB }, ram: { 'array-buffer': (30 + held) * MB } } },
  { step: 'playing', ledger: { gpu: { buffer: 30 * MB }, ram: { 'array-buffer': 90 * MB } } },
];
const boot = (held: number): ReturnType<typeof ledgerBudget> => ledgerBudget(points(held));

/** Hosted boots in order: a number is a reading with that many held MB, an Error a boot that never reached control. */
async function guard(boots: readonly (number | Error)[], baseline: ReturnType<typeof ledgerBudget> | null = boot(0)) {
  const booted: number[] = [];
  const files = await confirmZone({ zone: 'template', baseline: baseline ?? undefined, log: () => undefined,
    read: file => ({ microscope: { ready: true, checkpoints: points(boots[Number(file) - 1] as number) } }),
    boot: round => {
      booted.push(round);
      const outcome = boots[round - 1];
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(String(round));
    } });
  return { files, booted };
}

test('each subsystem has a control reading and a separate loading high-water mark', () => {
  expect(boot(0)).toMatchObject({ control: { geometry: 18 * MB, loading: 30 * MB },
    peak: { geometry: 20 * MB, loading: 70 * MB } });
  expect(() => ledgerBudget([{ step: 'finish', ledger: {} }])).toThrow('control ledger');
});

test('a 20 MB retained allocation fails even when an earlier stage still owns the peak', () => {
  expect(() => compareLedger(boot(0), [boot(20)], 'template')).toThrow(/template control loading: 50000000 B > 30600000 B/u);
  expect(compareLedger(boot(0), [boot(0)], 'template')).toEqual(boot(0));
});

test('one over-line hosted boot is confirmed by a second reading before the zone fails', () => {
  expect(confirmLedger(boot(0), [boot(4), boot(0)], 'template')).toEqual(boot(0));
  expect(confirmLedger(boot(0), [boot(0)], 'template')).toEqual(boot(0));
  expect(() => confirmLedger(boot(0), [boot(4)], 'template')).toThrow(/template control loading: 34000000 B > 30600000 B/u);
});

test('the guard measures a zone a second time only when its first reading is over the line', () => {
  expect(ledgerOverLine(boot(0), boot(0), 'template')).toBeNull();
  expect(ledgerOverLine(boot(0), boot(0.5), 'template')).toBeNull();
  expect(ledgerOverLine(boot(0), boot(4), 'template')).toMatch(/template control loading: 34000000 B > 30600000 B/u);
});

test('a hosted zone boots once when its reading is in line, twice when it is over', async () => {
  expect(await guard([0])).toEqual({ files: ['1'], booted: [1] });
  expect(await guard([4, 0])).toEqual({ files: ['1', '2'], booted: [1, 2] });
  expect(await guard([20, 20])).toEqual({ files: ['1', '2'], booted: [1, 2] });
});

test('a hosted boot that never reaches control is booted once more and fails only if that one does too', async () => {
  expect(await guard([new Error('stopped loading at step "props"'), 0])).toEqual({ files: ['2'], booted: [1, 2] });
  await expect(guard([new Error('first'), new Error('second')])).rejects.toThrow('second');
  await expect(guard([new Error('record mode')], null)).rejects.toThrow('record mode');
});

test('a retained allocation that every reading shows still fails the zone', () => {
  expect(() => confirmLedger(boot(0), [boot(20), boot(20)], 'template'))
    .toThrow(/2 of 2 readings over the line\n[^]*template control loading: 50000000 B > 30600000 B/u);
});

test('clean observations ratchet down and the tolerance never raises the baseline', () => {
  const baseline = boot(0), reduced = structuredClone(baseline);
  reduced.peak.loading -= MB;
  reduced.control.geometry += 1000;
  expect(compareLedger(baseline, [reduced], 'template')).toMatchObject({ control: { geometry: 18 * MB }, peak: { loading: 69 * MB } });
});

test('native footprint compares the median with the stored upper spread', () => {
  const baseline = footprintBudget([509, 524, 528]);
  expect(baseline).toEqual({ settled: 524, spread: 4 });
  expect(compareFootprint(baseline, [516, 525, 535])).toEqual(baseline);
  expect(() => compareFootprint(baseline, [526, 530, 535])).toThrow(/530 B > 528 B/u);
  expect(() => footprintBudget([0, 524, 528])).toThrow('native WebContent');
});

test('a Template footprint batch over the line is confirmed by a second batch before it fails', () => {
  const baseline = { settled: 539, spread: 51 };
  expect(footprintOverLine(baseline, [565, 567, 580])).toBeNull();
  expect(footprintOverLine(baseline, [539, 594, 600])).toMatch(/Template settled WebContent: 594 B > 590 B/u);
  expect(confirmFootprint(baseline, [[539, 594, 600], [550, 567, 587]])).toEqual({ settled: 539, spread: 51 });
  expect(() => confirmFootprint(baseline, [[539, 594, 600], [592, 596, 610]]))
    .toThrow(/2 of 2 batches over the line\n[^]*594 B > 590 B[^]*596 B > 590 B/u);
});

test('a footprint baseline and its runs share one inspector mode (EM11b)', () => {
  expect(footprintInstrument([{ instrument: 'minimal' }, { instrument: 'minimal' }], { instrument: 'minimal' })).toBe('minimal');
  expect(footprintInstrument([{}], null)).toBe('full');
  expect(() => footprintInstrument([{ instrument: 'minimal' }], {})).toThrow(/instrument full, these runs with minimal/u);
  expect(() => footprintInstrument([{ instrument: 'minimal' }, {}], null)).toThrow('mix inspector modes');
});

// J424 (Jake 2026-11-18): a memory gate blocks only where an agent armed it, after getting that zone under its line.
test('an unarmed zone over its line is a report; an armed one fails; a zone in line is ready to arm', () => {
  const stored = { a: boot(0), b: boot(0), c: { ...boot(0), armed: true }, d: { ...boot(0), armed: true } };
  const readings = new Map([['a', [boot(0)]], ['b', [boot(20)]], ['c', [boot(0)]], ['d', [boot(20)]]]);
  const verdict = guardZones(stored, readings, confirmLedger);
  expect(verdict.eligible).toEqual(['a']);
  expect(verdict.reports).toEqual([expect.stringMatching(/^b: 1 of 1 readings over the line\nb control loading/u)]);
  expect(verdict.failures).toEqual([expect.stringMatching(/^d: 1 of 1 readings over the line/u)]);
  expect(verdict.zones).toEqual({ a: boot(0), b: boot(0), c: { ...boot(0), armed: true }, d: { ...boot(0), armed: true } });
});

test('a zone with no reading or no baseline is a report unless it is armed', () => {
  const stored = { a: boot(0), b: { ...boot(0), armed: true } };
  const verdict = guardZones(stored, new Map([['a', []], ['b', []], ['new', [boot(0)]]]), confirmLedger);
  expect(verdict.reports).toEqual(['a: no boot reached control', 'new: no baseline yet; record it with ci.yml memory_record']);
  expect(verdict.failures).toEqual(['b: no boot reached control']);
  expect(verdict.zones).toEqual(stored);
});

test('the Template footprint blocks only when its anchor is armed', () => {
  const anchor = { settled: 539, spread: 51 }, over = [[592, 596, 610]], inside = [[550, 567, 587]];
  expect(guardFootprint(anchor, () => over)).toEqual({ anchor, report: expect.stringMatching(/1 of 1 batches over the line/u) });
  expect(guardFootprint(anchor, () => { throw new Error('Template did not reach control in native WebKit'); }))
    .toEqual({ anchor, report: 'Template did not reach control in native WebKit' });
  expect(guardFootprint(anchor, () => inside)).toEqual({ anchor, report: null });
  expect(guardFootprint({ ...anchor, armed: true }, () => inside)).toEqual({ anchor: { ...anchor, armed: true }, report: null });
  expect(() => guardFootprint({ ...anchor, armed: true }, () => over)).toThrow(/1 of 1 batches over the line/u);
});

interface Armed { armed?: boolean }

// J424: the native footprint job is advisory only while nothing it reads is armed. Arming the Template anchor or Nine's
// WebKit zone must also make the job blocking again: drop its continue-on-error and its main-watch advisory entry.
test('the footprint job stops being advisory the day anything it reads is armed', () => {
  const footprint = JSON.parse(readFileSync('scripts/memory/footprint-ratchet.json', 'utf8')) as { anchor: Armed };
  const webkit = JSON.parse(readFileSync('scripts/memory/webkit-ledger-ratchet.json', 'utf8')) as { zones: Record<string, Armed> };
  const armed = footprint.anchor.armed === true || Object.values(webkit.zones).some(zone => zone.armed === true);
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  const job = ci.slice(ci.indexOf('\n  memory-footprint-guard:'), ci.indexOf('\n    steps:', ci.indexOf('\n  memory-footprint-guard:')));
  expect(job).toContain('runs-on: macos-15');
  expect(job.includes('continue-on-error: true')).toBe(!armed);
  const red = { id: 1, head_sha: 'a', status: 'completed', conclusion: 'failure', created_at: '2026-11-18T00:00:00Z', event: 'push' };
  const verdict = blockingRun(red, [{ name: 'tests (1)', conclusion: 'success' }, { name: 'memory-footprint-guard', conclusion: 'cancelled' }]);
  expect(verdict.conclusion).toBe(armed ? 'failure' : 'success');
});
