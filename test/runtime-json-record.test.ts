import * as v from 'valibot';
import { expect,test } from 'vitest';
import { app } from '../src/client/engine/app/runtime';
import { Scope } from '../src/shared/engine/app/scope';
import { bindRuntimeJsonRecord } from '../src/shared/game/plugin/runtimeRows';
import { bindAdventurePersistence } from '../src/shared/game/quest/persistence';
import { bossesSave,elitesSave } from '../src/shared/game/saves';
import rows from './fixtures/engine-lift/pine-persistence.json' with { type: 'json' };
import { pinePin } from './fixtures/engine-lift/pins';
const source = pinePin.product.shardfile;

test('seeds active-epoch Pine records once and reloads current values', () => {
  const instance = 'test-pine-json-old-save', scope = new Scope('old-pine'), next = new Scope('reload-pine');
  const bosses = { 'antler-king': { defeated: true, rewardTaken: false, kills: 2 } };
  const elites = { ironhide: { timer: 20, discovered: true, skinTaken: true, kills: 3, retired: false } };
  // Seed the earlier record layout through the active epoch's public save API.
  expect(bossesSave.write(bosses, instance)).toBe(true);
  expect(elitesSave.write(elites, instance)).toBe(true);
  try {
    const records = bindAdventurePersistence({ app, scope }, source, rows, instance);
    expect(records.bosses.read(instance)).toEqual(bosses);
    expect(records.elites.read(instance)).toEqual(elites);
    expect(() => records.bosses.read('another-cell')).toThrow('another instance');
    expect(() => records.elites.write({}, 'another-cell')).toThrow('another instance');
    const paid = { 'antler-king': { defeated: true, rewardTaken: true, kills: 2 } };
    expect(records.bosses.write(paid, instance)).toBe(true);
    scope.dispose();
    bossesSave.write({}, instance); elitesSave.write({}, instance);
    const resumed = bindAdventurePersistence({ app, scope: next }, source, rows, instance);
    expect(resumed.bosses.read(instance)).toEqual(paid);
    expect(resumed.elites.read(instance)).toEqual(elites);
    expect(() => records.bosses.read(instance)).toThrow('disposed');
  } finally { scope.dispose(); next.dispose(); }
});

test('keeps typed records isolated, validates writes and seeds only the first binding', () => {
  const scope = new Scope('typed-json'), schema = v.record(v.string(), v.pipe(v.number(), v.finite()));
  let reads = 0;
  const legacy = (): Record<string, number> => { reads++; return { count: 1 }; };
  try {
    const first = bindRuntimeJsonRecord({ app, scope }, source, 'pine.bosses', schema, legacy, 'test-record-a');
    expect(first.read()).toEqual({ count: 1 }); expect(reads).toBe(1);
    expect(() => first.write({ count: Number.NaN })).toThrow();
    expect(first.read()).toEqual({ count: 1 });
    expect(first.write({ count: 4 })).toBe(true);
    const same = bindRuntimeJsonRecord({ app, scope }, source, 'pine.bosses', schema, legacy, 'test-record-a');
    expect(same.read()).toEqual({ count: 4 }); expect(reads).toBe(1);
    const other = bindRuntimeJsonRecord({ app, scope }, source, 'pine.bosses', schema, legacy, 'test-record-b');
    expect(other.read()).toEqual({ count: 1 }); expect(reads).toBe(2);
    expect(() => first.write({ count: 7 }, 'test-record-b')).toThrow('another instance');
    expect(other.read()).toEqual({ count: 1 });
  } finally { scope.dispose(); }
});
