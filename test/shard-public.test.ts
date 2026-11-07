// oxlint-disable-next-line import/no-nodejs-modules -- The publisher writes real files.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The publisher writes real files.
import { tmpdir } from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- The publisher writes real files.
import { dirname, join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { GATHERED_SHARDS, entryReadsFile, publishShardFiles } from '../scripts/shard-public.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test('a gathered shard publishes its entry reads at the same URL with the same bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'shard-public-'));
  roots.push(root);
  for (const slug of GATHERED_SHARDS) {
    const source = entryReadsFile(root, slug);
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(source, `[${JSON.stringify(slug)}]\n`);
  }
  publishShardFiles(root);
  for (const slug of GATHERED_SHARDS) expect(readFileSync(join(root, 'public/assets', slug, 'entry-reads.json'), 'utf8')).toBe(`[${JSON.stringify(slug)}]\n`);
});

test('a shard not gathered yet keeps its entry reads in public', () => {
  expect(entryReadsFile('/repo', 'open-plot-thin-ice')).toBe('/repo/public/assets/open-plot-thin-ice/entry-reads.json');
  expect(entryReadsFile('/repo', 'pastel-plain')).toBe('/repo/src/shards/pastel-plain/look/entry-reads.json');
});
