import { describe, expect, it } from 'vitest';
import { holdLine, mergeVerdict } from '../scripts/staging-qa.mjs';

const build = 'a'.repeat(40);
const selected = ['K3'];
const expected = ['journey-webkit'];
const proof = { id: 'journey-webkit', browser: 'webkit', pass: true, seconds: 3, playedMs: 2000, log: 'run.log' };
const smoke = { build, scenarios: [{ id: 'K3', status: 'ran', legs: [{ playedMs: 4000 }] }], findings: [] };
const clean = { build, smoke, proofs: [proof], expected, selected, after: build, full: false };

describe('staging QA deploy verdict', () => {
  it('rejects smoke evidence or a final readback for another build', () => {
    expect(() => mergeVerdict({ ...clean, smoke: { ...smoke, build: 'old' } })).toThrow('build changed');
    expect(() => mergeVerdict({ ...clean, after: 'old' })).toThrow('build changed');
  });

  it('reports vision without holding, and totals measured play', () => {
    const vision = { scenario: 'K3', key: 'vision', severity: 'P0', text: 'the judge reported a change', source: 'vision' } as const;
    const result = mergeVerdict({ ...clean, smoke: { ...smoke, findings: [vision] } });
    expect(result).toMatchObject({ hold: false, worst: 'none', minutesInPlay: 0.1 });
    expect(holdLine({ release: 'v0.1.44', findings: [vision] }, 'opus-drift')).toBeUndefined();
  });

  it('holds on any P0 or a missing journey and names the fix-forward lane', () => {
    const broken = mergeVerdict({ ...clean, proofs: [{ ...proof, pass: false, reason: 'world is black' }] });
    expect(broken).toMatchObject({ hold: true, worst: 'P0' });
    expect(holdLine({ ...broken, release: 'v0.1.44' }, 'opus-drift')).toContain('HOLD v0.1.44 P0 journey-webkit play. Fix forward with opus-drift');
    expect(mergeVerdict({ ...clean, proofs: [] })).toMatchObject({ hold: true, worst: 'P1' });
  });
});
