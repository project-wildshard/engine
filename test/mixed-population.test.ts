import {lendDriftwoodReturns} from './fixtures/driftwood-return-modules';
import { installMixedPopulation } from '@wildshard/engine/game/population/mixedRoster';
import { orchardPopulation } from './fixtures/mixed-population';
// oxlint-disable-next-line import/no-nodejs-modules -- Real Rapier exercises the native host.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { createSimHost } from '../src/server/engine/sim';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { leadCommands, leadPlayer } from '@wildshard/engine/sim/leadPlayer';


test('mixed orchard roster replaces the practice slot and restores its reserved body and volley owner', async () => {
  const R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))), input = orchardPopulation();
  const level = { ...SIM_LEVEL, entities: [] }, host = createSimHost(level, { rapier: R });
  let restored: ReturnType<typeof createSimHost> | undefined;
  try {
    lendDriftwoodReturns(host.scope);
    const population = installMixedPopulation(host, input), first = population.bodies()[0]?.actor;
    if (first === null || first === undefined) throw new Error('Missing orchard practice body');
    first.alive = false; first.hp = 0; leadPlayer(host).position.set(-10, 0, -10);
    for (let i = 0; i < 60; i++) host.step(leadCommands(host, { moveX: 0, moveZ: 0, yaw: 0 }));
    expect(population.bodies()).toHaveLength(1);
    expect(population.bodies()[0]?.id).toBe('creature:1');
    expect(population.bodies()[0]?.actor?.alive).toBe(true);
    const guardian = population.spawnCaptain(); expect(guardian.entityId).toBe('creature:2');
    expect(() => population.spawnCaptain()).toThrow('once');
    population.publishPoses();
    const saved = snapshotSimHost(host);
    restored = restoreSimHost(level, { rapier: R }, saved, owner => {
      lendDriftwoodReturns(owner.scope);
      const resumed = installMixedPopulation(owner, orchardPopulation(), saved); resumed.settle();
      expect(resumed.bodies().map(row => row.id)).toEqual(['creature:1']);
      expect(resumed.captain()?.entityId).toBe('creature:2');
    });
    expect(snapshotSimHost(restored)).toEqual(saved);
    for (let i = 0; i < 6; i++) { host.step(leadCommands(host, { moveX: 0, moveZ: 0, yaw: 0 })); restored.step(leadCommands(restored, { moveX: 0, moveZ: 0, yaw: 0 })); }
    expect(snapshotSimHost(restored)).toEqual(snapshotSimHost(host));
  } finally { host.dispose(); restored?.dispose(); }
});
