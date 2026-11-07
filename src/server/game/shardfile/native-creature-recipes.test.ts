import { expect, test } from 'vitest';
import { nativeCreatureRecipes } from './homeKeeper';
import { SIM_CREATURE_RECIPE } from '../../../test/game/creatureRecipe';
import type { SimLevel } from '@wildshard/engine/sim';

const SIM_LEVEL: Pick<SimLevel, 'entities'> = { entities: [SIM_CREATURE_RECIPE] };

test('native recipe lookup keeps each duplicate policy and validates saved actor intake before use', () => {
  const row = SIM_LEVEL.entities[0]; if (row === undefined) throw new Error('Missing actual actor recipe');
  const first = row.spec, last = { ...first, label: 'Later recipe' };
  const pine = nativeCreatureRecipes([first, last], 'first'), ordinary = nativeCreatureRecipes([first, last]);
  expect(pine.spec(first.kind, first.variant)).toBe(first);
  expect(ordinary.spec(first.kind, first.variant)).toBe(last);
  expect(() => pine.spec('absent', first.variant)).toThrow('Missing native creature recipe');
  const saved = (recipe: object) => ({ adapters: [{ id: `runtime.actor.${row.id}`, state: JSON.stringify(recipe) }] });
  const decoded = pine.read(saved(row), row.id);
  expect([decoded.id, decoded.seed, decoded.scale, decoded.at, decoded.yaw]).toEqual([row.id, row.seed, row.scale, row.at, row.yaw]);
  expect(decoded.spec.kind).toBe(first.kind); expect(decoded.spec.variant).toBe(first.variant);
  expect(() => pine.read({ adapters: [] }, row.id)).toThrow('Missing saved native creature');
  expect(() => pine.read(saved({ ...row, id: 'foreign' }), row.id)).toThrow('Incompatible saved native creature');
  expect(() => pine.read(saved({ ...row, at: { ...row.at, x: null } }), row.id)).toThrow();
  expect(() => pine.read(saved({ ...row, at: { ...row.at, extra: 1 } }), row.id)).toThrow();
  expect(() => pine.read({ adapters: [{ id: `runtime.actor.${row.id}`, state: 1 }] }, row.id)).toThrow();
  expect(pine.spec(first.kind, first.variant)).toBe(first);
});
