// oxlint-disable-next-line import/no-nodejs-modules -- The test reads the committed baseline the build checks against.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The carried-book case writes a small dist.
import { tmpdir } from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- The carried-book case writes a small dist.
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { BASELINE_FILE, checkShardSizes, ratchetShardSizes, readPhoneDownloads, type ShardSizeBaseline } from '../scripts/shard-size-gate.mjs';

const limits = { newShardHardCapBytes: 60_000_000, toleranceBytes: 100_000, ratchetSlackBytes: 1_000_000 };
const baseline: ShardSizeBaseline = { limits, raises: [], shards: {
  held: { baselinePhoneBytes: 20_000_000, recordedPhoneBytes: 19_000_000, ceilingPhoneBytes: 20_000_000, shrinkOnly: false },
  over: { baselinePhoneBytes: 50_000_000, recordedPhoneBytes: 90_000_000, ceilingPhoneBytes: 90_000_000, shrinkOnly: true },
} };
const errors = (downloads: Record<string, number>, input: ShardSizeBaseline = baseline): string[] => checkShardSizes(input, downloads).errors;

test('a shard at or under its ceiling passes; the tolerance absorbs build noise', () => {
  expect(errors({ held: 20_050_000, over: 90_050_000 })).toEqual([]);
});

test('a baseline shard with no row is refused, unless a cook adds it and the gate runs again', () => {
  const [message] = errors({ held: 20_000_000 });
  expect(message).toContain('over has a baseline and no row');
  expect(checkShardSizes(baseline, { held: 20_000_000 }, { cooksAfter: true }).errors).toEqual([]);
});

test('growth past the baseline is refused, naming the shard and the way out', () => {
  const [message] = errors({ held: 21_000_000, over: 90_000_000 });
  expect(message).toContain('held downloads 21.00 MB');
  expect(message).toContain('raises');
});

test('a shrink-only shard cannot grow, and a shrink must be latched in the same change', () => {
  expect(errors({ held: 20_000_000, over: 91_000_000 })[0]).toContain('shrink-only');
  expect(errors({ held: 20_000_000, over: 80_000_000 })[0]).toContain('--ratchet');
});

test('a new shard is held to the hard cap, and only a new shard', () => {
  const both = { held: 20_000_000, over: 90_000_000 };
  expect(errors({ ...both, fresh: 59_000_000 })).toEqual([]);
  expect(errors({ ...both, fresh: 61_000_000 })[0]).toContain('hard cap');
});

test('a ratchet follows a shrink-only shard past its baseline, and the old room is gone', () => {
  const lower = ratchetShardSizes(baseline, { over: 70_000_000 });
  expect(lower.shards['over']).toMatchObject({ ceilingPhoneBytes: 70_000_000, latchedPhoneBytes: 70_000_000, shrinkOnly: true });
  expect(errors({ held: 20_000_000, over: 75_000_000 }, lower)[0]).toContain('over downloads');
  const past = ratchetShardSizes(lower, { over: 40_000_000 });
  expect(past.shards['over']).toMatchObject({ ceilingPhoneBytes: 40_000_000, latchedPhoneBytes: 40_000_000, shrinkOnly: true });
  expect(errors({ held: 20_000_000, over: 40_000_000 }, past)).toEqual([]);
  expect(errors({ held: 20_000_000, over: 49_000_000 }, past)[0]).toContain('over downloads');
  const regrown: ShardSizeBaseline = { ...past, shards: { ...past.shards, over: { baselinePhoneBytes: 50_000_000, recordedPhoneBytes: 90_000_000, ceilingPhoneBytes: 50_000_000, latchedPhoneBytes: 40_000_000, shrinkOnly: true } } };
  expect(errors({ held: 20_000_000, over: 50_000_000 }, regrown)[0]).toContain('"raises"');
});

test('a ratchet leaves build noise inside the slack alone', () => {
  expect(ratchetShardSizes(baseline, { over: 89_500_000 }).shards['over']?.ceilingPhoneBytes).toBe(90_000_000);
});

test('a ratchet leaves a shard at its baseline alone', () => {
  expect(ratchetShardSizes(baseline, { held: 15_000_000 }).shards['held']?.ceilingPhoneBytes).toBe(20_000_000);
  expect(ratchetShardSizes(baseline, { held: 25_000_000 }).shards['held']?.ceilingPhoneBytes).toBe(20_000_000);
});

test('a ceiling edited upward is refused until a raise names Jake\'s decision', () => {
  const edited = (raises: ShardSizeBaseline['raises']): ShardSizeBaseline => ({ limits, raises, shards: { ...baseline.shards,
    over: { baselinePhoneBytes: 50_000_000, recordedPhoneBytes: 90_000_000, ceilingPhoneBytes: 95_000_000, shrinkOnly: true } } });
  expect(errors({ held: 20_000_000, over: 95_000_000 }, edited([]))[0]).toContain('"raises"');
  expect(errors({ held: 20_000_000, over: 95_000_000 }, edited([{ shard: 'over', toBytes: 95_000_000, decision: 'soon', why: 'x' }]))[0]).toContain('names no decision');
  expect(errors({ held: 20_000_000, over: 95_000_000 }, edited([{ shard: 'over', toBytes: 95_000_000, decision: 'G1100', why: 'the new forest' }]))).toEqual([]);
});

test('the book read is this build\'s own, never one a deploy carried in, and no book means nothing to check', () => {
  const dist = mkdtempSync(join(tmpdir(), 'shard-size-'));
  expect(readPhoneDownloads(dist)).toBeNull();
  mkdirSync(join(dist, 'assets/spawn'), { recursive: true });
  const book = (bytes: number): string => JSON.stringify({ client: { one: { phone: { wireBytes: bytes } } } });
  writeFileSync(join(dist, 'assets/spawn/packs-aaaa.json'), book(1));
  writeFileSync(join(dist, 'assets/spawn/packs-bbbb.json'), book(2));
  writeFileSync(join(dist, 'version.json'), JSON.stringify({ build: 'bbbb' }));
  expect(readPhoneDownloads(dist)).toEqual({ one: 2 });
});

test('a split build reads its packs book from dist-content/ beside the page (PAGE-SIZE PZ4)', () => {
  const parent = mkdtempSync(join(tmpdir(), 'shard-size-')), dist = join(parent, 'dist'), content = join(parent, 'dist-content');
  mkdirSync(dist); mkdirSync(join(content, 'assets/spawn'), { recursive: true });
  writeFileSync(join(dist, 'version.json'), JSON.stringify({ build: 'dddd' }));
  writeFileSync(join(content, 'assets/spawn/packs-dddd.json'), JSON.stringify({ client: {
    cooked: { phone: { url: '/assets/spawn/cooked-whole-phone-0123abcd.json', wireBytes: 5 } } } }));
  writeFileSync(join(content, 'assets/spawn/engine-dddd.json'), JSON.stringify({ client: { phone: { wireBytes: 7 } } }));
  expect(readPhoneDownloads(dist)).toEqual({ cooked: 12 });
  // a whole dist (build-app.mjs's gate, before the split) wins over an older split's book with the same build id
  mkdirSync(join(dist, 'assets/spawn'), { recursive: true });
  writeFileSync(join(dist, 'assets/spawn/packs-dddd.json'), JSON.stringify({ client: { fresh: { phone: { wireBytes: 999 } } } }));
  expect(readPhoneDownloads(dist)).toEqual({ fresh: 999 });
});

test('a cooked row is read with the engine half its page also downloads', () => {
  const dist = mkdtempSync(join(tmpdir(), 'shard-size-'));
  mkdirSync(join(dist, 'assets/spawn'), { recursive: true });
  writeFileSync(join(dist, 'version.json'), JSON.stringify({ build: 'cccc' }));
  writeFileSync(join(dist, 'assets/spawn/packs-cccc.json'), JSON.stringify({ client: {
    cooked: { phone: { url: '/assets/spawn/cooked-whole-phone-0123abcd.json', wireBytes: 50 } },
    built: { phone: { url: '/assets/spawn/built-client-phone-0123abcd.json', wireBytes: 60 } } } }));
  writeFileSync(join(dist, 'assets/spawn/engine-cccc.json'), JSON.stringify({ book: 'engine', client: { phone: { wireBytes: 11 } } }));
  expect(readPhoneDownloads(dist)).toEqual({ cooked: 61, built: 60 });
});

test('the committed baseline is self-standing and internally lawful', () => {
  const file = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as ShardSizeBaseline & {
    baseline: { commit: string }; method: { steps: readonly string[] } };
  expect(file.baseline.commit).toMatch(/^[0-9a-f]{40}$/u);
  expect(file.method.steps.join('\n')).toContain(file.baseline.commit);
  expect(Object.keys(file.shards)).toHaveLength(6);
  expect(checkShardSizes(file, {}, { cooksAfter: true }).errors).toEqual([]);
});
