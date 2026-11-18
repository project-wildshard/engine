import { expect, test } from 'vitest';
import { compareFootprint, compareLedger, confirmLedger, footprintBudget, ledgerOverLine, footprintInstrument, ledgerBudget } from '../scripts/memory/ratchet.mjs';

const MB = 1e6;
const boot = (held: number): ReturnType<typeof ledgerBudget> => ledgerBudget([
  { step: 'props', ledger: { gpu: { buffer: 8 * MB }, ram: { 'array-buffer': 70 * MB } } },
  { step: 'finish', ledger: { gpu: { buffer: 20 * MB }, ram: { 'array-buffer': (50 + held) * MB } } },
  { step: 'control', ledger: { gpu: { buffer: 18 * MB }, ram: { 'array-buffer': (30 + held) * MB } } },
  { step: 'playing', ledger: { gpu: { buffer: 30 * MB }, ram: { 'array-buffer': 90 * MB } } },
]);

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

test('a footprint baseline and its runs share one inspector mode (EM11b)', () => {
  expect(footprintInstrument([{ instrument: 'minimal' }, { instrument: 'minimal' }], { instrument: 'minimal' })).toBe('minimal');
  expect(footprintInstrument([{}], null)).toBe('full');
  expect(() => footprintInstrument([{ instrument: 'minimal' }], {})).toThrow(/instrument full, these runs with minimal/u);
  expect(() => footprintInstrument([{ instrument: 'minimal' }, {}], null)).toThrow('mix inspector modes');
});
