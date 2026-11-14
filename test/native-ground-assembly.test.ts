import { prepareFolderPlan as prepareHeadlessRuntime } from './fixtures/headless-native';
// oxlint-disable-next-line import/no-nodejs-modules -- Native checkpoint regression uses the shipped physics module.
import { readFileSync } from 'node:fs';
import { expect,test } from 'vitest';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { builtFolder } from './fixtures/builtFolder';
import { decodeTerrainTile } from '@wildshard/format/terrainTileBytes';
import type { BakedGrid } from '@wildshard/format/bakedTerrainBytes';
import { createSimHost,type SimHost } from '../src/server/engine/sim';
import { snapshotSimHost, serializeSimSnapshot, decodeSimSnapshot } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { canonicalSimDigest } from './fake/simState';
import { nalatiNativeAssets } from './proof/nalati-grasslands/nativeAssets';
import { leadCommands } from '@wildshard/engine/sim/leadPlayer';

// Frozen pre-consolidation decoder: the independent old sampling admission and storage law.
function originalTerrain(bytes: Uint8Array | undefined,seed: number,row: { resolution: number;size: number }): BakedGrid {
  const tile = bytes === undefined ? null : decodeTerrainTile(bytes);
  if (tile?.splat === undefined || tile.colours !== undefined || tile.resolution !== row.resolution || tile.size !== row.size
    || tile.x !== -row.size/2 || tile.z !== -row.size/2) throw new Error('Native population needs its admitted query terrain sampling');
  return { res: tile.resolution,size: tile.size,seed,landscapeHash: 0,heights: tile.heights,splat: tile.splat,undergrowth: null };
}
test('declared sampling rows retain the original native checkpoint and restore suffix',async () => {
  const product = await loadHeadlessFolder(builtFolder('nalati-grasslands')),rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const context={shard:product.shardfile,assets:nalatiNativeAssets(product.shardfile),rapier,product};
  // The shipped decoder keeps the frozen admission and storage law, row for row.
  const sampling=product.shardfile.terrain?.sampling,bytes=sampling===undefined?undefined:context.assets.get(sampling.file),row={resolution:256,size:500,seed:context.shard.identity.seed};
  expect(decodeTerrainTile(bytes,row)).toEqual(originalTerrain(bytes,row.seed,row));
  const baseline=await prepareHeadlessRuntime(context);
  const candidate=await prepareHeadlessRuntime(context);
  const oldHost = createSimHost(baseline.level,{ ...baseline.ports,rapier }),nextHost = createSimHost(candidate.level,{ ...candidate.ports,rapier });
  let restored: SimHost | undefined;
  const effects = { commands: () => [],emit: () => undefined },step = (host: SimHost): void => { host.step(leadCommands(host, { moveX: .3*Math.sin(host.state.tick/90),moveZ: -1,yaw: 0 })); };
  try {
    baseline.install(oldHost,{ restoring: false,...effects });candidate.install(nextHost,{ restoring: false,...effects });
    for (let i=0;i<100;i++) { step(oldHost);step(nextHost); }
    const saved = serializeSimSnapshot(snapshotSimHost(oldHost));expect(serializeSimSnapshot(snapshotSimHost(nextHost)) === saved).toBe(true);
    const decoded = decodeSimSnapshot(saved);expect(serializeSimSnapshot(decoded) === saved).toBe(true);
    for (let i=0;i<30;i++) { step(oldHost);step(nextHost); }
    const continued = canonicalSimDigest(snapshotSimHost(oldHost));
    expect(canonicalSimDigest(snapshotSimHost(nextHost))).toBe(continued);
    // A restored world gets its own preparation/field owner, as an independent native entry does.
    const freshPlan = await prepareHeadlessRuntime(context);
    restored = restoreSimHost(freshPlan.level,{ ...freshPlan.ports,rapier },decoded,fresh => { freshPlan.install(fresh,{ restoring: true,snapshot: decoded,...effects }); });
    expect(canonicalSimDigest(snapshotSimHost(restored))).toBe(canonicalSimDigest(saved));
    for (let i=0;i<30;i++) step(restored);
    expect(canonicalSimDigest(snapshotSimHost(restored))).toBe(continued);
  } finally { restored?.dispose();nextHost.dispose();oldHost.dispose(); }
},120_000);
