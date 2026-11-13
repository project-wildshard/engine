// oxlint-disable-next-line import/no-nodejs-modules -- Boots the shipped product bytes and physics module.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { installedKeys } from '../src/server/game/shardfile/installedSides';
import { openWorld, openWorldAdapter } from '../src/server/host/openWorld';
import { builtProduct, runtimeAssets } from './fixtures/engine-lift/product';

// SERVER-PARITY HS1 (meta docs/plans/SERVER-PARITY-PLAN.md): one world-build entry. Every pinned product boots as a room
// (`openWorld(input, { room: true })`, a dedicated room's own call) and, a native world, through the headless tick adapter a
// shard's CI journeys and the bake worker run; both hosts carry the same fixed-step owners and server halves. Before HS1 the adapter booted the bare
// resident: no chapters, doors, discoveries or owned book, so Nalati's taming journey installed its chapters by hand.
const pins = (JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as { shards: readonly { slug: string }[] }).shards.map(pin => pin.slug);

describe('open world: the room and the tick adapter step the same owners', { concurrent: false }, () => {
  for (const slug of pins) test(slug, async () => {
    const directory = builtProduct(slug === 'template' ? '_template' : slug);
    if (!existsSync(directory)) throw new Error(`${slug} is pinned but not installed: pnpm pins`);
    const product = await loadHeadlessProduct(directory);
    const input = { shard: product.shardfile, product, assets: runtimeAssets(product, directory), rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) };
    const room = await openWorld(input, { room: true });
    try {
      const owners = room.host.stepIds();
      if (room.resident === undefined) { await expect(openWorldAdapter(input), `${slug}: a data cell`).rejects.toThrow('native world'); return; }
      const adapter = await openWorldAdapter(input);
      try {
        expect(adapter.host.stepIds(), `${slug}: the tick adapter`).toEqual(owners);
        expect([...installedKeys(adapter.host)].sort(), `${slug}: the tick adapter's server halves`).toEqual([...installedKeys(room.host)].sort());
        // the adapter steps: a CI journey ticks this world, and its lead's fall floor is the room's
        for (let tick = 0; tick < 3; tick++) adapter.step([]);
        expect(adapter.commit().tick).toBe(3);
      } finally { adapter.dispose(); }
    } finally { room.dispose(); }
  }, 180_000);
});

// A saved room world continues identically: the bake worker and a shard's CI resume a native world from the adapter's commit,
// and every byte of the next steps (the physics included) matches the world that never stopped.
describe('open world: a saved world continues identically through the tick adapter', { concurrent: false }, () => {
  for (const slug of pins) test(slug, async () => {
    const directory = builtProduct(slug === 'template' ? '_template' : slug), product = await loadHeadlessProduct(directory);
    const input = { shard: product.shardfile, product, assets: runtimeAssets(product, directory), rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) };
    const probe = await openWorld(input, { room: true }), native = probe.resident !== undefined; probe.dispose();
    if (!native) return;
    const control = await openWorldAdapter(input);
    try {
      for (let tick = 0; tick < 60; tick++) control.step([{ kind: 'player', moveX: 0, moveZ: -1, yaw: 0, commandVersion: 1 }]);
      const resumed = await openWorldAdapter(input, control.commit().snapshot);
      try {
        for (let tick = 0; tick < 3; tick++) {
          const commands = [{ kind: 'player' as const, moveX: 0, moveZ: -1, yaw: 0, commandVersion: 1 as const }];
          control.step(commands); resumed.step(commands);
          expect(resumed.commit(), `${slug}: tick ${tick} after the resume`).toEqual(control.commit());
        }
      } finally { resumed.dispose(); }
    } finally { control.dispose(); }
  }, 180_000);
});

test('Nalati\'s tick adapter runs its story on the server with no hand-installed chapters', async () => {
  const directory = builtProduct('nalati-grasslands'), product = await loadHeadlessProduct(directory);
  const adapter = await openWorldAdapter({ shard: product.shardfile, product, assets: runtimeAssets(product, directory), rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) });
  try { expect(installedKeys(adapter.host).has('saves'), 'serverChapters registered its feat counts and bond').toBe(true); } finally { adapter.dispose(); }
}, 180_000);
