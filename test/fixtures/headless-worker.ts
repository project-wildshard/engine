// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- This native Node worker uses the original repository physics binary and loader.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Worker source and loader are fixed native file URLs.
import { pathToFileURL } from 'node:url';
// oxlint-disable-next-line import/no-nodejs-modules -- Publish already compiled parent modules to Node's content-checked cache before the independent worker imports them.
import {flushCompileCache} from 'node:module';
import { TickWorkerHost } from '../../src/server/host/tickWorkerHost';
import type { Shardfile } from '../../src/shared/host/shardfile';
import { headlessSections } from '../../src/shared/host/headlessSections';
import { outputDescriptor } from '../../src/shared/game/shardfile/outputDescriptor';
import { validateShardfileAssets } from '@wildshard/format/assetAdmission';
import { offlineMemoryAdmission, prepareAssetDecoders } from '@wildshard/format/product';
import { scriptAdmissionRows } from '@wildshard/format/scriptContract';
import { hashImmutableBytes } from '../../src/shared/host/immutable';

export type NativeProofKind = 'driftwood' | 'driftwood-trade' | 'sky-verbs' | 'pine' | 'pine-verbs' | 'nine' | 'nine-flat' | 'nalati' | 'nalati-companions' | 'nalati-weapons' | 'nalati-predators' | 'nalati-world' | 'nalati-stealth' | 'nalati-verbs' | 'nalati-kokpar' | 'nalati-chapter' | 'nalati-king' | 'nalati-qara' | 'nalati-titan' | 'nalati-practice' | 'trusted' | 'deferred';

/** One fixed test worker with statically named native factories; no caller-selected code URL. */
export async function createNativeProofWorker(shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, kind: NativeProofKind,
  snapshot?: string, supplied?: ReadonlyMap<string, unknown>, directory = `out/${shard.identity.slug}`): Promise<TickWorkerHost> {
  const sections = headlessSections(supplied ?? outputDescriptor(shard)?.sections);
  flushCompileCache();
  const worker = new TickWorkerHost(new URL('headless/worker.ts', import.meta.url), undefined,
    shard.serverBudget, ['--experimental-transform-types', '--import', pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href], 'advisory', async () => {
      await prepareAssetDecoders();
      validateShardfileAssets(shard, assets, hashImmutableBytes, offlineMemoryAdmission('refuse'), undefined, scriptAdmissionRows(sections));
      const admitted = new Map<string, Uint8Array>();
      for (const hash of [...shard.files.map(file => file.hash), ...shard.requires.commons.map(identity => `commons:${identity}`)]) {
        const bytes = assets.get(hash); if (bytes === undefined) throw new Error('Missing admitted worker bytes'); admitted.set(hash, bytes);
      }
      return {shard, assets: admitted, kind, directory, sections, binary: resolve('public/assets/physics/rapier.wasm'), ...(snapshot === undefined ? {} : {snapshot})};
    });
  try { await worker.initialized(); return worker; } catch (error) { await worker.dispose(); throw error; }
}
