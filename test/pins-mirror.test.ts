// Main red 45404606407 (2026-11-24): two open-plot pins had no mirror copy, an API blip left `pins.ts install` with no
// source, and main went red. The pins-mirror workflow fills and checks the mirror on every pin move, and pins.ts retries
// the API before it gives up.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { missingPins } from '../scripts/pins-mirror.mjs';

test('a pin with no mirror copy is named missing', () => {
  const pins = { shards: [{ slug: 'a', hash: 'aa' }, { slug: 'b', hash: 'bb' }] };
  expect(missingPins(pins, new Set(['aa.tar'])).map(pin => pin.slug)).toEqual(['b']);
});

test('the pins-mirror workflow fills the mirror whenever a pin moves on main', () => {
  const flow = readFileSync('.github/workflows/pins-mirror.yml', 'utf8');
  expect(flow).toContain('test/pins/shardfiles.json');
  expect(flow).toContain('node scripts/pins-mirror.mjs --fill');
  expect(flow).toContain('contents: write');
});

test('pins.ts retries the API before a pin has no source', () => {
  const source = readFileSync('scripts/pins.ts', 'utf8');
  expect(source).toMatch(/fetchedRetrying\(`\$\{API\}\/api\/shardfiles\/\$\{hash\}`/u);
});
