import { expect, test } from 'vitest';
import { stepCreatureLift } from '../../../shared/game/plugin/animation';

test('lift retains flag order, floor response and saved continuation, refusing invalid frames quietly', () => {
  const actor = { mem: { init: 1, rise: .9, rising: 1, sinking: 1, floor: 3, floorS: 1 }, yOffset: -4 };
  stepCreatureLift(actor, .2, 1, 1, -2.3, 6);
  expect(actor.mem.rising).toBe(0); expect(actor.mem.sinking).toBe(1);
  expect(actor.mem.rise).toBeGreaterThan(0); expect(actor.mem.rise).toBeLessThan(1);
  expect(actor.mem.floorS).toBeGreaterThan(1); expect(actor.yOffset).toBeLessThan(actor.mem.floorS);
  const resumed = { mem: { ...actor.mem }, yOffset: actor.yOffset };
  stepCreatureLift(actor, .3, 1, 1, -2.3, 6); stepCreatureLift(resumed, .3, 1, 1, -2.3, 6);
  expect(resumed).toEqual(actor);
  stepCreatureLift(actor, 2, 1, 1, -2.3, 6); expect(actor.mem.sinking).toBe(0);
  const saved = { mem: { ...actor.mem }, yOffset: actor.yOffset };
  expect(() => stepCreatureLift(actor, -1, 1, 1, -2.3)).toThrow('lift');
  expect(() => stepCreatureLift(actor, .1, 0, 1, -2.3)).toThrow('lift');
  expect(() => stepCreatureLift(actor, .1, 1, 1, Infinity)).toThrow('lift');
  expect(() => stepCreatureLift(actor, .1, 1, 1, -2.3, Number.NaN)).toThrow('lift');
  expect(actor).toEqual(saved);
  const flags = { rising: actor.mem.rising, sinking: actor.mem.sinking };
  stepCreatureLift(actor, .4, 1, 1, -2.3, undefined, 'up');
  expect(actor.mem.rise).toBeGreaterThan(0); expect(actor.mem).toMatchObject(flags);
});
