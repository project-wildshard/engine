import { expect, test } from 'vitest';
import { ActorMoveRunner, leapArc, type MoveBody } from './moves';
import { actorMoveRules, parseActorMoves } from '@wildshard/format/actorMoves';

/** ONE-FORMAT CC17b: run a leap the way the sim does, one 60 Hz step at a time, applying each placement to the body. */
function fly(row: unknown, start: MoveBody, observe: (body: MoveBody) => object): { peak: number; landed: MoveBody; done: boolean | undefined; steps: number } {
  const move = new ActorMoveRunner(row, start);
  let body = start, peak = start.position.y, done: boolean | undefined, steps = 0;
  while (done === undefined && steps < 600) {
    const frame = move.step({ body, ...observe(body) }); steps += 1;
    if (frame.placement !== undefined) { const p = frame.placement; body = { position: { x: p.x, y: p.y ?? body.position.y, z: p.z }, yaw: p.yaw }; }
    peak = Math.max(peak, body.position.y); done = frame.done;
  }
  return { peak, landed: body, done, steps };
}

test('a 9 m leap to its target peaks at 9 m, lands on the target and fires move-done', () => {
  const start = { position: { x: 2, y: 0, z: -3 }, yaw: 0 }, row = { id: 'wyrm.leap', kind: 'leap', to: { kind: 'target' }, height: 9 };
  const result = fly(row, start, () => ({ target: { x: 14, y: 0, z: 13 } }));
  expect(Math.abs(result.peak - 9)).toBeLessThanOrEqual(0.3);
  expect(Math.hypot(result.landed.position.x - 14, result.landed.position.y, result.landed.position.z - 13)).toBeLessThanOrEqual(0.3);
  expect(result.done).toBe(true);
  expect(result.landed.yaw).toBeCloseTo(Math.atan2(12, 16), 9);
  // Time aloft is the ballistic one: up 9 m and down 9 m under 9.81 m/s².
  expect(result.steps / 60).toBeCloseTo(2 * Math.sqrt(2 * 9 / 9.81), 1);
});

test('a leap aims where its target stood at take-off, and a spot leap lands on the spot height', () => {
  let tx = 10;
  const moving = fly({ id: 'a.leap', kind: 'leap', to: { kind: 'target' }, height: 4 }, { position: { x: 0, y: 0, z: 0 }, yaw: 0 }, () => ({ target: { x: tx++, y: 0, z: 0 } }));
  expect(moving.landed.position.x).toBe(10);
  const spot = fly({ id: 'a.hop', kind: 'leap', to: { kind: 'spot', spot: 'ridge' }, height: 6, gravity: 20 }, { position: { x: 0, y: 1, z: 0 }, yaw: 0.5 },
    () => ({ destination: { x: 0, y: 4, z: 8, yaw: 2 } }));
  expect(spot.landed.position).toEqual({ x: 0, y: 4, z: 8 });
  expect(Math.abs(spot.peak - 7)).toBeLessThanOrEqual(0.3);
  expect(spot.done).toBe(true);
});

test('a landing above the peak fails the move without motion; a resumed leap keeps its arc and never re-aims', () => {
  const body = { position: { x: 0, y: 0, z: 0 }, yaw: 0 };
  expect(new ActorMoveRunner({ id: 'a.leap', kind: 'leap', to: { kind: 'target' }, height: 2 }, body).step({ body, target: { x: 3, y: 5, z: 0 } })).toEqual({ done: false });
  expect(leapArc(2, 9.81, 5)).toBeUndefined();
  const row = { id: 'a.leap', kind: 'leap', to: { kind: 'target' }, height: 9 };
  const move = new ActorMoveRunner(row, body);
  for (let i = 0; i < 30; i += 1) move.step({ body, target: { x: 12, y: 0, z: 0 } });
  const resumed = new ActorMoveRunner(row, body); resumed.restore(structuredClone(move.snapshot()));
  const a = move.step({ body, target: { x: 40, y: 0, z: 0 } }), b = resumed.step({ body });
  expect(b).toEqual(a);
  expect(a.placement?.x).toBeLessThan(12);
  // A leap with neither target nor spot refuses (one fault) and keeps its state.
  const lost = new ActorMoveRunner(row, body), before = lost.snapshot();
  expect(lost.step({ body })).toEqual({});
  expect(lost.snapshot()).toEqual(before);
});

test('leap rows resolve their spot against world spots', () => {
  const rows = parseActorMoves([{ id: 'a.hop', kind: 'leap', to: { kind: 'spot', spot: 'ridge' }, height: 3 }]);
  expect(actorMoveRules(rows, { spots: new Set(), fields: new Set(), strikes: new Set() })).toEqual(['move location resolves in world spots']);
  expect(actorMoveRules(rows, { spots: new Set(['ridge']), fields: new Set(), strikes: new Set() })).toEqual([]);
});
