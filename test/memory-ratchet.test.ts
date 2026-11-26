import { expect, test } from 'vitest';
import { compareLedger, confirmLedger, confirmZone, footprintBudget, ledgerOverLine, footprintInstrument, footprintBoot, ledgerBudget } from '../src/scripts/memory/ratchet.mjs';

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

// BUDGET-CAPS BC11: a replay judges each phase's total through the verdict (baseline + max(10%, 5 MB)), not each
// subsystem at 2%. boot(0)'s control total is 48 MB, so its line is 53 MB.
test('a 20 MB retained allocation fails even when an earlier stage still owns the peak', () => {
  expect(() => compareLedger(boot(0), [boot(20)], 'template')).toThrow(/template control total: 68000000 B > 53000000 B/u);
  expect(compareLedger(boot(0), [boot(0)], 'template')).toEqual(boot(0));
});

test('one over-line hosted boot is confirmed by a second reading before the zone fails', () => {
  expect(confirmLedger(boot(0), [boot(6), boot(0)], 'template')).toEqual(boot(0));
  expect(confirmLedger(boot(0), [boot(0)], 'template')).toEqual(boot(0));
  expect(() => confirmLedger(boot(0), [boot(6)], 'template')).toThrow(/template control total: 54000000 B > 53000000 B/u);
});

test('the guard measures a zone a second time only when its first reading is over the line', () => {
  expect(ledgerOverLine(boot(0), boot(0), 'template')).toBeNull();
  // 4 MB on a 48 MB total is under the 5 MB floor: the old 2% subsystem margin called it a failure
  expect(ledgerOverLine(boot(0), boot(4), 'template')).toBeNull();
  expect(ledgerOverLine(boot(0), boot(6), 'template')).toMatch(/template control total: 54000000 B > 53000000 B/u);
});

test('a hosted zone boots once when its reading is in line, twice when it is over', async () => {
  expect(await guard([0])).toEqual({ files: ['1'], booted: [1] });
  expect(await guard([6, 0])).toEqual({ files: ['1', '2'], booted: [1, 2] });
  expect(await guard([20, 20])).toEqual({ files: ['1', '2'], booted: [1, 2] });
});

test('a hosted boot that never reaches control is booted once more and fails only if that one does too', async () => {
  expect(await guard([new Error('stopped loading at step "props"'), 0])).toEqual({ files: ['2'], booted: [1, 2] });
  await expect(guard([new Error('first'), new Error('second')])).rejects.toThrow('second');
  await expect(guard([new Error('record mode')], null)).rejects.toThrow('record mode');
});

test('a retained allocation that every reading shows still fails the zone', () => {
  expect(() => confirmLedger(boot(0), [boot(20), boot(20)], 'template'))
    .toThrow(/2 of 2 readings over the line\n[^]*template control total: 68000000 B > 53000000 B/u);
});

test('nothing lowers itself and the tolerance never raises the baseline (BUDGET-CAPS BC6)', () => {
  const baseline = boot(0), reduced = structuredClone(baseline);
  reduced.peak.loading -= MB;
  reduced.control.geometry += 1000;
  expect(compareLedger(baseline, [reduced], 'template')).toEqual(baseline);
  const outlier = structuredClone(reduced); outlier.peak.loading = 42 * MB;
  expect(compareLedger(baseline, [outlier, reduced, baseline], 'template')).toEqual(baseline);
});

test('the native footprint settles on the median of a batch (the verdict judges it, BC11)', () => {
  expect(footprintBudget([509, 524, 528])).toEqual({ settled: 524, spread: 4 });
  expect(() => footprintBudget([0, 524, 528])).toThrow('native WebContent');
});

test('a footprint baseline and its runs share one inspector mode (EM11b)', () => {
  expect(footprintInstrument([{ instrument: 'minimal' }, { instrument: 'minimal' }], { instrument: 'minimal' })).toBe('minimal');
  expect(footprintInstrument([{}], null)).toBe('full');
  expect(() => footprintInstrument([{ instrument: 'minimal' }], {})).toThrow(/instrument full, these runs with minimal/u);
  expect(() => footprintInstrument([{ instrument: 'minimal' }, {}], null)).toThrow('mix inspector modes');
});

test('a footprint baseline and its runs share one boot (STR1)', () => {
  expect(footprintBoot([{ boot: 'online' }, { boot: 'online' }], { boot: 'online' })).toBe('online');
  expect(footprintBoot([{}], null)).toBe('standalone');
  expect(() => footprintBoot([{ boot: 'online' }], {})).toThrow(/standalone boot, these runs on the online boot/u);
  expect(() => footprintBoot([{ boot: 'online' }, {}], null)).toThrow('mix boots');
  expect(() => footprintBoot([{ boot: 'online+standalone' }], null)).toThrow('mix boots');
});
