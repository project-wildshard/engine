// oxlint-disable-next-line import/no-nodejs-modules -- The test reads the committed baseline the build checks against.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The carried-book case writes a small dist.
import { tmpdir } from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- The carried-book case writes a small dist.
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { BASELINE_FILE, checkShardSizes, pinnedContentKeys, readPhoneDownloads, shardMeasures } from '../src/scripts/shard-size-gate.mjs';
import { readBaselines, readCaps } from '../src/scripts/budgets/files.mjs';

// BUDGET-CAPS BC4 (J444, J437): the download is judged by the budget verdict. The hard cap is J338's 100 MB; the soft
// line is the recorded baseline plus 10% for the same pinned revision; a new revision is new content.
const caps = { schema: 1, about: '', caps: { 'download/phone/*': { hard: 100_000_000, unit: 'bytes', kind: 'exact' as const, decision: 'J338', why: 'w' } } };
const budgets = { caps, baselines: { schema: 1, about: '', baselines: {
  'download/phone/driftwood-isle': { value: 21_082_585, contentKey: 'driftwood-isle@4' },
  'download/phone/held': { value: 20_000_000, contentKey: 'held@1' },
} } };
const keys = { 'driftwood-isle': 'driftwood-isle@5', held: 'held@1' };
const errors = (downloads: Record<string, number>, contentKeys: Record<string, string> = keys): string[] => checkShardSizes(budgets, downloads, { contentKeys }).errors;

test('Driftwood rev 5 at 22,218,404 B against rev 4\'s 21,082,585 B baseline passes as raised (J437)', () => {
  const result = checkShardSizes(budgets, { 'driftwood-isle': 22_218_404, held: 20_000_000 }, { contentKeys: keys });
  expect(result.errors).toEqual([]);
  expect(result.rows.find(row => row.key === 'download/phone/driftwood-isle')?.status).toBe('raised');
});

test('the same revision 10% over its baseline fails as a regression, 9% passes', () => {
  const same = { ...keys, 'driftwood-isle': 'driftwood-isle@4' };
  expect(errors({ 'driftwood-isle': 23_190_844, held: 20_000_000 }, same)[0]).toContain('regressed');
  expect(errors({ 'driftwood-isle': 22_980_000, held: 20_000_000 }, same)).toEqual([]);
});

test('past 100 MB fails on any revision, and a shard with no baseline is held to the hard cap alone', () => {
  expect(errors({ 'driftwood-isle': 101_000_000, held: 20_000_000 })[0]).toContain('100.00 MB hard cap');
  expect(errors({ 'driftwood-isle': 22_000_000, held: 20_000_000, fresh: 99_000_000 }, { ...keys, fresh: 'fresh@1' })).toEqual([]);
  expect(errors({ 'driftwood-isle': 22_000_000, held: 20_000_000, fresh: 101_000_000 }, { ...keys, fresh: 'fresh@1' })[0]).toContain('fresh');
});

test('a 30% smaller shard passes: nothing fails for getting smaller', () => {
  expect(errors({ 'driftwood-isle': 22_000_000, held: 14_000_000 })).toEqual([]);
});

test('a baseline shard with no row is refused, unless a cook adds it and the gate runs again', () => {
  const [message] = errors({ held: 20_000_000 });
  expect(message).toContain('driftwood-isle has a baseline and no row');
  expect(checkShardSizes(budgets, { held: 20_000_000 }, { contentKeys: keys, cooksAfter: true }).errors).toEqual([]);
});

test('measures carry each shard\'s pinned revision as its content key; an unpinned product is engine content', () => {
  expect(shardMeasures({ held: 5, other: 6 }, { held: 'held@1' })).toEqual({ measures: {
    'download/phone/held': { value: 5, contentKey: 'held@1' }, 'download/phone/other': { value: 6, contentKey: 'engine' } } });
  const pinned = pinnedContentKeys();
  expect(pinned['driftwood-isle']).toMatch(/^driftwood-isle@\d+$/u);
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

test('the committed numbers are lawful: the measurement record stays as history, the budgets judge it', () => {
  const file = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as { baseline: { commit: string }; method: { steps: readonly string[] }; shards: Record<string, unknown> };
  expect(file.baseline.commit).toMatch(/^[0-9a-f]{40}$/u);
  expect(file.method.steps.join('\n')).toContain(file.baseline.commit);
  expect(file).not.toHaveProperty('raises');
  expect(file).not.toHaveProperty('limits');
  for (const row of Object.values(file.shards)) expect(row).not.toHaveProperty('shrinkOnly');
  expect(checkShardSizes({ caps: readCaps(), baselines: readBaselines() }, {}, { contentKeys: pinnedContentKeys(), cooksAfter: true }).errors).toEqual([]);
});
