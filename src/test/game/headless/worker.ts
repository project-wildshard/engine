// oxlint-disable-next-line import/no-unassigned-import -- Install portable Math before simulation modules.
import '../../../shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- The isolated proof owns the native physics bytes.
import { readFileSync } from 'node:fs';
import * as v from 'valibot';
import { runTickWorker } from '../../../server/host/tickWorkerLoop';
import { parseShardfile } from '../../../shared/host/shardfile';
import { loadRapier } from '../../../shared/engine/physics/rapier';
import { prepareAssetDecoders, offlineMemoryAdmission } from '@wildshard/format/shardfileAssets';
import { validateShardfileAssets } from '@wildshard/format/assetAdmission';
import { scriptAdmissionRows } from '@wildshard/format/scriptContract';
import { hashImmutableBytes } from '../../../shared/host/immutable';
import { loadHeadlessFolder } from '../../../server/host/headlessFolder';
import { createShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { createNativeProofAdapter } from '../headlessNative';
import type { PrepareHeadlessRuntime } from '../../../server/host/headlessRuntime';

await runTickWorker(async raw => {
  const payload = v.parse(v.strictObject({ shard: v.unknown(), assets: v.map(v.string(), v.instance(Uint8Array)),
    prepare: v.string(), directory: v.exactOptional(v.string()), binary: v.string(),
    sections: v.map(v.string(), v.unknown()), snapshot: v.exactOptional(v.string()) }), raw);
  const module = new URL(payload.prepare);
  if (module.protocol !== 'file:') throw new Error('Native proof prepare module must be a file URL');
  const shard = parseShardfile(payload.shard, payload.sections), rapier = await loadRapier(readFileSync(payload.binary));
  await prepareAssetDecoders();
  validateShardfileAssets(shard, payload.assets, hashImmutableBytes, offlineMemoryAdmission('refuse'), undefined, scriptAdmissionRows(payload.sections), payload.sections);
  const loaded: {prepareHeadlessRuntime?: PrepareHeadlessRuntime} = await import(module.href);
  if (typeof loaded.prepareHeadlessRuntime !== 'function') throw new Error('Native proof module needs prepareHeadlessRuntime');
  const product = payload.directory === undefined
    ? createShardFolder({ slug: shard.identity.slug, revision: shard.identity.revision, shardfile: shard, sections: payload.sections,
      files: new Map(), read: () => Promise.reject(new Error('Inline native proof has no named files')) })
    : await loadHeadlessFolder(payload.directory);
  return createNativeProofAdapter({shard, assets: payload.assets, rapier, product}, loaded.prepareHeadlessRuntime, payload.snapshot);
});
