import { readFileSync } from 'node:fs';
import {expect, test} from 'vitest';
import {movePin} from '../scripts/pin-shard.ts';

const a = 'a'.repeat(64), b = 'b'.repeat(64);
const pins = {api: 'x', shards: [{slug: 'dunes', revision: 1, hash: a, bytes: 10}, {slug: 'nine', revision: 1, hash: a, bytes: 20}]};
const document = {shards: [{slug: 'nine', name: 'Nine', revision: 1, hash: a}, {slug: 'dunes', name: 'Dunes', revision: 1, hash: a}]};

test('moves only the published slug, in place, in both files', () => {
  const moved = movePin(pins, document, {slug: 'nine', revision: 2, hash: b, bytes: 30});
  expect(moved.pins.shards).toEqual([pins.shards[0], {slug: 'nine', revision: 2, hash: b, bytes: 30}]);
  expect(moved.document.shards).toEqual([{slug: 'nine', name: 'Nine', revision: 2, hash: b}, document.shards[1]]);
});

test('refuses a slug engine never pinned', () => {
  expect(() => movePin(pins, document, {slug: 'new', revision: 1, hash: b, bytes: 1})).toThrow(/no pin to move/u);
});

test('refuses to move a pin backwards', () => {
  const ahead = {...pins, shards: [{slug: 'nine', revision: 5, hash: a, bytes: 1}]};
  expect(() => movePin(ahead, document, {slug: 'nine', revision: 2, hash: b, bytes: 1})).toThrow(/newer than 2/u);
});

// Main red at dfb768cd0 (2026-11-19): Nalati rev 4's pin kept rev 3's Ring 1 slice row, so `pins.ts install --ring 1`
// refused it ("slice belongs to another head"). The workflow re-cuts a Ring 1 slice and commits it with the pin.
test('shard-pin re-cuts a Ring 1 slug\'s server slice and commits it with the pin', () => {
  const flow = readFileSync('.github/workflows/shard-pin.yml', 'utf8');
  const cut = flow.indexOf('node scripts/pins.ts slice'), move = flow.indexOf('node scripts/pin-shard.ts'), commit = flow.indexOf('git commit');
  expect(move).toBeGreaterThan(-1);
  expect(cut).toBeGreaterThan(move);
  expect(commit).toBeGreaterThan(cut);
  expect(flow).toMatch(/rings\.json[\s\S]*slices[\s\S]*node scripts\/pins\.ts slice/u);
  expect(flow.slice(commit)).toMatch(/-- test\/pins\/shardfiles\.json [^\n]*test\/pins\/slices\.json/u);
});

test('shard-pin records only the moved Ring 1 product or slice before committing the pin', () => {
  const flow = readFileSync('.github/workflows/shard-pin.yml', 'utf8');
  const cut = flow.indexOf('node scripts/pins.ts slice');
  const install = flow.indexOf('node scripts/pins.ts install --ring 1');
  const record = flow.indexOf('scripts/ring-step.ts --update --only "$SLUG"');
  const commit = flow.indexOf('git commit');
  expect(flow).toMatch(/slice \|\| ring\.products\.includes\(process\.argv\[1\]\)/u);
  expect(install).toBeGreaterThan(cut);
  expect(record).toBeGreaterThan(install);
  expect(commit).toBeGreaterThan(record);
  expect(flow.slice(commit)).toMatch(/-- test\/pins\/shardfiles\.json [^\n]*test\/pins\/ring-digests\.json/u);
});
