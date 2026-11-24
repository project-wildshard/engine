import { describe, expect, test } from 'vitest';
import { failed, judgeAll, recordAll } from '../scripts/budgets/cli.mjs';
import { readCaps } from '../scripts/budgets/files.mjs';
import { budgetReport, budgetResultLine, parseBudgetResults } from '../scripts/budgets/watch.mjs';
import { PHONE_LOW, expectPinnedZones, measuringCatalogue, phoneFrameMeasures } from '../scripts/budgets/phone-frames.mjs';

const slug = 'driftwood-isle', key = `render/phone-low/triangles/${slug}`;
const pin = (revision: number) => ({ [slug]: `${slug}@${revision}` });
const reading = (triangles = 100) => ({
  slug, tier: 'phone', low: true, deviceDpr: PHONE_LOW.deviceDpr, renderDpr: PHONE_LOW.renderDpr,
  views: [0, 1, 2].map(view => [0, 1, 2].map(sample => ({
    frame: 1 + view * 3 + sample,
    triangles: triangles + view * 10 + sample,
    draws: 30 - view * 2 + sample, programs: 50 + view + sample,
  }))),
});

describe('phone Low frame budgets', () => {
  test('measures the heaviest fixed view per counter and names the pin revision', () => {
    expect(phoneFrameMeasures(pin(5), [reading()], '602f0d93')).toEqual({
      commit: '602f0d93', measures: {
        [key]: { value: 121, contentKey: 'driftwood-isle@5' },
        [`render/phone-low/draws/${slug}`]: { value: 31, contentKey: 'driftwood-isle@5' },
        [`render/phone-low/programs/${slug}`]: { value: 53, contentKey: 'driftwood-isle@5' },
      },
    });
  });

  test('refuses a missing, extra or duplicated pin', () => {
    expect(() => phoneFrameMeasures({ ...pin(5), 'pine-hollow': 'pine-hollow@6' }, [reading()])).toThrow('every pinned zone');
    expect(() => expectPinnedZones(pin(5), [slug, 'pine-hollow'])).toThrow('every pinned zone');
    expect(() => phoneFrameMeasures(pin(5), [reading(), reading()])).toThrow('every pinned zone');
  });

  test.each([
    { tier: 'desktop' }, { low: false }, { renderDpr: 2 }, { deviceDpr: 1 },
  ])('refuses the wrong renderer proof %j', proof => {
    expect(() => phoneFrameMeasures(pin(5), [{ ...reading(), ...proof }])).toThrow('expected phone Low');
  });

  test('refuses a repeated frame or absent program count', () => {
    const repeated = reading();
    repeated.views[2]![0]!.frame = repeated.views[1]![2]!.frame;
    expect(() => phoneFrameMeasures(pin(5), [repeated])).toThrow('incomplete renderer frame samples');
    const missing = reading();
    missing.views[0]![0]!.programs = 0;
    expect(() => phoneFrameMeasures(pin(5), [missing])).toThrow('incomplete renderer frame samples');
  });

  test('J444 flags exactly 10% on the same revision and records a new revision', () => {
    const caps = readCaps();
    const first = recordAll(caps, { schema: 1, about: 'Phone Low test baselines', baselines: {} }, phoneFrameMeasures(pin(5), [reading(79)]));
    expect(first.errors).toEqual([]);
    const baseline = first.baselines;
    const judge = (revision: number, triangles: number) => judgeAll(caps, baseline, phoneFrameMeasures(pin(revision), [reading(triangles)]));
    expect(judge(5, 88).find(row => row.key === key)?.status).toBe('ok');
    expect(judge(5, 89).find(row => row.key === key)).toMatchObject({ status: 'regressed', value: 110, baseline: 100, line: 110, hard: null });
    expect(failed(judge(5, 89))).toBe(true);
    const failure = judge(5, 89).find(row => row.key === key)!;
    const report = budgetReport({ id: 7, head_sha: '602f0d93', created_at: '', conclusion: 'failure' },
      parseBudgetResults(budgetResultLine(failure)), ['lane']);
    expect(report.lines[0]).toContain('110 triangles, line 110 triangles');
    expect(judge(6, 89).find(row => row.key === key)?.status).toBe('raised');
    const next = recordAll(caps, baseline, phoneFrameMeasures(pin(6), [reading(89)]));
    expect(next.baselines.baselines[key]).toEqual({ value: 110, contentKey: 'driftwood-isle@6' });
  });

  // Meta QA-FEEDBACK-2026-11-24 row 57: phone High linked 39 programs after control at Driftwood's dock, and no budget saw it.
  const high = (programs = 100) => ({ ...reading(), graphics: 'high' as const, low: false, renderDpr: 2,
    views: reading().views.map(view => view.map(frame => ({ ...frame, programs: programs + frame.frame }))) });

  test('phone High records its programs beside Low, and Low alone still measures', () => {
    const highKey = `render/phone-high/programs/${slug}`;
    const both = phoneFrameMeasures(pin(5), [reading(), high()]);
    expect(both.measures[highKey]).toEqual({ value: 108, contentKey: 'driftwood-isle@5' });
    expect(Object.keys(both.measures).filter(name => name.startsWith('render/phone-high/'))).toEqual([highKey]);
    expect(both.measures[key]).toEqual({ value: 121, contentKey: 'driftwood-isle@5' });
    expect(phoneFrameMeasures(pin(5), [reading()]).measures[highKey]).toBeUndefined();
  });

  test('refuses a High reading that is Low, or a High sweep missing a pinned zone', () => {
    expect(() => phoneFrameMeasures(pin(5), [reading(), { ...high(), low: true }])).toThrow('expected phone High');
    expect(() => phoneFrameMeasures(pin(5), [reading(), { ...high(), renderDpr: 0 }])).toThrow('expected phone High');
    const pins = { ...pin(5), 'pine-hollow': 'pine-hollow@6' };
    expect(() => phoneFrameMeasures(pins, [reading(), { ...reading(), slug: 'pine-hollow' }, high()])).toThrow('every pinned zone');
  });

  test('J444 judges phone High programs against its own revision', () => {
    const caps = readCaps();
    const highKey = `render/phone-high/programs/${slug}`;
    const first = recordAll(caps, { schema: 1, about: 'Phone High test baselines', baselines: {} }, phoneFrameMeasures(pin(5), [reading(), high(92)]));
    expect(first.errors).toEqual([]);
    expect(first.baselines.baselines[highKey]).toEqual({ value: 100, contentKey: 'driftwood-isle@5' });
    const judge = (programs: number) => judgeAll(caps, first.baselines, phoneFrameMeasures(pin(5), [reading(), high(programs)])).find(row => row.key === highKey);
    expect(judge(101)?.status).toBe('ok');
    expect(judge(102)).toMatchObject({ status: 'regressed', value: 110, line: 110, hard: null });
  });

  test('gives a pinned zone with no cell a measuring cell in the page catalogue (meta MZ26)', () => {
    const catalogue = { placements: [{ instance: 'driftwood-isle', slug: 'driftwood-isle', cell: [0, 0] }],
      grid: { cells: [{ instance: 'driftwood-isle', slug: 'driftwood-isle', cell: [0, 0] }, { instance: 'x', slug: '_pine-hollow', cell: [3, -1] }] } };
    const page = (doc: object) => `<head><script type="application/json" id="ws-catalogue">${JSON.stringify(doc)}</script></head>`;
    const read = (html: string): typeof catalogue => JSON.parse(/id="ws-catalogue">([^<]*)</u.exec(html)?.[1] ?? 'null');
    expect(measuringCatalogue(page(catalogue), 'driftwood-isle')).toBe(page(catalogue));
    expect(measuringCatalogue(page(catalogue), 'pine-hollow')).toBe(page(catalogue));
    expect(read(measuringCatalogue(page(catalogue), 'mossgate')).grid.cells.at(-1)).toEqual({ instance: 'mossgate', slug: 'mossgate', cell: [1, -1] });
    // the grid admits |x| and |z| up to 3 (budgets run 44955536233: "Expected <=3 but received 4"): a full inner grid uses ring 3
    const full = { placements: [], grid: { cells: [-2, -1, 0, 1, 2].flatMap(x => [-2, -1, 0, 1, 2].map(z => ({ instance: `${x}${z}`, slug: `${x}${z}`, cell: [x, z] }))) } };
    const cell = read(measuringCatalogue(page(full), 'mossgate')).grid.cells.at(-1)?.cell ?? [];
    expect(Math.max(...cell.map(Math.abs))).toBe(3);
    expect(read(measuringCatalogue(page(catalogue), 'mossgate')).placements).toEqual(catalogue.placements);
  });
});
