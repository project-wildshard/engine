import { canoeRow } from './fixtures/engine-lift/canoe';
import { runtimeAssets } from './fixtures/engine-lift/folder';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise real native carry and its physics continuation.
import { loadHeadlessFolder } from '@wildshard/engine/host/headlessFolder';
import { leadCommands,leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect,test } from 'vitest';
import { createSimHost,type SimHost } from '../src/server/engine/sim';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { MoverScriptDriver,type MoverRuntime } from '../src/server/game/plugin/mover';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { emptyShardfile } from '../src/shared/host/author';
import { builtFolder } from './fixtures/engine-lift/folder';
import { createNativeProofResident,prepareFolderPlan } from './fixtures/headless-native';
import { SIM_LEVEL } from './fixtures/sim-level/level';

const row = structuredClone(canoeRow), level = { ...SIM_LEVEL, entities: [] };
function install(host: SimHost): MoverRuntime {
  const source = emptyShardfile({ slug: 'carry-test', name: 'Carry', author: 'Test', revision: 1, seed: 3 });
  return new MoverScriptDriver([row], host).install(host, { content: source, assets: new Map(),
    rules: { fields: {}, archetypes: [], events: [], maxEntities: 32 } }, { id: 'carry-test', drive: true });
}
test.each([180, 539])('native ride at tick %i owns carry/release, blocks walking, and resumes the same mover continuation', async (savedTick) => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost(level, { rapier }), motion = install(host);
  let restored: SimHost | undefined, resumed: MoverRuntime | undefined;
  try {
    motion.command(row.id, 1);
    for (let tick = 0; tick < savedTick; tick++) host.step(leadCommands(host, { moveX: 1, moveZ: 1, yaw: 0 }));
    expect(motion.riding(row.id)).toBe(true);
    const state = snapshotSimHost(host);
    restored = restoreSimHost(level, { rapier }, state, fresh => { resumed = install(fresh); });
    if (resumed === undefined) throw new Error('Missing restored mover');
    for (let tick = savedTick; tick < 550; tick++) {
      host.step(leadCommands(host, { moveX: 0, moveZ: 0, yaw: 0 })); restored.step(leadCommands(restored, { moveX: 0, moveZ: 0, yaw: 0 }));
      expect(leadPlayer(restored).position.distanceTo(leadPlayer(host).position)).toBeLessThan(1e-6);
      if (!motion.riding(row.id)) break;
    }
    expect(motion.riding(row.id)).toBe(false); expect(host.flags.has('secret:islet')).toBe(true);
    const landing = row.carry?.landings[1]; if (landing === undefined) throw new Error('Missing landing');
    expect(leadPlayer(host).position.distanceTo(new Vector3(...landing))).toBeLessThan(1e-6);
    motion.command(row.id, 2);
    for (let tick = 0; tick < 550 && motion.riding(row.id); tick++) host.step();
    expect(motion.riding(row.id)).toBe(false);
    const shore = row.carry?.landings[0]; if (shore === undefined) throw new Error('Missing shore');
    expect(leadPlayer(host).position.distanceTo(new Vector3(...shore))).toBeLessThan(1e-6);
  } finally { restored?.dispose(); host.dispose(); }
});

test('built Pine installs and commands its admitted carry without a shard ride installer', async () => {
  const directory = builtFolder('pine-hollow'), product = await loadHeadlessFolder(directory), source = product.shardfile;
  const descriptor = outputDescriptor(source); if (descriptor === undefined) throw new Error('Missing admitted inventory');
  expect(descriptor.index.files.some(file => file.name === 'movers/canoe.json')).toBe(false);
  const assets = runtimeAssets(product, directory);
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const resident = await createNativeProofResident({ shard: source, product, assets, rapier }, prepareFolderPlan);
  try {
    const admitted = source.movers.find(value => value.id === 'pine.canoe');
    if (admitted?.carry === undefined) throw new Error('Missing admitted carry row');
    for (const [value, end] of [[1, 1], [2, 0]] as const) {
      resident.step([{ kind: 'script', actorId: admitted.id, value }]);
      expect(resident.host.events.ask('player.carrying', false)).toBe(true);
      for (let tick = 0; tick < 545 && resident.host.events.ask('player.carrying', false); tick++) resident.step([]);
      expect(resident.host.events.ask('player.carrying', false)).toBe(false);
      expect(leadPlayer(resident.host).position.distanceTo(new Vector3(...admitted.carry.landings[end]))).toBeLessThan(1e-6);
    }
    expect(resident.host.flags.has('secret:islet')).toBe(true);
  } finally { resident.dispose(); }
}, 10_000);
