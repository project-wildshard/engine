// ONE-FORMAT OF20b: Sky Reach's flock moves to declared rows beside its runtime plan, whose keeper keeps only the held
// Storm Roc (OF20c moves it). Sky's plan stands its creatures on its solids (`floor: 'solids'`, the isles over an open
// sky) and kills them under its death plane (`killY`), so declared bodies beside it must meet the same world: a goat
// stands on its isle rather than falling through to the analytic floor 1 km down, and one off the rim dies by the fall.
// Since Sky r7 (OF20c) the shipped product declares the flock and the Roc itself, so the fixture is that product as shipped.
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseNativeRuntimePlan } from '@wildshard/format/nativeRuntimePlan';
import { loadHeadlessFolder } from '@wildshard/engine/host/headlessFolder';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { createNativeHeadlessResident, type HeadlessRuntimeInput } from '../src/server/host/headlessRuntime';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { canonicalSimDigest } from '../src/test/engine/simState';
import { builtFolder, runtimeAssets } from './fixtures/engine-lift/folder';

const ROC = 'far.roc', RAY = 'far.ray.0';
type Plan = ReturnType<typeof parseNativeRuntimePlan>;

/** The shipped product: since Sky r7 its flock and its Roc are declared spawns beside a keeper-less runtime plan. */
async function sky(): Promise<HeadlessRuntimeInput> {
  const directory = builtFolder('far-reach'), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing verified Sky Reach product');
  return { shard: product.shardfile, assets: runtimeAssets(product, directory), sections: new Map(descriptor.sections),
    rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) };
}

test('Sky Reach\'s flock runs as declared rows beside the declared Roc, on the plan\'s solids and under its death plane', async () => {
  const cell = await sky(), resident = await createNativeHeadlessResident(cell), { host } = resident;
  const spawns = cell.shard.creatures.spawns, GOATS = spawns.filter(row => row.id.startsWith('far.goat.'));
  expect(GOATS.length).toBeGreaterThan(0);
  let restored: Awaited<ReturnType<typeof createNativeHeadlessResident>> | undefined;
  try {
    const player = leadPlayer(host), ray = host.entities.get(RAY);
    if (ray === undefined) throw new Error('Missing declared ray');
    let blows = 0;
    host.events.on('damage.dealt', ({ req }) => { if (req.target === player.health) blows++; }, host.scope);
    // the player waits on the deck under the first ray's orbit: it stalks and dives on them
    for (let tick = 0; tick < 900; tick++) {
      player.position.set(20, 30.2, -62); player.velocity.set(0, 0, 0); player.health.attributes.health = player.health.attributes.maxHealth;
      resident.step([]);
    }
    expect(blows).toBeGreaterThan(0);
    for (const row of spawns) expect(host.entities.get(row.id)?.alive, row.id).toBe(true);
    expect(host.entities.get(ROC)?.alive).toBe(true);
    // every goat grazes its own isle's top, not the analytic floor below the sky
    for (const row of GOATS) {
      const goat = host.entities.get(row.id), home = row.home;
      if (goat === undefined || home === undefined) throw new Error(`Missing goat ${row.id}`);
      expect(Math.abs(goat.position.y - home.y), row.id).toBeLessThan(1);
      expect(goat.levelGround, row.id).toBe(true);
    }
    // a save restores the declared flock exactly
    restored = await createNativeHeadlessResident(cell, serializeSimSnapshot(snapshotSimHostBytes(host)));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(host)));
    // a goat off the rim falls through the plan's death plane and dies by the fall
    const goat = host.entities.get('far.goat.0'), plane = cell.sections?.get('sim/runtime-plan') as Plan | undefined;
    const killY = plane?.recipe.population.rows.killY;
    if (goat === undefined || killY === undefined) throw new Error('Missing goat or death plane');
    goat.place(goat.position.x + 60, goat.position.z, 0, killY - 1);
    resident.step([]);
    expect(goat.alive).toBe(false);
  } finally { restored?.dispose(); resident.dispose(); }
}, 120_000);
