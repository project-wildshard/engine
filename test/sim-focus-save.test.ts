// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { createSimHost } from '../src/server/engine/sim';
import { serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// Row 4: the player `playerFocus` follows is the sim's state. A body keeps reading it until the next `focusOn`.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

test('a restore keeps who the host was focused on', () => {
  const host = createSimHost(SIM_LEVEL, { rapier }), bot = host.addPlayer('bot:1', { x: 30, y: 2, z: 30 });
  host.step(); host.focusOn(bot.position);
  expect(host.focusedPlayer.id).toBe('bot:1');
  const saved = snapshotSimHost(host), back = restoreSimHost(SIM_LEVEL, { rapier }, saved, () => undefined);
  expect(back.focusedPlayer.id).toBe('bot:1');
  expect(back.playerFocus.x).toBeCloseTo(bot.position.x, 6);
});

test('a one-player save has no focus to carry', () => {
  const host = createSimHost(SIM_LEVEL, { rapier }); host.step();
  expect(serializeSimSnapshot(snapshotSimHostBytes(host))).not.toContain('"focus"');
});
