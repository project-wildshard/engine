import { readdirSync } from 'node:fs';
import { expect, test } from 'vitest';
import { T1_SHARDS } from '../scripts/t1-shards.mjs';
import { t1Verdict } from '../scripts/t1-ci-proof.mjs';

test('every actual Template spec belongs to exactly one stable suite shard', () => {
  const specs = readdirSync('src/e2e/t1').filter(name => name.endsWith('.spec.ts'));
  expect(specs.length).toBeGreaterThan(0);
  for (const spec of specs) {
    const owners = Object.entries(T1_SHARDS).filter(([, match]) => match.test(`/src/e2e/t1/${spec}`)).map(([suite]) => suite);
    expect(owners, spec).toHaveLength(1);
    if (spec === 'online.spec.ts') expect(owners).toEqual(['D']);
    if (spec === 'online-entry.spec.ts') expect(owners).toEqual(['K']);
    if (spec === 'online-packs.spec.ts') expect(owners).toEqual(['L']);
    if (spec === 'phone.spec.ts') expect(owners).toEqual(['C']);
    if (spec === 'saves.spec.ts') expect(owners).toEqual(['B']);
    if (spec === 'fixtures.spec.ts') expect(owners).toEqual(['G']);
    if (spec === 'saves-exit.spec.ts') expect(owners).toEqual(['H']);
    if (spec === 'released-save.spec.ts') expect(owners).toEqual(['I']);
    if (spec === 'dev-world.spec.ts') expect(owners).toEqual(['J']);
    if (spec.startsWith('journey')) expect(owners).toEqual([spec === 'journey.spec.ts' ? 'E' : 'F']);
  }
});

test('a real failure, signal or excess wall stays red in report receipts', () => {
  expect(t1Verdict({ status: 0, signal: null }, 120_000)).toBe('pass');
  expect(t1Verdict({ status: 0, signal: null }, 120_001)).toBe('fail');
  expect(t1Verdict({ status: 1, signal: null }, 30_000)).toBe('fail');
  expect(t1Verdict({ status: null, signal: 'SIGTERM' }, 30_000)).toBe('fail');
});
