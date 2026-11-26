import { expect, test } from 'vitest';
import { RELEASE_STEP_BUDGET_S, phaseTable } from '../src/scripts/page-release/phase-times.mjs';

test('PV19: the release prints seconds per phase and a summary table, and warns amber over 180 s', () => {
  expect(RELEASE_STEP_BUDGET_S).toBe(180);
  const under = phaseTable('preview', [{ phase: 'build', ms: 95_040 }, { phase: 'upload', ms: 21_000 }, { phase: 'check', ms: 4_960 }, { phase: 'go-live', ms: 9_000 }]);
  expect(under.lines).toEqual(['phase build 95.0 s', 'phase upload 21.0 s', 'phase check 5.0 s', 'phase go-live 9.0 s', 'phase total 130.0 s (budget 180 s)']);
  expect(under.totalS).toBe(130);
  expect(under.warning).toBeUndefined();
  expect(under.summary).toContain('| build | 95.0 |');
  expect(under.summary).toContain('| **total** | **130.0** |');
  expect(under.summary).toContain('Under the 180 s budget.');
  const over = phaseTable('preview', [{ phase: 'build', ms: 170_000 }, { phase: 'upload', ms: 20_000 }]);
  expect(over.totalS).toBe(190);
  expect(over.warning).toBe('::warning title=release step over budget::preview release step took 190.0 s, over its 180 s budget (fix-preview PV19, J295)');
  expect(over.summary).toContain('AMBER: the release step took 190.0 s');
  expect(phaseTable('preview', [{ phase: 'build', ms: 180_000 }]).warning).toBeUndefined();
});
