// oxlint-disable-next-line import/no-nodejs-modules -- The proof reads the client's own source tree.
import { readFileSync, readdirSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Walk the source tree.
import { join } from 'node:path';
import { expect, test } from 'vitest';

/**
 * SHARD-COMPAT FE9c (J486): the page never reads an original. It plays what a cook wrote (`cookJob.ts` cooks the chain's
 * copy of an original this engine's validator refuses, CP1) or a pinned folder (`pins.ts install` admits through the same
 * chain, FE9b), so it needs no chain of its own. This holds that: no client file opens a tarball, validates or migrates a
 * shard file, or fetches the API's originals.
 */
const RAW_READS: readonly RegExp[] = [
  /@wildshard\/format\/(tar|migrate|shardfileValidation|shardfile-stream[a-z-]*|formatMigrations)['"]/u,
  /\/api\/shardfiles\//u,
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/u.test(entry.name) && !/\.(test|proof)\.tsx?$/u.test(entry.name) ? [path] : [];
  });
}

test('the client reads cooked or pinned folders only, never an original', () => {
  const files = sources('src/client');
  expect(files.length).toBeGreaterThan(100);
  const reads = files.flatMap(file => {
    const text = readFileSync(file, 'utf8');
    return RAW_READS.filter(pattern => pattern.test(text)).map(pattern => `${file} ${String(pattern)}`);
  });
  expect(reads).toEqual([]);
});
