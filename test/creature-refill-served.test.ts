import { expect, test } from 'vitest';
import { CreatureRefill, REFILL_WAIT, type RefillEntry } from '../src/server/engine/entities/creatureRefill';

// SERVER-CELLS SC5 (J328): a grid cell never starts over, so a served world refills with one player in it, as a room of two does.
const at = (x: number, z: number): { position: { x: number; z: number } } => ({ position: { x, z } });
const left = { kind: 'boar', variant: 'common', herd: 0, x: 0, z: 0, from: 'creature:1' };

test('a served world with one player in it owes what fell and puts it back', () => {
  const back: RefillEntry[] = [], refill = new CreatureRefill({ players: () => [at(500, 0)], room: () => 9, random: () => .5, spawn: entry => { back.push(entry); }, served: () => true });
  refill.left(left);
  expect(refill.pending).toHaveLength(1);
  for (let t = 0; t < REFILL_WAIT + 5; t += 1) refill.step(1);
  expect(back.map(entry => entry.from)).toEqual(['creature:1']);
  expect(refill.pending).toEqual([]);
});

test('a page with one player still owes nothing', () => {
  const refill = new CreatureRefill({ players: () => [at(500, 0)], room: () => 9, random: () => .5, spawn: () => undefined, served: () => false });
  refill.left(left);
  expect(refill.pending).toEqual([]);
});

test('SC10: the time a cell slept counts toward what it owes', () => {
  const back: RefillEntry[] = [], refill = new CreatureRefill({ players: () => [at(500, 0)], room: () => 9, random: () => .5, spawn: entry => { back.push(entry); }, served: () => true });
  refill.left(left);
  refill.slept(REFILL_WAIT + 1);
  refill.step(1); refill.step(1);
  expect(back.map(entry => entry.from)).toEqual(['creature:1']);
});
