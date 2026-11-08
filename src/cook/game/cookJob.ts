/** C4 (J28): the part of a cook that touches untrusted bytes. It runs in a child process of its own under time, memory,
 * file and network limits (`cookWorker.ts`), so a hostile shardfile can kill this process and nothing else. Everything
 * here is first-party code reading data; the only foreign code is a shard's wasm, under the sim's fuel limit.
 *
 * Gates, in order: `api-server` already refused what it could (F3 (a)); the cap of D31; the format's product validator
 * again, because this host trusts no other host; the simulation proof (F3 (b)); then the cook. A shard with first-party
 * runtime bindings can't be proved without its trusted recipes, so its proof says `unmeasured` and never invents one. */
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {mkdirSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {dirname, join} from 'node:path';
import {prepareAssetDecoders} from '@wildshard/format/product';
import {validateShardfileProduct, type ValidatedProduct} from '@wildshard/format/productValidation';
import type {Shardfile} from '@wildshard/format/shardSchema';
import {readTar} from '@wildshard/format/tar';
import {cookShard, openShardfile, serverRows, type CookReport, type OpenShardfile, type WireBytes} from './shardCook';
import type {PartEncoder} from './spawnParts';

/** D31: the largest shardfile, stored or decoded: `api-server`'s cap, which Pine's head needs (J137). */
export const MAX_SHARDFILE_BYTES = 450_000_000;
/** A shardfile the cook refuses for what it is. A retry can't change it, unlike a killed child or a lost network. */
export class ShardfileRefusedError extends Error {
  override readonly name = 'ShardfileRefusedError';
}

export interface SimulationProof {readonly ticks: number; readonly lanes: number; readonly steps: number}
export interface CookJobPorts {
  /** Trusted notice identity; reject a valid product for another shard before its simulation/cook. */
  readonly expectedSlug?: string;
  /** F3 (b). Injected: the proof lives in the SDK, above this layer. */
  readonly prove: (shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, sections: ReadonlyMap<string, unknown>) => Promise<SimulationProof>;
  readonly wireBytes: WireBytes;
  readonly now: () => number;
  readonly maxBytes?: number;
  readonly encoder?: PartEncoder;
  readonly warn?: (line: string) => void;
}
export interface ServerPackReport {readonly files: number; readonly bytes: number}
export interface CookJobReport {
  readonly slug: string;
  readonly hash: string;
  readonly proof: SimulationProof | 'unmeasured';
  readonly cook: CookReport;
  readonly header: string;
  readonly server: ServerPackReport;
  readonly seconds: number;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function admit(tarball: Uint8Array, cap: number): ValidatedProduct {
  if (tarball.length > cap) throw new ShardfileRefusedError(`Shardfile is ${tarball.length} bytes, past the ${cap} cap`);
  try {
    const files = readTar(tarball);
    return validateShardfileProduct({
      read: (path, maximum) => { const bytes = files.get(path); if (bytes === undefined || bytes.length > maximum) throw new Error(`No ${path} within ${maximum} bytes`); return bytes; },
      paths: () => files.keys(),
    }, {hash: sha256});
  } catch (error) { throw new ShardfileRefusedError(error instanceof Error ? error.message : 'Shardfile refused', {cause: error}); }
}

/** A failed proof is a verdict on these bytes: another try walks the same lanes. A dead child never reaches this. */
async function proved(product: ValidatedProduct, ports: CookJobPorts): Promise<SimulationProof | 'unmeasured'> {
  try {
    const proof = await ports.prove(product.shard, product.assets, product.sections);
    // A successful empty traversal is not evidence that gameplay was exercised.
    return proof.ticks > 0 && proof.lanes > 0 && proof.steps > 0 ? proof : 'unmeasured';
  }
  catch (error) { throw new ShardfileRefusedError(error instanceof Error ? error.message : 'Simulation proof failed', {cause: error}); }
}

function writeServerPack(shard: OpenShardfile, out: string): ServerPackReport {
  let bytes = 0;
  const paths = serverRows(shard).map(row => row.path);
  for (const path of paths) {
    const body = shard.read(path), file = join(out, path);
    mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, body); bytes += body.length;
  }
  return {files: paths.length, bytes};
}

/** The whole job: `out/client` for the store, `out/server` for the room, and the header a client reads first. */
export async function runCookJob(tarball: Uint8Array, out: string, ports: CookJobPorts): Promise<CookJobReport> {
  const started = ports.now();
  await prepareAssetDecoders();
  const product = admit(tarball, ports.maxBytes ?? MAX_SHARDFILE_BYTES);
  // Match the transport's generic identity allowlist, without shard behavior branches.
  if (ports.expectedSlug !== undefined && !new Set([ports.expectedSlug]).has(product.index.identity.slug)) {
    throw new ShardfileRefusedError(`A shardfile for ${product.index.identity.slug} under ${ports.expectedSlug}`);
  }
  const proof = product.shard.runtime === null ? await proved(product, ports) : 'unmeasured' as const;
  const client = join(out, 'client');
  const cook = await cookShard(tarball, client, {wireBytes: ports.wireBytes, now: ports.now, ...(ports.encoder === undefined ? {} : {encoder: ports.encoder}), ...(ports.warn === undefined ? {} : {warn: ports.warn})});
  // Each manifest names the header at its product URL, and no part holds it (DL18); its `?v=` is what caches it.
  const shard = openShardfile(tarball), header = `shardfiles/${shard.slug}/shard.json`, file = join(client, header);
  mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, shard.header);
  return {slug: product.index.identity.slug, hash: sha256(tarball), proof, cook, header, server: writeServerPack(shard, join(out, 'server')), seconds: (ports.now() - started) / 1000};
}
