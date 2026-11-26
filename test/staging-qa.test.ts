import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { deployFrameProblem } from '../src/scripts/journey-proof.mjs';
import { gateLeg, holdLine, JOURNEY_CARD, mergeVerdict } from '../src/scripts/staging-qa.mjs';
import { QA_RIG_SHARDS, tourFixture } from '../src/scripts/staging-qa-local.mjs';
import { TOUR_FEATURED } from '../src/scripts/zone-entry-featured.mjs';
import { CHANNELS, qaGap, QA_LEGS } from '../src/scripts/page-release/flow.mjs';
import { chromiumCandidateArgs } from '../src/scripts/staging-qa-browser.mjs';
import { pickPhone, qaDevice } from '../src/scripts/staging-qa-sim.mjs';
import { budgetFinding, LEG_CAP_S, LEG_TARGET_S, LEGS, nominalSeconds, STEPS } from '../src/scripts/staging-qa-budget.mjs';

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

  it('J505 holds only the failing build and leaves the fix-forward release independent', () => {
    const failed = mergeVerdict({ ...clean, proofs: [{ ...proof, pass: false }] });
    const staging = {
      qa: true, kind: 'staging' as const, full: true, url: CHANNELS.staging.origin,
      scenarios: QA_LEGS.staging.map(id => ({ id, status: 'ran' })),
    };
    const held = { ...staging, ...failed, full: true, build };
    const fixed = 'b'.repeat(40);
    expect(qaGap(held, build)).toContain('it holds');
    expect(qaGap(held, fixed)).toContain('the verdict is for');
    expect(qaGap({ ...staging, build: fixed, hold: false }, fixed)).toBeUndefined();
    const line = holdLine({ ...held, release: 'v0.1.77' }, 'codex-ms');
    expect(line).toContain('Hold promotion of this build only');
    expect(line).toContain('Engine, SDK and format cuts continue');
    expect(line).toContain('only the colliding revision for at most 30 minutes');
  });

  it('holds on any P0 or a missing journey and names the fix-forward lane', () => {
    const broken = mergeVerdict({ ...clean, proofs: [{ ...proof, pass: false, reason: 'world is black' }] });
    expect(broken).toMatchObject({ hold: true, worst: 'P0' });
    expect(holdLine({ ...broken, release: 'v0.1.44' }, 'opus-drift')).toContain('HOLD v0.1.44 P0 journey-webkit play. Fix forward with opus-drift');
    expect(mergeVerdict({ ...clean, proofs: [] })).toMatchObject({ hold: true, worst: 'P1' });
  });
});

describe('staging QA budget (SQ16, J427)', () => {
  it('fits every leg in about ten minutes, the iOS Simulator minutes inside them', () => {
    for (const [kind, steps] of Object.entries(LEGS)) {
      for (const id of steps) expect(STEPS[id]?.catches, `${kind} ${id}`).toBeTruthy();
      expect(nominalSeconds(steps), kind).toBeLessThanOrEqual(LEG_TARGET_S);
    }
    expect(LEGS.local).toContain('ios-safari');
    expect(STEPS['ios-safari']?.seconds).toBeGreaterThanOrEqual(60);
    expect(nominalSeconds(LEGS.local) + nominalSeconds(LEGS.candidate) + nominalSeconds(LEGS.staging)).toBeLessThanOrEqual(2 * LEG_TARGET_S);
  });

  it('reports a leg over its cap as a P2 against the runner, which never holds', () => {
    expect(budgetFinding('local', LEG_CAP_S)).toBeUndefined();
    const over = budgetFinding('candidate', LEG_CAP_S + 60);
    expect(over).toMatchObject({ scenario: 'runner', key: 'budget', severity: 'P2' });
    expect(over?.text).toContain('13.0 min');
    expect(mergeVerdict({ ...clean, runner: over === undefined ? [] : [over] })).toMatchObject({ hold: false, worst: 'P2' });
  });
});

describe('the iOS Simulator step (SQ14)', () => {
  it('picks the newest iOS iPhone 17 Pro, the size of Jake\'s phone', () => {
    const row = (udid: string, name: string, state = 'Shutdown') => ({ udid, name, state, isAvailable: true });
    const listing = { devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [row('a', 'iPhone 17 Pro')],
      'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [row('b', 'iPhone 17 Pro Max'), row('c', 'iPhone 17 Pro', 'Booted'), row('d', 'iPhone 16 Pro')],
      'com.apple.CoreSimulator.SimRuntime.watchOS-12-0': [row('e', 'iPhone 17 Pro')],
    } };
    expect(pickPhone(listing)).toMatchObject({ udid: 'c', state: 'Booted', version: [27, 0] });
    expect(pickPhone({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [row('d', 'iPhone 16 Pro')] } })?.udid).toBe('d');
    expect(pickPhone({ devices: {} })).toBeUndefined();
    expect(qaDevice(listing)).toBeUndefined();
    expect(qaDevice({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [row('q', 'Wildshard QA')] } })?.udid).toBe('q');
  });
});

// Build-max C4 (2026-11-23): v0.1.77's local QA held when cbcaca71a sent every gate leg into Nalati, which the local rig never
// hosts (f91fe592c). Every leg a loopback run takes must land in a shard openQaRig serves.
describe('the local QA rig hosts every shard a local leg visits', () => {
  it('the gate and the journey card stay inside the rig on loopback', () => {
    const local = gateLeg('http://127.0.0.1:19476');
    expect(QA_RIG_SHARDS).toContain(local.target);
    expect(QA_RIG_SHARDS).toContain(JOURNEY_CARD);
    expect(local.reenter).toBe(false);
  });
  it('staging keeps the Nalati crossing and the walk back in', () => {
    expect(gateLeg(CHANNELS.staging.origin)).toEqual({ target: 'nalati-grasslands', reenter: true });
  });
});

// QA 11-23-b row 37 (J505): v0.1.78's local fixed-route probe never reached Nalati, because the default rig hosted only
// Driftwood, Pine and Sky Reach and the page stayed in Driftwood with no error. The default rig now hosts the J451 roster.
describe('the default local rig hosts every zone the J451 tour features', () => {
  it('its shard list is the whole roster', () => {
    expect([...QA_RIG_SHARDS].sort()).toEqual([...TOUR_FEATURED].sort());
  });
  it('with no seed the fixture hosts and places every featured zone', async () => {
    const fixture = await tourFixture(process.cwd());
    expect([...fixture.more].sort()).toEqual(TOUR_FEATURED.filter(slug => slug !== 'driftwood-isle').sort());
    const placed = new Set([...(fixture.catalogue as { grid: { cells: { instance: string; slug?: string }[] } }).grid.cells]
      .map(cell => cell.slug ?? cell.instance));
    expect(TOUR_FEATURED.filter(slug => !placed.has(slug))).toEqual([]);
  });
});
