import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { deployFrameProblem } from '../scripts/journey-proof.mjs';
import { holdLine, mergeVerdict } from '../scripts/staging-qa.mjs';
import { chromiumCandidateArgs } from '../scripts/staging-qa-browser.mjs';

const build = 'a'.repeat(40);
const selected = ['K3'];
const expected = ['journey-webkit'];
const proof = { id: 'journey-webkit', browser: 'webkit', pass: true, seconds: 3, playedMs: 2000, log: 'run.log' };
const smoke = { build, scenarios: [{ id: 'K3', status: 'ran', legs: [{ playedMs: 4000 }] }], findings: [] };
const clean = { build, smoke, proofs: [proof], expected, selected, after: build, full: false };

it('pins only the staging preview key in Chromium while preserving its launch flags', () => {
  const pin = Buffer.alloc(32, 6).toString('base64');
  const audio = ['--mute-audio', '--use-mock-keychain', '--password-store=basic'];
  expect(chromiumCandidateArgs(audio, pin)).toEqual([...audio, `--ignore-certificate-errors-spki-list=${pin}`]);
  expect(() => chromiumCandidateArgs(audio, undefined)).toThrow('requires the staging preview certificate pin');
  expect(() => chromiumCandidateArgs(audio, 'invalid')).toThrow('requires the staging preview certificate pin');
  expect(() => chromiumCandidateArgs([...audio, '--ignore-certificate-errors'], pin)).toThrow('requires scoped certificate trust');
});

describe('staging QA deploy verdict', () => {
  it('holds on several SB48 black frames and accepts a lit frame', async () => {
    const frame = (background: string) => sharp({ create: { width: 120, height: 180, channels: 3, background } }).png().toBuffer();
    const dark = await frame('#050810');
    const lit = await frame('#91bfd8');
    const waitForTimeout = () => Promise.resolve();
    expect(await deployFrameProblem({ waitForTimeout, screenshot: () => Promise.resolve(dark) })).toContain('world is black or empty');
    let count = 0;
    expect(await deployFrameProblem({ waitForTimeout, screenshot: () => Promise.resolve(++count < 2 ? dark : lit) })).toBeNull();
  });
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
