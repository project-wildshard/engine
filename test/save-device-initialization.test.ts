import { afterEach, expect, test } from 'vitest';
import * as v from 'valibot';
import { installAppIdentity } from '../src/shared/engine/app/identity';
import { WILDSHARD_IDENTITY } from '../src/client/game/identity';
import { SaveStore } from '../src/shared/engine/saves/store';
import { MemoryStorage } from './setup';

afterEach(() => installAppIdentity(WILDSHARD_IDENTITY));
const prefix = WILDSHARD_IDENTITY.savePrefix;
const device = `${prefix}device`, global = `${prefix}global`;

test('first boot preserves an existing current-epoch device document before global exists', () => {
  installAppIdentity(WILDSHARD_IDENTITY);
  const local = new MemoryStorage();
  const saved = { keys: { graphics: { v: 1, data: 'low' }, newerPreference: { v: 5, data: { future: true } } } };
  local.setItem(device, JSON.stringify(saved));
  local.setItem(`${WILDSHARD_IDENTITY.previousSavePrefix}device`, JSON.stringify({ keys: { devMode: { v: 1, data: true } } }));
  const store = new SaveStore({ local, session: new MemoryStorage() });
  const graphics = store.define({ key: 'graphics', scope: 'device', version: 1, schema: v.string(), initial: () => 'high' });
  expect(graphics.read()).toBe('low');
  expect(JSON.parse(local.getItem(device) ?? '')).toEqual(saved);
  expect(local.getItem(global)).not.toBeNull();
  const diagnostic = store.define({ key: 'boot.trace', scope: 'device', version: 1, schema: v.string(), initial: () => '' });
  expect(diagnostic.write('control')).toBe(true);
  expect(graphics.peek()).toBe('low');
  expect(JSON.parse(local.getItem(device) ?? '').keys.newerPreference).toEqual(saved.keys.newerPreference);
});

test('a retry after the global completion write fails preserves device keys written in between', () => {
  installAppIdentity(WILDSHARD_IDENTITY);
  const local = new MemoryStorage(), set = local.setItem.bind(local);
  let block = true;
  local.setItem = (key, value) => { if (key === global && block) throw new Error('quota'); set(key, value); };
  const make = () => new SaveStore({ local, session: new MemoryStorage() }).define({
    key: 'graphics', scope: 'device', version: 1, schema: v.string(), initial: () => 'high',
  });
  expect(make().write('low')).toBe(true);
  expect(local.getItem(global)).toBeNull();
  block = false;
  expect(make().read()).toBe('low');
  expect(local.getItem(global)).not.toBeNull();
});

test('an absent current document still carries only the allowed previous-epoch preferences', () => {
  installAppIdentity(WILDSHARD_IDENTITY);
  const local = new MemoryStorage();
  local.setItem(`${WILDSHARD_IDENTITY.previousSavePrefix}device`, JSON.stringify({ keys: {
    devMode: { v: 1, data: true }, 'grid.last-played': { v: 1, data: 'old-progress' },
  } }));
  const store = new SaveStore({ local, session: new MemoryStorage() });
  const diagnostic = store.define({ key: 'boot.trace', scope: 'device', version: 1, schema: v.string(), initial: () => '' });
  expect(diagnostic.write('control')).toBe(true);
  expect(JSON.parse(local.getItem(device) ?? '').keys).toEqual({
    devMode: { v: 1, data: true }, 'boot.trace': { v: 1, data: 'control' },
  });
});
