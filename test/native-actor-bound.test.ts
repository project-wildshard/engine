import { expect, test } from 'vitest';
import { NativeActors } from '../src/server/game/population/actors';

const row = (id: string) => ({ id, kind: 'crab', variant: 'plain' });

test('the identity bound holds bodies and recipes: retired history gives way, oldest first', () => {
  const actors = new NativeActors<object>('creature', 2);
  const [first, second, third] = [actors.allocate(), actors.allocate(), actors.allocate()];
  actors.dormant(row(first)); actors.dormant(row(second));
  expect(() => { actors.dormant(row(third)); }).toThrow('Incompatible native actor identity');
  actors.retire(first);
  actors.dormant(row(third));
  expect(actors.identity(first)).toBeNull();
  expect(actors.identity(second)?.state).toBe('dormant');
  expect(actors.identity(third)?.state).toBe('dormant');
  expect(actors.allocate()).toBe('creature:3');
});
