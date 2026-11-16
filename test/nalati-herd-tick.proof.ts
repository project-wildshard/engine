// oxlint-disable-next-line import/no-unassigned-import -- Install the server's portable math before its modules load.
import '../src/shared/engine/core/portableMathFirst.ts';
// oxlint-disable-next-line import/no-nodejs-modules -- An explicit outer-edge proof, outside the hook test inventory.
import { test } from 'node:test';
// oxlint-disable-next-line import/no-nodejs-modules -- Assert real server frames and the fixed-tick budget.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Load the ordinary pinned server physics asset.
import { readFileSync } from 'node:fs';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '../src/server/host/headlessRuntime.ts';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder.ts';
import { loadRapier } from '../src/shared/engine/physics/rapier.ts';
import type { AnimalSim } from '../src/shared/engine/entities/AnimalSim.ts';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer.ts';
import { populationCensus } from '../src/shared/game/population/census.ts';
import type { HeadlessCommand } from '../src/shared/host/tickProtocol.ts';
import { builtFolder, runtimeAssets } from './fixtures/engine-lift/folder.ts';

/** Real steering follows the nearest living horse; no controller, body or clock is held. */
function follow(live: TrustedHeadlessResident): { readonly distance: number; readonly commands: readonly HeadlessCommand[] } {
  const player = leadPlayer(live.host), feet = player.position;
  let closest: AnimalSim | undefined;
  let squared = Infinity;
  for (const actor of live.host.entities.values()) if (actor.kind === 'horse' && actor.alive) {
    const distance = actor.position.distanceToSquared(feet);
    if (distance < squared) { closest = actor; squared = distance; }
  }
  assert.ok(closest, 'the complete native product has living horses');
  const dx = closest.position.x - feet.x, dz = closest.position.z - feet.z, distance = Math.hypot(dx, dz);
  return { distance, commands: distance < 4 ? [] : [{ kind: 'player', moveX: dx / distance, moveZ: dz / distance,
    yaw: Math.atan2(-dx, -dz), commandVersion: 1, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, sprint: distance > 8 }] };
}

// Run explicitly, never from pre-commit/pre-push:
// node --experimental-transform-types --import ./scripts/sim-node-loader.mjs --test test/nalati-herd-tick.proof.ts
test('the full Nalati server keeps 60 Hz beside a reacting herd', { timeout: 9500 }, async (): Promise<void> => {
  const directory = builtFolder('nalati-grasslands'), product = await loadHeadlessFolder(directory);
  const live = await createTrustedHeadlessResident({ product, shard: product.shardfile, assets: runtimeAssets(product, directory),
    rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) });
  try {
    const born = populationCensus(live.host), horse = [...live.host.entities.values()].find(actor => actor.kind === 'horse');
    assert.ok(horse);
    assert.equal(born.alive, 35, 'keep the complete authored population');
    // Only the initial player pose is a fixture. The ordinary motor, herd,
    // collisions, sensing, guest programs and every following tick stay live.
    const x = horse.position.x + 8, z = horse.position.z;
    leadPlayer(live.host).resetPose({ x, y: live.host.groundHeightAt(x, z) + 0.5, z }, 0);
    for (let tick = 0; tick < 120; tick++) live.step(follow(live).commands);
    const initial = live.host.state.tick, times: number[] = [];
    let near = 0;
    // Three seconds before this unmounted player loses a galloping herd.
    for (let tick = 0; tick < 180; tick++) {
      const input = follow(live); if (input.distance < 20) near++;
      const start = performance.now(); live.step(input.commands); times.push(performance.now() - start);
    }
    assert.equal(live.host.state.tick, initial + 180, 'no dropped or batched-away simulation ticks');
    assert.ok(near >= 144, `only ${near}/180 frames stayed beside the herd`);
    const final = populationCensus(live.host);
    assert.equal(final.alive, 35);
    assert.ok(final.bodies.some(body => {
      const was = born.bodies.find(row => row.id === body.id);
      return body.kind === 'horse' && was !== undefined && Math.hypot(body.position[0] - was.position[0], body.position[2] - was.position[2]) > 1;
    }), 'living horses actually move');
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]; assert.ok(p95 !== undefined);
    console.info(JSON.stringify({ proof: 'nalati-herd-tick', ticks: 180, near, creatures: final.alive, p95ms: p95, budgetMs: 1000 / 60 }));
    assert.ok(p95 < 1000 / 60, `herd tick p95 ${p95.toFixed(3)} ms exceeds the 60 Hz budget`);
  } finally { live.dispose(); }
});
