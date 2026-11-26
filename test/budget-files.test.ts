import { expect, test } from 'vitest';
import { capFor, fileErrors, readBaselines, readCaps } from '../src/scripts/budgets/files.mjs';

// BUDGET-CAPS BC2: the committed caps and baselines agree with each other and with Jake's numbers.
const caps = readCaps(), baselines = readBaselines();

test('the committed files keep every rule: J-numbers, cap entries, nothing over its hard cap, declared reasons', () => {
  expect(fileErrors(caps, baselines)).toEqual([]);
});

test('every cap with a number names a J-number', () => {
  for (const [key, cap] of Object.entries(caps.caps)) if (cap.hard !== null) expect(cap.decision, key).toMatch(/^J\d+$/u);
  expect(fileErrors({ caps: { 'x/y': { hard: 5, unit: 'bytes', kind: 'exact', decision: null, why: 'w' } } }, { baselines: {} })[0]).toContain('J-number');
});

test('every baseline key has a cap entry, and none is over its hard cap', () => {
  const capsOnly = { caps: { 'download/phone/*': { hard: 100, unit: 'bytes', kind: 'exact' as const, decision: 'J338', why: 'w' } } };
  expect(fileErrors(capsOnly, { baselines: { 'nowhere/x': { value: 1, contentKey: 'k' } } })[0]).toContain('no cap entry');
  expect(fileErrors(capsOnly, { baselines: { 'download/phone/a': { value: 101, contentKey: 'a@1' } } })[0]).toContain('over its 100 hard cap');
});

test('a declared entry has a reason', () => {
  const capsOnly = { caps: { 'js/title/raw': { hard: null, unit: 'bytes', kind: 'exact' as const, decision: null, why: 'w' } } };
  expect(fileErrors(capsOnly, { baselines: { 'js/title/raw': { value: 1, contentKey: 'engine', declared: ' ' } } })[0]).toContain('reason');
});

test('Jake\'s hard caps are seeded: 100 MB download (J338), 1.5 GB loading (J410), 1 MB title (J324), 1.0 GB playing a target (J445)', () => {
  expect(capFor(caps, 'download/phone/driftwood-isle')).toMatchObject({ hard: 100_000_000, decision: 'J338' });
  expect(capFor(caps, 'memory/loading/far-reach')).toMatchObject({ hard: 1_500_000_000, decision: 'J410' });
  expect(capFor(caps, 'memory/playing/far-reach')).toMatchObject({ hard: null, target: 1_000_000_000, decision: 'J445' });
  expect(capFor(caps, 'js/title/raw')).toMatchObject({ hard: 1_000_000, decision: 'J324' });
  // A baseline moves with content (J444): `cli.mjs record` rewrites it, so this checks it is recorded and under Jake's cap,
  // never its bytes (main 44563105968 broke on 452e939bf's re-record).
  const driftwood = baselines.baselines['download/phone/driftwood-isle'];
  expect(driftwood?.contentKey).toMatch(/^driftwood-isle@\d+$/u);
  expect(driftwood?.value).toBeGreaterThan(0);
  expect(driftwood?.value).toBeLessThanOrEqual(capFor(caps, 'download/phone/driftwood-isle')?.hard ?? 0);
});
