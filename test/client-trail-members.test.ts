// ONE-FORMAT OF29e7b: a trail that names its members (format OF29e7a) follows those declared spawns' bodies by address, as a
// group's would, so Sky Reach's ray wake needs no `population.homes` row (OF29e7c). A group trail reads its page group.
import { expect, test } from 'vitest';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import type { ShardContext } from '../src/client/game/plugin/context';
import { clientNativeBook } from '../src/client/game/shardfile/clientNativeBook';
import { trailBodies } from '../src/client/game/shardfile/clientTrails';

function page(bodies: Readonly<Record<string, Animal>>): ShardContext {
  const product = { section: () => ({ version: 1, features: [{ kind: 'population.homes', groups: { rays: ['far.ray.1'] } }] }) };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the book reads only the scope and product identities
  const ctx = { scope: { disposed: false, onDispose: () => undefined }, product } as unknown as ShardContext;
  clientNativeBook(ctx).population = { homes: [], all: () => [], held: (id: string) => bodies[id] ?? null };
  return ctx;
}

test('a members trail follows the named spawns, a group trail its page group', () => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- identity stand-ins for the drawn bodies
  const ray0 = { id: 0 } as unknown as Animal, ray1 = { id: 1 } as unknown as Animal;
  const ctx = page({ 'far.ray.0': ray0, 'far.ray.1': ray1 });
  expect(trailBodies(ctx, { members: ['far.ray.0', 'far.ray.1'] }).map(body => body())).toEqual([ray0, ray1]);
  expect(trailBodies(ctx, { group: 'rays' }).map(body => body())).toEqual([ray1]);
  expect(() => trailBodies(ctx, {})).toThrow('A trail names its group or its members');
});
