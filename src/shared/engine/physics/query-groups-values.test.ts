import { expect, test } from 'vitest';
import { GROUP, queryGroups, type GroupName } from './groups';

/** Frozen complete query calculation at ad39cfbe9d. */
function original(sees: readonly GroupName[], as: GroupName = 'PLAYER'): number {
  const mask = [...new Set(sees)].reduce((sum, kind) => sum + GROUP[kind], 0);
  return ((GROUP[as] << 16) | mask) >>> 0;
}
const names: readonly GroupName[] = ['WORLD', 'PLAYER', 'CREATURE', 'HITBOX', 'PROJECTILE', 'ITEM', 'DEBRIS', 'BORDER', 'SENSOR'];

test('every group subset, duplicate and order retains every packed native query bit', () => {
  let cases = 0;
  for (let bits = 0; bits < 512; bits++) {
    const sees = names.filter((_name, index) => (bits & (1 << index)) !== 0);
    for (const rows of [sees, [...sees, ...sees], [...sees].reverse()]) for (const as of names) {
      expect(queryGroups(rows, as)).toBe(original(rows, as)); cases++;
    }
    expect(queryGroups(sees)).toBe(original(sees));
  }
  expect(cases).toBe(13824);
});

test('undeclared runtime data keeps the complete original coercion and rejection path', () => {
  for (const sees of [['unknown'], ['WORLD', 'unknown', 'PLAYER'], ['toString', 'WORLD'], ['__proto__'], [undefined], [null]]) {
    expect(Reflect.apply(queryGroups, undefined, [sees])).toBe(Reflect.apply(original, undefined, [sees]));
  }
  for (const sees of [null, undefined])
    expect(Reflect.apply(queryGroups, undefined, [sees])).toBe(Reflect.apply(original, undefined, [sees]));
  for (const sees of [3, {}]) {
    expect(() => { Reflect.apply(original, undefined, [sees]); }).toThrow();
    expect(() => { Reflect.apply(queryGroups, undefined, [sees]); }).toThrow();
  }
});

test('name deduplication still uses original sums when configured group bits overlap', () => {
  const before = GROUP.WORLD;
  try {
    Reflect.set(GROUP, 'WORLD', 3);
    for (const sees of [['WORLD', 'PLAYER'], ['PLAYER', 'WORLD', 'PLAYER'], ['WORLD', 'WORLD']] satisfies GroupName[][])
      expect(queryGroups(sees)).toBe(original(sees));
  } finally { Reflect.set(GROUP, 'WORLD', before); }
});
