import { expect, test } from 'vitest';
import { ActorMoveRunner } from './moves';
import { actorMoveRules, parseActorMoves } from '@wildshard/format/actorMoves';

test('relocation requests one existing-body placement and never replays it after restore', () => {
  const body = { position: { x: 4, y: 1, z: 6 }, yaw: 0.3 };
  const row = { id: 'test.relocate', kind: 'relocate', point: { kind: 'fields', x: 'actor.burstX', z: 'actor.burstZ' }, facing: 'target' };
  const move = new ActorMoveRunner(row, body);
  expect(move.step({ body, destination: { x: 8, z: 10 }, target: { x: 9, y: 2, z: 11 } })).toEqual({
    placement: { x: 8, z: 10, yaw: Math.atan2(1, 1) }, done: true,
  });
  expect(body).toEqual({ position: { x: 4, y: 1, z: 6 }, yaw: 0.3 });
  const resumed = new ActorMoveRunner(row, body);
  resumed.restore(move.snapshot());
  expect(resumed.step({ body })).toEqual({});
  const spot = new ActorMoveRunner({ id: 'test.home', kind: 'relocate', point: { kind: 'spot', spot: 'arena.home' } }, body);
  expect(spot.step({ body, destination: { x: 3, y: 5, z: 7, yaw: 1.2 } }).placement).toEqual({ x: 3, y: 5, z: 7, yaw: 1.2 });
  const rows = parseActorMoves([row]);
  expect(actorMoveRules(rows, { spots: new Set(), fields: new Set(['actor.burstX']), strikes: new Set() })).toContain('move coordinates resolve in declared actor fields');
  expect(actorMoveRules(rows, { spots: new Set(), fields: new Set(['actor.burstX', 'actor.burstZ']), strikes: new Set() })).toEqual([]);
  const invalid = new ActorMoveRunner(row, body), before = invalid.snapshot();
  expect(invalid.step({body, destination: {x: Infinity, z: 0}, target: body.position})).toEqual({});
  expect(invalid.snapshot()).toEqual(before);
});
