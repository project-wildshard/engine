import {expect, test} from 'vitest';
import {parseSaveFixture} from '../scripts/phone-loading/fixtures';
import {writeSaveFixture} from '../scripts/debug-settings.mjs';

test('optional fixtures leave the original ruler settings alone', () => {
  expect(parseSaveFixture(undefined)).toBeUndefined();
});

test('scalar choices use the original durable save fixture path', () => {
  const previous = localStorage.getItem('wildshard.save.v2.device');
  const previousGlobal = localStorage.getItem('wildshard.save.v2.global');
  try {
    for (const data of [true, false]) {
      const fixture = parseSaveFixture(JSON.stringify({scope: 'device', key: 'fixture.option', data}));
      if (fixture === undefined) throw new Error('Missing scalar save fixture');
      writeSaveFixture(fixture);
      const stored: unknown = JSON.parse(localStorage.getItem('wildshard.save.v2.device') ?? 'null');
      expect(stored).toMatchObject({keys: {'fixture.option': {v: 1, data}}});
    }
  } finally {
    if (previous === null) localStorage.removeItem('wildshard.save.v2.device'); else localStorage.setItem('wildshard.save.v2.device', previous);
    if (previousGlobal === null) localStorage.removeItem('wildshard.save.v2.global'); else localStorage.setItem('wildshard.save.v2.global', previousGlobal);
  }
});

test('invalid scope, shape, key and merge requests refuse before opening a browser', () => {
  for (const value of [null, [], {}, {scope: 'device', key: '__proto__', data: true},
    {scope: 'device', key: 'fixture.option'}, {scope: 'other', key: 'pick', data: true},
    {scope: 'device', key: 'pick', data: true, merge: 'yes'}, {scope: 'device', key: 'pick', data: 'scalar', merge: true},
    {scope: 'device', key: 'pick', data: true, once: ''}, {scope: 'device', key: 'pick', data: true, extra: true}]) {
    expect(() => parseSaveFixture(JSON.stringify(value))).toThrow();
  }
  expect(() => parseSaveFixture('x'.repeat(16385))).toThrow('16 KiB');
  expect(() => parseSaveFixture(JSON.stringify({scope: 'device', key: 'pick', data: '☃'.repeat(6000)}))).toThrow('16 KiB');
});
