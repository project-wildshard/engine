// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { createSimHost, type SimHost } from '../src/server/engine/sim';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { BossBounty } from '../src/server/game/boss/bounty';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// Flip checklist 1: a served world is a room with one player in it. A boss's share has to reach that one player.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });
const hostOf = (served: boolean, others: readonly string[] = []): SimHost => {
  const host = createSimHost(SIM_LEVEL, { rapier });
  host.respawn.served = served;
  for (const id of others) host.addPlayer(id, { x: 1, y: 0, z: 1 });
  return host;
};
test('alone in a served world the boss\'s share is the player\'s, once', () => {
  const host = hostOf(true), bounty = new BossBounty(host, () => null, 'fight'), paid: string[] = [], [only] = host.players.keys();
  expect(bounty.room).toBe(true);
  bounty.pay(50, player => { paid.push(player); }, 'body');
  bounty.pay(50, player => { paid.push(player); }, 'body');
  expect(paid).toEqual([only]);
  expect(bounty.take(only ?? ''), 'and it was taken').toBe(false);
});

test('a page\'s own world stays out of it: its lone player\'s reward is the row\'s', () => {
  expect(new BossBounty(hostOf(false), () => null, 'fight').room).toBe(false);
});

test('a room pays only those who earned it', () => {
  const host = hostOf(true, ['b']), bounty = new BossBounty(host, () => null, 'fight');
  expect(bounty.owed).toEqual([]);
  bounty.award(['b']);
  expect(bounty.owed).toEqual(['b']);
});
