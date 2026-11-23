// oxlint-disable-next-line import/no-unassigned-import -- Install portable Math before simulation modules.
import '../../../shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- The isolated proof owns the native physics bytes.
import { readFileSync } from 'node:fs';
import * as v from 'valibot';
import { runTickWorker } from '../../../server/host/tickWorkerLoop';
import { parseShardfile } from '../../../shared/host/shardfile';
import { loadRapier } from '../../../shared/engine/physics/rapier';
import { prepareAssetDecoders } from '@wildshard/format/shardfileAssets';
import { loadHeadlessFolder } from '../../../server/host/headlessFolder';
import { createShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { createNativeProofAdapter } from '../headlessNative';
import type { PrepareHeadlessRuntime } from '../../../server/host/headlessRuntime';
import { saveRevision } from '../../../shared/game/shardfile/saveRevision';

await runTickWorker(async raw => {
  const payload = v.parse(v.strictObject({ shard: v.unknown(), assets: v.map(v.string(), v.instance(Uint8Array)),
    prepare: v.string(), directory: v.exactOptional(v.string()), binary: v.string(),
    sections: v.map(v.string(), v.unknown()), snapshot: v.exactOptional(v.string()) }), raw);
  const module = new URL(payload.prepare);
  if (module.protocol !== 'file:') throw new Error('Native proof prepare module must be a file URL');
  const shard = parseShardfile(payload.shard, payload.sections), rapier = await loadRapier(readFileSync(payload.binary));
  await prepareAssetDecoders();
  // QA-FEEDBACK-2026-11-23 row 2: this worker's one owner (headlessWorker.ts createNativeProofWorker) admits these exact
  // bytes with validateShardfileAssets in its preparePayload before it sends them. Repeating that here re-hashed every asset
  // on the replay's critical path (~0.5 s of Pine's ~8 s CI21 story locally). The payload must still hold every file.
  for (const hash of [...shard.files.map(file => file.hash), ...shard.requires.commons.map(identity => `commons:${identity}`)])
    if (!payload.assets.has(hash)) throw new Error('Missing admitted worker bytes');
  const loaded: {prepareHeadlessRuntime?: PrepareHeadlessRuntime} = await import(module.href);
  if (typeof loaded.prepareHeadlessRuntime !== 'function') throw new Error('Native proof module needs prepareHeadlessRuntime');
  const product = payload.directory === undefined
    ? createShardFolder({ slug: shard.identity.slug, revision: saveRevision(shard.identity), shardfile: shard, sections: payload.sections,
      files: new Map(), read: () => Promise.reject(new Error('Inline native proof has no named files')) })
    : await loadHeadlessFolder(payload.directory);
  return createNativeProofAdapter({shard, assets: payload.assets, rapier, product}, loaded.prepareHeadlessRuntime, payload.snapshot);
});
