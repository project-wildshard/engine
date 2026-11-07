import { expect, test } from 'vitest';
import { filterCombatAimTargets, type AimTargetExclusion } from '../src/shared/game/shardfile/aimTargetFilter';

// CI12: the extracted aim filter keeps exactly the targets, order and memory reads of clientTargets' original inline filter.
function original<T extends object>(list: readonly T[], exclude: readonly AimTargetExclusion[]): T[] {
  return list.filter(actor => {
    const memory: unknown = 'mem' in actor ? actor.mem : null;
    return typeof memory !== 'object' || memory === null || !exclude.some(rule => rule.field in memory && Reflect.get(memory, rule.field) === rule.equals);
  });
}

test('keeps the same targets in the same order, reading memory the same way', () => {
  const reads: string[] = [], watched = new Proxy({ tamed: 1, owned: 0 }, { get(target, key, receiver): unknown { reads.push(String(key)); const value: unknown = Reflect.get(target, key, receiver); return value; } });
  const list: object[] = [{}, { mem: null }, { mem: 3 }, { mem: { ridden: 1 } }, { mem: { ridden: 0 } }, { mem: { owned: 1, ridden: 0 } }, { mem: watched },
    { mem: Object.create({ ridden: 1 }) }, { mem: { ridden: Number.NaN } }, { mem: { ridden: -0 } }, { name: 'no memory' }];
  const rules: readonly AimTargetExclusion[][] = [[], [{ field: 'ridden', equals: 1 }], [{ field: 'owned', equals: 1 }, { field: 'ridden', equals: 1 }],
    [{ field: 'tamed', equals: 1 }, { field: 'owned', equals: 0 }], [{ field: 'ridden', equals: 0 }]];
  for (const exclude of rules) {
    reads.length = 0; const expected = original(list, exclude), expectedReads = [...reads];
    reads.length = 0; const actual = filterCombatAimTargets(list, exclude);
    expect(actual).toEqual(expected); expect(actual.every((target, i) => target === expected[i])).toBe(true); expect(reads).toEqual(expectedReads);
  }
});
