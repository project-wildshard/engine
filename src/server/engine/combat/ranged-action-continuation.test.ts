import { expect, test } from 'vitest';
import { RangedAction } from '../../../shared/engine/combat/Firearm';

test('borrowed ranged state resumes a reload silently and refuses malformed clocks atomically', () => {
  const state = { loaded: true, reloading: false, reloadProgress: 0, bolts: 3, reserve: 0, ammo: undefined };
  const effects: string[] = [];
  const row = { mode: 'quiver', maximum: 3, interval: 0.3, reload: 1.35, autoReload: 1.4, autoFrom: 'shot' } as const;
  const action = new RangedAction({ state, onDry: () => { effects.push('dry'); },
    onReloadStart: () => { effects.push('reload'); }, onReloadEnd: () => { effects.push('loaded'); } }, row);
  action.trigger(() => { action.shot(); });
  expect(state.bolts).toBe(2);
  expect(action.trigger()).toBe(false);
  action.advance(0.4);
  expect(action.trigger()).toBe(false);
  expect(state.reloading).toBe(true);
  action.advance(0.5);
  const saved = action.snapshot();
  effects.length = 0;
  expect(() => action.restore({ ...saved, cooldown: Number.NaN })).toThrow();
  expect(action.snapshot()).toEqual(saved);
  action.restore({ ...saved, ownerVersion: 1 });
  expect(effects).toEqual([]);
  action.advance(1);
  expect(state.loaded).toBe(true);
  expect(state.bolts).toBe(2);
  expect(effects).toEqual(['loaded']);
  expect(action.trigger()).toBe(true);
});
