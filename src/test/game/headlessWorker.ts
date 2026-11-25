// oxlint-disable-next-line import/no-unassigned-import -- Install portable Math before simulation modules.
import '../../shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Locate the packaged loader and physics dependency, independently of the consumer's cwd.
import { createRequire, flushCompileCache } from 'node:module';
import { TickWorkerHost } from '../../server/host/tickWorkerHost';
import type { Shardfile } from '../../shared/host/shardfile';
import { headlessSections } from '@wildshard/format/headlessSections';
import { outputDescriptor } from '../../shared/game/shardfile/outputDescriptor';
import { validateShardfileAssets } from '@wildshard/format/assetAdmission';
import { offlineMemoryAdmission, prepareAssetDecoders } from '@wildshard/format/shardfileAssets';
import { scriptAdmissionRows } from '@wildshard/format/scriptContract';
import { hashImmutableBytes } from '../../shared/host/immutable';

export interface NativeProofWorkerOptions {
  /** The checkpoint to resume from. A promise lets the worker import its modules and admit the product while the caller is
   * still making the checkpoint (QA 11-25 row 59): only the payload waits for it. */
  snapshot?: string | PromiseLike<string>;
  sections?: ReadonlyMap<string, unknown>;
  /** A checked consumer build; omit only for an inline proof with no named files. */
  directory?: string;
  binary?: string;
}

/** Host-owned Node proofs choose their own prepareHeadlessRuntime module. This is
 * executable test code, never a URL supplied by a shardfile or a gameplay command. */
export async function createNativeProofWorker(shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, prepare: URL,
  options: NativeProofWorkerOptions = {}): Promise<TickWorkerHost> {
  if (prepare.protocol !== 'file:') throw new Error('Native proof prepare module must be a file URL');
  const sections = headlessSections(options.sections ?? outputDescriptor(shard)?.sections);
  const binary = options.binary ?? createRequire(import.meta.url).resolve('@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm');
  flushCompileCache();
  const worker = new TickWorkerHost(new URL('./headless/worker.ts', import.meta.url), undefined,
    shard.serverBudget, ['--import', new URL('../../../scripts/sim-node-loader.mjs', import.meta.url).href], 'advisory', async () => {
      await prepareAssetDecoders();
      validateShardfileAssets(shard, assets, hashImmutableBytes, offlineMemoryAdmission('refuse'), undefined, scriptAdmissionRows(sections), sections);
      const admitted = new Map<string, Uint8Array>();
      for (const hash of [...shard.files.map(file => file.hash), ...shard.requires.commons.map(identity => `commons:${identity}`)]) {
        const bytes = assets.get(hash); if (bytes === undefined) throw new Error('Missing admitted worker bytes'); admitted.set(hash, bytes);
      }
      const snapshot = await options.snapshot;
      return {shard, assets: admitted, prepare: prepare.href, sections, binary,
        ...(options.directory === undefined ? {} : {directory: options.directory}),
        ...(snapshot === undefined ? {} : {snapshot})};
    });
  try { await worker.initialized(); return worker; } catch (error) { await worker.dispose(); throw error; }
}
