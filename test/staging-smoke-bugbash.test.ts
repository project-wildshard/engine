// Meta STAGING-SMOKE SM6: on a scratch copy of the STAGING-BUGBASH plan, two findings, one new and one matching an open row,
// give one new row (next SB number, its own group) and one "seen again" line.
import { expect, test } from 'vitest';
import { bugbashRows, smokeKey } from '../src/scripts/staging-smoke/bugbash.mjs';

const PLAN = `# Staging bug bash

## Rows

### Group D: finish the bash

| Row | Work | Done when |
|---|---|---|
| SB12 | [x] **Old done row.** ${smokeKey({ scenario: 'K4', key: 'long-task' })}. | Done. |

### Group E: found by staging smoke v0.1.34

| Row | Work | Done when |
|---|---|---|
| SB40 | **a RECONNECTING strip 12 s into play (SB31) (P2, found by staging smoke v0.1.34, K3).** ${smokeKey({ scenario: 'K3', key: 'strip' })}. Scenario? no. | The staging smoke passes \`strip\` in K3. |

## Seams

- none
`;

test('one new row in a new group, one seen-again line on the open row', () => {
  const findings = [
    { scenario: 'K3', key: 'strip', severity: 'P2' as const, text: 'a RECONNECTING strip 8 s into play (SB31)', source: 'check' as const },
    { scenario: 'K4', key: 'long-task', severity: 'P2' as const, text: 'a 2400 ms long task after arrival (SB32)', source: 'check' as const, frame: '/s/K4/frames/last.jpg', video: '/s/K4/K4.mp4' },
  ];
  const { text, added, seenAgain } = bugbashRows(PLAN, findings, { release: 'v0.1.35', build: 'c'.repeat(40) });
  expect(added).toEqual(['SB41']);
  expect(seenAgain).toEqual(['SB40']);
  expect(bugbashRows(PLAN, findings, { release: 'v0.1.35' }).rowOf).toEqual({ 'K3/strip': 'SB40', 'K4/long-task': 'SB41' });
  const lines = text.split('\n');
  expect(lines.find(l => l.startsWith('| SB40 |'))).toMatch(/Seen again on v0\.1\.35 \(`cccccccc`\)\. \| The staging smoke passes/u);
  const group = lines.indexOf('### Group F: found by staging smoke v0.1.35 (`cccccccc`)');
  expect(group).toBeGreaterThan(lines.findIndex(l => l.startsWith('| SB40 |')));
  expect(group).toBeLessThan(lines.indexOf('## Seams'));
  const row = lines.find(l => l.startsWith('| SB41 |')) ?? '';
  expect(row).toContain('a 2400 ms long task after arrival (SB32) (P2, found by staging smoke v0.1.35, K4)');
  expect(row).toContain('frame `/s/K4/frames/last.jpg`, clip `/s/K4/K4.mp4`');
  expect(row).toContain("Scenario? no: K4's `long-task` check already holds it");
  // the done row with the same key is not reopened
  expect(lines.find(l => l.startsWith('| SB12 |'))).not.toContain('Seen again');
  expect(text.split('\n').length).toBe(PLAN.split('\n').length + 6);
});

test('no findings leave the plan as it was', () => {
  expect(bugbashRows(PLAN, [], { release: 'v0.1.35' }).text).toBe(PLAN);
});
