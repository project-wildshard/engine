import { describe, expect, test } from 'vitest';
import { failed, judgeAll, recordAll } from '../scripts/budgets/cli.mjs';
import { readCaps } from '../scripts/budgets/files.mjs';
import { budgetReport, budgetResultLine, parseBudgetResults } from '../scripts/budgets/watch.mjs';
import { PHONE_LOW, expectPinnedZones, phoneFrameMeasures } from '../scripts/budgets/phone-frames.mjs';

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
});
