import { expect, test } from 'vitest';
import { Interpolator } from '../src/client/engine/net/interpolator';
import { NetDelivery, MAX_HELD_EVENTS } from '../src/client/engine/net/onRep';
import type { DecodedFrame } from '../src/shared/engine/net/frame';
import type { NetCombatEvent, NetDied, NetHit } from '../src/shared/engine/net/messages';
import { ANIMAL_CLASS } from '../src/shared/engine/net/netSchemas';
import type { NetClass } from '../src/shared/engine/net/schema';

// P1-E5.3-F4: events meet the pose they belong to, and an own hit does not wait.
const cls: NetClass<never> = ANIMAL_CLASS;
const index = (name: string): number => cls.row.findIndex(column => column.name === name);
const row = (state: number): Uint32Array => { const out = new Uint32Array(cls.row.length); out[index('state')] = state; return out; };
const frame = (tick: number, state: number): DecodedFrame => ({ tick, baselineTick: 0, cell: 0, lastSeq: 0, owner: new Float64Array(0), ride: null, rows: new Map([[1, row(state)]]), fresh: new Set([1]) });
const died = (tick: number): NetDied => ({ kind: 'died', tick, id: 1, by: 0, dir: [0, 0, 1], impulse: 0 });
const hit = (tick: number, confirmFor: number): NetHit => ({ kind: 'hit', tick, target: 1, amount: 1, at: [0, 0, 0], head: false, killed: false, confirmFor });
function stack(): { lerp: Interpolator; delivery: NetDelivery; played: NetCombatEvent[] } {
  const lerp = new Interpolator(() => cls), delivery = new NetDelivery(lerp, () => cls.cls), played: NetCombatEvent[] = [];
  delivery.onEvent(event => { played.push(event); });
  return { lerp, delivery, played };
}

test('a death waits for the drawn tick, and lands after the pose that goes with it', () => {
  const { lerp, delivery, played } = stack(), order: string[] = [];
  delivery.onRep('animal.state', () => { order.push('pose'); });
  delivery.onEvent(() => { order.push('death'); });
  lerp.push(frame(100, 0)); lerp.push(frame(102, 1));
  delivery.receive(died(102));
  delivery.update(100);
  expect(played).toEqual([]);
  delivery.update(101.9);
  expect(played).toEqual([]);
  delivery.update(102);
  expect(played).toHaveLength(1);
  expect(order).toEqual(['pose', 'death']);
});
test('a hit confirming an own swing plays at once, anyone else\'s waits', () => {
  const { delivery, played } = stack();
  delivery.receive(hit(200, 41)); delivery.receive(hit(200, 0));
  expect(played).toHaveLength(1);
  delivery.update(200);
  expect(played).toHaveLength(2);
});
test('events play in tick order, whatever order they came in', () => {
  const { delivery, played } = stack();
  delivery.receive(died(12)); delivery.receive(died(10)); delivery.receive(died(11));
  delivery.update(20);
  expect(played.map(event => event.tick)).toEqual([10, 11, 12]);
});
test('a first sight is no change, and a stopped clock never loses an event', () => {
  const { lerp, delivery, played } = stack(), seen: unknown[] = [];
  delivery.onRep('animal.state', (_handle, value, was) => { seen.push([was, value]); });
  lerp.push(frame(10, 2)); delivery.update(10);
  expect(seen).toEqual([]);
  for (let tick = 0; tick < MAX_HELD_EVENTS + 5; tick++) delivery.receive(died(tick + 1000));
  expect(played.length).toBe(5);
});
test('a new cell drops what was waiting', () => {
  const { delivery, played } = stack();
  delivery.receive(died(5)); delivery.clear(); delivery.update(100);
  expect(played).toEqual([]);
});
