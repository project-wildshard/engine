/** C4 (J28): the part of a cook that touches untrusted bytes. It runs in a child process of its own under time, memory,
 * file and network limits (`cookWorker.ts`), so a hostile shardfile can kill this process and nothing else. Everything
 * here is built-in code reading data; the only foreign code is a shard's wasm, under the sim's fuel limit.
 *
 * Gates, in order: `api-server` already refused what it could (F3 (a)); the cap of D31; the format's migration chain and
 * product validator again, because this host trusts no other host; the simulation proof (F3 (b)); then the cook. A shard with built-in
 * runtime bindings can't be proved without its native recipes, so its proof says `unmeasured` and never invents one. */
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {mkdirSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import {dirname, join} from 'node:path';
import {prepareAssetDecoders} from '@wildshard/format/shardfileAssets';
import {validateShardfileFolder, type ValidatedShardfile} from '@wildshard/format/shardfileValidation';
import type {Shardfile} from '@wildshard/format/shardSchema';
import type {ShardfileCheckReport, ShardfileEntryProof} from '@wildshard/engine/game/shardfile/checkReport';
import {migrateShardfile, validateMigrated} from '@wildshard/format/migrate';
import type {FormatMigration} from '@wildshard/format/formatMigrations';
import {readTar, writeTar} from '@wildshard/format/tar';
// D31 (J137), EG-8: the largest shardfile, stored or decoded; shard-format owns it so the API and the cook share it.
import {MAX_SHARDFILE_BYTES} from '@wildshard/format/uploadCaps';
import {cookShard, openShardfile, serverRows, type CookReport, type CookShardPhase, type OpenShardfile, type WireBytes} from './shardCook';
import type {PartEncoder} from './spawnParts';
import type {CookSidecar} from './cookSidecar';
import {cookProvenance, provenanceRefusal, type CookProvenance, type ExpectedCopy} from './cookProvenance';

/** A shardfile the cook refuses for what it is. A retry can't change it, unlike a killed child or a lost network. */
export class ShardfileRefusedError extends Error {
  override readonly name = 'ShardfileRefusedError';
  readonly report: ShardfileCheckReport | undefined;
  constructor(message: string, options?: ErrorOptions & {readonly report?: ShardfileCheckReport}) {
    super(message, options); this.report = options?.report;
  }
}

export type SimulationProof = ShardfileEntryProof;
type CookJobPhase = 'validation' | 'proof' | 'server-files' | CookShardPhase;

export interface CookJobPorts {
  /** Host-owned notice identity; reject a valid product for another shard before its simulation/cook. */
  readonly expectedSlug?: string;
  /** SP19: mandatory full check, composed by the host above this layer. */
  readonly check: (shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, sections: ReadonlyMap<string, unknown>) => Promise<ShardfileCheckReport>;
  readonly wireBytes: WireBytes;
  readonly now: () => number;
  readonly maxBytes?: number;
  readonly encoder?: PartEncoder;
  readonly warn?: (line: string) => void;
  readonly onPhase?: (phase: CookJobPhase, elapsedMs: number) => void;
  /** The renderer fingerprint the worker cooks for (J262); this process's own when unset. */
  readonly renderer?: string;
  /** FE9a: the API's chain and digest for the copy it serves; a different digest under the same chain refuses by slug. */
  readonly expected?: ExpectedCopy;
  /** SP1b4: a cook preparation sidecar on this renderer, taken when the author's preparation is stale. */
  readonly sidecar?: CookSidecar;
  /** FE9d: the chain's steps; the format's registry when unset (a test runs a seeded step through the cook's own admission). */
  readonly migrations?: readonly FormatMigration[];
  /** FORMAT-PRUNE FP27c: the catalogue's armed word for this shard (the cook feed's `armed`), passed to validation. */
  readonly armed?: boolean;
}
export interface ServerPackReport {readonly files: number; readonly bytes: number}
export interface CookJobReport {
  readonly slug: string;
  readonly hash: string;
  readonly proof: SimulationProof | 'unmeasured';
  readonly check: ShardfileCheckReport;
  readonly cook: CookReport;
  readonly header: string;
  readonly server: ServerPackReport;
  readonly seconds: number;
  /** FE9a: the original's format, the chain and the copy's digest; absent when the chain can't read the original. */
  readonly provenance?: CookProvenance;
  /** SA48: what a page's admission row needs of these bytes, from the receipt the validator just held (`cookReceipt`). */
  readonly receipt?: CookReceipt;
}
/** SHARD-AUTHORING SA48: the facts a bake's `folderVerdict` stamps on a page, read here from a product the format's validator has
 *  just admitted, so a page whose build never saw the shard can admit it from the cook's index. The worker stamps its validator
 *  revision beside them (`CookIndex.verdict`), and a page believes them only under its own. */
export interface CookReceipt {readonly sourceHash: string; readonly indexHash: string; readonly residentBytes: number; readonly postCost: unknown; readonly worst?: unknown}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
// SHARD-COMPAT CP10 (J486): a pinned or stored shard file was judged at its upload; memory policy only reports here.
// Spread, so a format before CP10 (which has no `judged` port) still types.
const STORED = {judged: 'stored'} as const;
/** The validation ports a cook admits with: a stored file (CP10), under the catalogue's armed word when the feed gave one (FP27c). */
export const admission = (armed?: boolean): {readonly hash: typeof sha256; readonly judged: 'stored'; readonly armed?: boolean} =>
  ({hash: sha256, ...STORED, ...(armed === undefined ? {} : {armed})});

/** What the cook admits: the validated product, the bytes it cooks, and the chain steps that made them. */
interface Admitted {readonly product: ValidatedShardfile; readonly cooked: Uint8Array; readonly applied: readonly string[]; readonly receipt?: CookReceipt}

const folderOf = (files: ReadonlyMap<string, Uint8Array>): Parameters<typeof validateShardfileFolder>[0] => ({
  read: (path, maximum) => { const bytes = files.get(path); if (bytes === undefined || bytes.length > maximum) throw new Error(`No ${path} within ${maximum} bytes`); return bytes; },
  paths: () => files.keys(),
});

/** CP1: the chain's copy of an original this validator refuses, validated as the API validates a migrated copy. */
function chainedCopy(files: ReadonlyMap<string, Uint8Array>, refusal: unknown, migrations?: readonly FormatMigration[], armed?: boolean): Admitted {
  const chained = migrateShardfile(files, {hash: sha256, ...(migrations === undefined ? {} : {migrations})});
  if (chained.applied.length === 0) throw refusal;
  const preparation = chained.preparation === 'author' ? {preparation: 'author' as const} : {};
  const product = validateMigrated(chained.files, {...admission(armed), ...preparation});
  const receipt = cookReceipt(chained.files);
  return {product, cooked: writeTar(chained.files), applied: chained.applied, ...(receipt === undefined ? {} : {receipt})};
}

/**
 * SHARD-COMPAT CP1 (J486): a stored shard that can migrate keeps working without a re-upload. An original this validator
 * refuses goes through the format's migration chain, as the API's migrated copies do, and the cook cooks that copy, built in
 * memory; the original's bytes are never changed or written (Pine r5 2afc6270, live on production: its `compendiums`
 * predate `journal-glyph-images`, and v0.1.65/.66 refused it). An original that validates cooks as it is, as before, so no
 * working head pays for a copy. A refusal the chain can't repair is the original's refusal.
 */
function admit(tarball: Uint8Array, cap: number, migrations?: readonly FormatMigration[], armed?: boolean): Admitted {
  if (tarball.length > cap) throw new ShardfileRefusedError(`Shardfile is ${tarball.length} bytes, past the ${cap} cap`);
  try {
    const files = readTar(tarball);
    let product: ValidatedShardfile;
    try {
      product = validateShardfileFolder(folderOf(files), admission(armed));
    } catch (refusal) { return chainedCopy(files, refusal, migrations, armed); }
    const receipt = cookReceipt(files);
    return {product, cooked: tarball, applied: [], ...(receipt === undefined ? {} : {receipt})};
  } catch (error) { throw new ShardfileRefusedError(error instanceof Error ? error.message : 'Shardfile refused', {cause: error}); }
}
const object = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** The receipt's facts, held as `buildValidationReceipts` holds a build's own: its index hash is this header's, its source hash the
 *  header's, its residency and post cost present. Anything else is no receipt: the cook still runs, and a page leaves the shard out. */
export function cookReceipt(files: ReadonlyMap<string, Uint8Array>): CookReceipt | undefined {
  const receipt = files.get('validation.json'), header = files.get('shard.json');
  if (receipt === undefined || header === undefined) return undefined;
  try {
    const row: unknown = JSON.parse(new TextDecoder().decode(receipt)), index: unknown = JSON.parse(new TextDecoder().decode(header));
    const indexHash = sha256(header), build = object(index) ? index['build'] : undefined, sourceHash = object(build) ? build['sourceHash'] : undefined;
    if (!object(row) || typeof sourceHash !== 'string' || row['sourceHash'] !== sourceHash || row['indexHash'] !== indexHash) return undefined;
    const {residentBytes, postCost, worst} = row;
    if (typeof residentBytes !== 'number' || !Number.isSafeInteger(residentBytes) || residentBytes <= 0 || !object(postCost)) return undefined;
    return {sourceHash, indexHash, residentBytes, postCost, ...(worst === undefined ? {} : {worst})};
  } catch { return undefined; }
}

/** Only a complete shared check can admit new bytes. Infrastructure errors remain retryable. */
async function checked(product: ValidatedShardfile, ports: CookJobPorts): Promise<ShardfileCheckReport> {
  const report = await ports.check(product.shard, product.assets, product.sections);
  if (!new Set([product.index.identity.slug]).has(report.slug)) throw new Error('The check reported another shard');
  if (report.failures.some(row => row.code === 'check-infrastructure')) throw new Error(report.failures.map(row => row.message).join('\n'));
  if (!report.pass || report.proof === 'refused') {
    throw new ShardfileRefusedError(report.failures.map(row => row.message).join('\n') || 'Full shardfile check refused', {report});
  }
  return report;
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
  const phase = (stage: CookJobPhase): void => { ports.onPhase?.(stage, Math.round(ports.now() - started)); };
  phase('validation');
  await prepareAssetDecoders();
  const {product, receipt, cooked, applied} = admit(tarball, ports.maxBytes ?? MAX_SHARDFILE_BYTES, ports.migrations, ports.armed);
  if (applied.length > 0) ports.warn?.(`cooking the migrated copy (${applied.join(', ')}); the original is unchanged`);
  // Match the transport's generic identity allowlist, without shard behavior branches.
  if (ports.expectedSlug !== undefined && !new Set([ports.expectedSlug]).has(product.index.identity.slug)) {
    throw new ShardfileRefusedError(`A shardfile for ${product.index.identity.slug} under ${ports.expectedSlug}`);
  }
  const provenance = cookProvenance(tarball, sha256, ports.migrations), refused = provenanceRefusal(product.index.identity.slug, provenance, ports.expected);
  if (refused !== undefined) throw new ShardfileRefusedError(refused);
  phase('proof');
  const check = await checked(product, ports);
  const proof = check.proof === 'refused' ? 'unmeasured' : check.proof;
  const client = join(out, 'client');
  const renderer = ports.renderer === undefined ? {} : {renderer: ports.renderer};
  const cook = await cookShard(cooked, client, {wireBytes: ports.wireBytes, now: ports.now, onPhase: phase, ...renderer, ...(ports.encoder === undefined ? {} : {encoder: ports.encoder}), ...(ports.warn === undefined ? {} : {warn: ports.warn}), ...(ports.sidecar === undefined ? {} : {sidecar: ports.sidecar})});
  phase('server-files');
  // Each manifest names the header at its product URL, and no part holds it (DL18); its `?v=` is what caches it.
  const shard = openShardfile(cooked, renderer), header = `shardfiles/${shard.slug}/shard.json`, file = join(client, header);
  mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, shard.header);
  return {slug: product.index.identity.slug, hash: sha256(tarball), proof, check, cook, header, server: writeServerPack(shard, join(out, 'server')), seconds: (ports.now() - started) / 1000,
    ...(receipt === undefined ? {} : {receipt}), ...(provenance === undefined ? {} : {provenance})};
}
