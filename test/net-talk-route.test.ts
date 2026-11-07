import { expect, test } from 'vitest';
import type { ActRoutes } from '../src/shared/engine/sim/actRoutes';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { netInteractCommands, netPlayerCommand } from '../src/shared/host/standalone/netInput';

const routes = (rows: readonly [string, number][]): ActRoutes => ({ interactions: new Map(rows.map(([id, value]) => [id, { actorId: 'quest', value }])), claims: new Map(), seen: null, refused: 0 }) as unknown as ActRoutes;
const press = (id: string): readonly { kind: 'interact'; seq: number; id: string }[] => [{ kind: 'interact', seq: 1, id }];

test('a page names a person, and a quest with one person calls that row talk', () => {
  expect(netInteractCommands(routes([['talk', 3]]), press('far.keeper.talk'), 'p')).toEqual([{ kind: 'script', actorId: 'quest', value: 3, playerId: 'p' }]);
});
test('a person with their own row keeps it, and no other id falls through to talk', () => {
  const both = routes([['talk', 3], ['castaway.talk', 7]]);
  expect(netInteractCommands(both, press('castaway.talk'), 'p')).toEqual([{ kind: 'script', actorId: 'quest', value: 7, playerId: 'p' }]);
  expect(netInteractCommands(both, press('logbook'), 'p')).toEqual([]);
  expect(both.refused).toBe(1);
});
test('a held item\'s second action crosses on its own button', () => {
  const command: Parameters<typeof netPlayerCommand>[0] = { seq: 1, viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: NET_BUTTONS.secondary };
  expect(netPlayerCommand(command).secondary).toBe(true);
  expect(netPlayerCommand({ ...command, buttons: 0 }).secondary).toBeUndefined();
});
