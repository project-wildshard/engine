// oxlint-disable-next-line import/no-nodejs-modules -- read the pins file the nightly reads
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { plan } from '../scripts/nightly-model';

// Ring 2's nightly plans one row per pinned head. A hard-coded 28 turned every night red at its first step after a pin
// was dropped (27 heads, 2026-11-13): the plan must take the pins file as it stands.
test('the nightly plan holds every pinned head, each once', () => {
  const pinned = (JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as {shards: {slug: string}[]}).shards.map(row => row.slug);
  const heads = plan().heads.map(row => row.slug);
  expect(heads.toSorted()).toEqual(pinned.toSorted());
  expect(new Set(heads).size).toBe(heads.length);
});
