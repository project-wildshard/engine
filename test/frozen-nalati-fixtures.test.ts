import { expect, test } from 'vitest';
import { frozenNalatiBytes, frozenNalatiJson } from './fixtures/frozen/nalati';

test('CI21-H2 reads source-pinned Nalati fixture bytes without shard source', () => {
  const weather = frozenNalatiJson('nalati-weather-original.json');
  expect(weather).toBeTypeOf('object');
  expect(frozenNalatiBytes('nalati-geography-original.bin')).toHaveLength(995_619);
  expect(() => frozenNalatiBytes('not-a-fixture.json')).toThrow('Unknown CI21 Nalati frozen fixture');
});
