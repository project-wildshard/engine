import { outputBlobPath } from '@wildshard/format/outputAddress';
import { packOrLoose, packReads } from './packReads';
import type { OutputIndex } from '@wildshard/format/outputIndex';
import { assembleOutputTransport } from '@wildshard/format/outputFields';
import { isJsonDataWithFileSchemas } from '@wildshard/format/json';
import { builtValidationReceipt, builtShardfileResidency, validationSourceBytes, validationSourceBytesPaced, type ValidationReceipt } from '@wildshard/format/validationReceipt';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { parseOutputLineageIndex } from '@wildshard/format/stateLineage';
import type { Shardfile } from '@wildshard/format/shardSchema';

/** Trusted checked-ingestion capability, supplied explicitly by Node author readers. */
/**
 * Whether a server reads this file: its terrain collider, and the bin, json and wasm that hold collision, navigation and
 * scripts. Models, textures, sound and the view's terrain tiles stay on the page. C2's server packs replace this.
 */
export function serverReadsFile(file: Pick<OutputIndex['files'][number], 'kind' | 'hash'>, terrain: string | undefined): boolean {
  return file.kind === 'bin' || file.kind === 'json' || file.kind === 'wasm' || (file.kind === 'tile' && terrain?.endsWith(file.hash) === true);
}
export interface OutputDescriptorChecks {
  readonly parseIndex: (input: unknown) => OutputIndex | null;
  readonly assemble: (index: OutputIndex, sections: ReadonlyMap<string, unknown>) => Shardfile;
}
/** Byte readers are injected: the section adapter runs in browsers and renderer-free Node admission. */
export interface OutputDescriptorReader {
  /** Build-owned browser transport; the producer already checked these files.
   * Authored JSON cannot supply this capability. Node/external readers omit it. */
  built?: {readonly read:(path:string,bytes:number,hash?:string)=>Promise<Uint8Array>;readonly indexHash:string};
  /** Node author bundles supply their defining checked port; authored JSON cannot provide it. */
  checks?: OutputDescriptorChecks;
  /** Optional live parser; hashes, receipts and all admission checks remain here. */
  parseJson?: (bytes: Uint8Array) => Promise<unknown>;
  /** Admission will declare its device-selected asset bank after section verification. */
  deferAssetDeclarations?: boolean;
  /** Expected sizes come from the parsed product index, before any section reads. */
  declare?: (path: string, bytes: number) => void;
  read: (path: string, maximum: number) => Promise<Uint8Array>;
  /** I5: read a pack (relative path, exact size); a packed section missing from the cache then comes from its pack */
  pack?: (path: string, maximum: number, members: NonNullable<OutputIndex['packs']>[number]['entries']) => Promise<Uint8Array>;
  /** I5: a section served from its pack (no request of its own) completes its declared path. */
  packedHit?: (path: string, hash: string) => void;
  hash: (bytes: Uint8Array) => Promise<string>;
  /** Trusted transport returns owned bytes already checked against this exact hash and size.
   * `stored` proves durable content-cache persistence, not merely a scheduled write. */
  verified?: (hash: string, path: string, maximum: number) => Promise<{ bytes: Uint8Array; cached: boolean; stored: boolean } | null>;
  /** Only the private content-cache port may return verified owned bytes. Raw
   * cache hints still pass the page hash; both retain the same bounded hint turn. */
  cached?: (hash: string, path: string, maximum: number) => Promise<Uint8Array | { readonly verified: Uint8Array } | null>;
  /** Online packed sections may leave a slow cache hint after this visible turn.
   * Offline reads still await durable bytes; every fallback pack/member is verified. */
  cacheHintTurn?: (signal: AbortSignal) => Promise<void>;
  /** A verified cache hit also completes its named section/schema path. */
  cacheHit?: (path: string, hash: string, bytes: number) => void;
  store?: (hash: string, bytes: Uint8Array) => Promise<boolean>;
  /** Lazy online page reads build verified network bytes before best-effort persistence completes. */
  backgroundStore?: (hash: string, bytes: Uint8Array) => Promise<boolean>;
  /** A client may let its loading panel draw between complete schema checks. */
  pause?: () => Promise<void>;
  offline: boolean;
  /** Only a matching build-pinned index and source receipt permits unchecked assembly. */
  firstParty?: boolean;
  /** A previous visit read for its state lineage only: all sections remain hash-checked, but only identity/state are
   * returned, never admitted. The portable reader ignores obsolete host declarations; the caller checks state semantics. */
  lineage?: boolean;
}

export interface OutputDescriptor {
  readonly built?:true;
  readonly residentBytes?:number;
  readonly index: OutputIndex;
  readonly sections: ReadonlyMap<string, unknown>;
  readonly cached: boolean;
  /** Background section writes settle here; explicit offline publication still awaits durable proof. */
  readonly cacheStored?: Promise<boolean>;
  readonly indexHash: string;
  readonly receipt?: ValidationReceipt;
}
// Existing hosts consume the unchanged Shardfile shape. Keying by its files array
// also preserves location through the hosts' shallow presentation-only copies.
const descriptors = new WeakMap<object, OutputDescriptor>();
const buildValidated = new WeakSet();
async function descriptorChecks(reader: OutputDescriptorReader): Promise<OutputDescriptorChecks> {
  if (reader.checks !== undefined) return reader.checks;
  // Vite erases this checked closure from client builds. Explicit native ports
  // work in author bundles even when their Vite environment is client-shaped.
  if (!(import.meta.env?.SSR ?? true)) throw new Error('Shardfile needs server validation before client admission');
  return (await import('./outputChecksNode')).nodeOutputDescriptorChecks;
}

/** A visited index is not an offline copy when any of its section bytes were evicted. */
export class IncompleteOutputCacheError extends Error {
  constructor() { super('Shardfile needs a connection: incomplete section cache'); this.name = 'IncompleteOutputCacheError'; }
}

/** Only the exact root verified against the build receipt has the schema-output proof. */
export function isBuildValidatedOutput(value: unknown): value is Shardfile {
  return typeof value === 'object' && value !== null && buildValidated.has(value);
}

/** The admitted v2 index and parsed sections, if this source came from a split output. */
export function outputDescriptor(source: { readonly files: object }): OutputDescriptor | undefined { return descriptors.get(source.files); }

/** Carry verified transport metadata across the existing parser's owned copy. */
export function carryOutputDescriptor(from: unknown, to: Shardfile): void {
  if (typeof from !== 'object' || from === null || !('files' in from) || !Array.isArray(from.files)) return;
  const descriptor = descriptors.get(from.files);
  if (descriptor !== undefined) descriptors.set(to.files, descriptor);
}

// The build receipt proves the schema output type; callers cannot provide a
// receipt through data. Both digests are computed from the actual decoded input.
function buildValidatedSource(value: unknown, sourceHash: string, indexHash: string): value is Shardfile {
  return typeof value === 'object' && value !== null && builtValidationReceipt(sourceHash, indexHash) !== null;
}

function receiptBytes(value: unknown, reader: OutputDescriptorReader): Uint8Array | Promise<Uint8Array> {
  return reader.pause === undefined ? validationSourceBytes(value) : validationSourceBytesPaced(value, reader.pause, diagnosticNow);
}
function indexReceipt(value: unknown, digest?: string): ValidationReceipt | null {
  if (typeof value !== 'object' || value === null) return null;
  const build: unknown = Object.getOwnPropertyDescriptor(value, 'build')?.value;
  if (typeof build !== 'object' || build === null) return null;
  const sourceHash: unknown = Object.getOwnPropertyDescriptor(build, 'sourceHash')?.value;
  return typeof sourceHash === 'string' ? builtValidationReceipt(sourceHash, digest) : null;
}
// The build-owned digest proves this schema output. An authored receipt cannot
// enter the table; the digest below is computed from the actual owned values.
function buildValidatedIndex(value: unknown, digest: string): value is OutputIndex {
  return indexReceipt(value, digest) !== null;
}
async function ownedBuildIndex(input: unknown, reader: OutputDescriptorReader): Promise<{ index: OutputIndex; receipt: ValidationReceipt; digest: string } | null> {
  if (reader.firstParty !== true || indexReceipt(input) === null || !isJsonDataWithFileSchemas(input)) return null;
  // Clone before the first caller pause/hash callback. Neither can mutate the
  // private snapshot while its canonical bytes are encoded and verified.
  const owned: unknown = structuredClone(input);
  // The accessor/plain-data fence and owned copy above remain atomic. End
  // their slice before encoding/hashing; callbacks can only mutate input.
  await reader.pause?.();
  const digest = await reader.hash(await receiptBytes(owned, reader));
  if (!buildValidatedIndex(owned, digest)) return null;
  const receipt = indexReceipt(owned, digest);
  return receipt === null ? null : { index: owned, receipt, digest };
}

/** G887: assemble our emitted files; strict checks remain in the build publisher. */
async function readBuiltOutput(index:OutputIndex,reader:OutputDescriptorReader,built:NonNullable<OutputDescriptorReader['built']>):Promise<Shardfile>{
  const sections=new Map<string,unknown>();
  // Schemas validated these sections at publication; the client never downloads them to repeat that work.
  const rows=index.sections;
  for(const row of rows)reader.declare?.(row.path,row.bytes);
  if(reader.deferAssetDeclarations!==true)for(const file of index.files)reader.declare?.(outputBlobPath(file),file.compressed);
  let parseTail=Promise.resolve();
  const values=await Promise.allSettled(rows.map(async row=>{
    const bytes=await built.read(row.path,row.bytes,row.hash);
    // Reads overlap; parsing takes one cooperative turn at a time. Warm cache
    // completions must not all resume from the same pause into a parse burst.
    const previous=parseTail;let release=():void=>{ /* Assigned synchronously before the first await. */ };
    parseTail=new Promise<void>(resolve=>{release=resolve;});
    await previous;
    try{
      await reader.pause?.();
      const value:unknown=reader.parseJson===undefined?JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)):await reader.parseJson(bytes);
      await reader.pause?.();
      return [row.name,value] as const;
    }finally{release();}
  }));
  // Drain every started read and retain authored publication/error order.
  for(const value of values){if(value.status==='rejected')throw value.reason;sections.set(...value.value);}
  const source=assembleOutputTransport(index,sections);
  if(!isBuiltClientSource(source,reader))throw new Error('Built output needs its first-party reader');
  const residentBytes=builtShardfileResidency(index.build.sourceHash);
  buildValidated.add(source);descriptors.set(source.files,{index,sections,cached:false,indexHash:built.indexHash,built:true,...(residentBytes===undefined?{}:{residentBytes})});
  return source;
}

/** The native build reader is the type authority here, not an authored field.
 * G887 moves schema proof to publication; no client source hash or parser is involved. */
function isBuiltClientSource(value:unknown,reader:OutputDescriptorReader):value is Shardfile{
  return typeof value==='object'&&value!==null&&reader.firstParty===true&&reader.built!==undefined;
}

/**
 * Read all sections needed by today's complete Shardfile hosts, checking exact
 * byte sizes and hashes before assembly. Already assembled in-memory models
 * remain host inputs; disk readers separately require a format-2 index.
 */
export async function resolveOutputDescriptor(input: unknown, reader: OutputDescriptorReader): Promise<unknown> {
  if(reader.firstParty===true&&reader.built!==undefined){
    if(isBuildValidatedOutput(input))return input;
    return readBuiltOutput(input as OutputIndex,reader,reader.built);
  }
  if(!(import.meta.env?.SSR??true)&&reader.checks===undefined)throw new Error('Client product needs its build-owned reader');
  // This root was reconstructed here already. Admission still rechecks exposed
  // values; recognizing a model must not load the disk-index grammar again.
  if (reader.firstParty === true && isBuildValidatedOutput(input)) {
    if (!isJsonDataWithFileSchemas(input)) throw new Error('Shardfile descriptor requires bounded plain JSON');
    return input;
  }
  const historical = reader.lineage === true ? parseOutputLineageIndex(input) : null;
  const pinned = historical === null ? await ownedBuildIndex(input, reader) : null;
  const current = historical === null ? pinned?.index ?? (await descriptorChecks(reader)).parseIndex(input) : null;
  const inventory = historical ?? current;
  if (inventory === null) return input;
  for (const file of [...inventory.sections, ...inventory.schemas]) reader.declare?.(file.path, file.bytes);
  // General readers declare the immutable bank before their first section read.
  // Admission defers blobs until its verified sections select a device tier;
  // the boot compiler reserves that same selected bank before section reads.
  // A historical lineage never reads blobs.
  if (current !== null && reader.deferAssetDeclarations !== true) for (const file of current.files) reader.declare?.(outputBlobPath(file), file.compressed);
  const sections = new Map<string, unknown>();
  const packed = current === null || reader.pack === undefined || reader.offline ? undefined
    : packReads(current.packs, new Set([...current.sections, ...current.schemas].map(entry => entry.hash)), reader.pack, reader.hash);
  let cached = reader.cached !== undefined || reader.verified !== undefined;
  const cachedSection = async (section: OutputIndex['sections'][number], inPack: boolean): Promise<Uint8Array | { readonly verified: Uint8Array } | null | undefined> => {
    if (reader.cached === undefined) return undefined;
    const pending = reader.cached(section.hash, section.path, section.bytes);
    if (!inPack || reader.offline || reader.cacheHintTurn === undefined) return pending;
    const controller = new AbortController();
    try { return await Promise.race([pending, reader.cacheHintTurn(controller.signal).then(() => null)]); }
    finally { controller.abort(); }
  };
  const stores: Promise<void>[] = [];
  let pendingStores = 0;
  const load = async (section: OutputIndex['sections'][number]): Promise<readonly [string, unknown]> => {
    const inPack = packed?.has(section.hash) === true;
    const verified = inPack || reader.verified === undefined ? null : await reader.verified(section.hash, section.path, section.bytes);
    const held = verified === null ? await cachedSection(section, inPack) : undefined;
    let bytes = verified?.bytes ?? (held instanceof Uint8Array ? held : held?.verified);
    if (verified !== null && verified !== undefined) {
      bytes = verified.bytes;
      if (bytes.length !== section.bytes) throw new Error('Shardfile section hash or size mismatch');
      if (!verified.stored) cached = false;
      if (verified.cached) reader.cacheHit?.(section.path, section.hash, verified.bytes.length);
    } else if (held !== null && held !== undefined && !(held instanceof Uint8Array)) {
      bytes = held.verified;
      if (bytes.length !== section.bytes) throw new Error('Cached shardfile section hash or size mismatch');
      reader.cacheHit?.(section.path, section.hash, bytes.length);
    } else if (bytes === null || bytes === undefined) {
      if (reader.offline) throw new IncompleteOutputCacheError();
      // PZ7: a pack that is not published (or fails) falls back to the section's own read
      if (inPack && packed !== undefined) {
        let fromPack = true;
        bytes = await packOrLoose(() => packed.read(section.hash), () => { fromPack = false; return reader.read(section.path, section.bytes); });
        if (fromPack) reader.packedHit?.(section.path, section.hash);
      } else bytes = await reader.read(section.path, section.bytes);
      if (bytes.length !== section.bytes || await reader.hash(bytes) !== section.hash) throw new Error('Shardfile section hash or size mismatch');
      if (reader.backgroundStore !== undefined) {
        // A scheduled write is not durable cache proof. Complete offline
        // admission still uses the awaited store path before publication.
        const store = reader.backgroundStore, wire = bytes;
        pendingStores++;
        stores.push(Promise.resolve().then(() => store(section.hash, wire)).then(ok => {
          if (!ok) cached = false; pendingStores--; return undefined;
        }, () => { cached = false; pendingStores--; return undefined; }));
      } else if (reader.store === undefined || !await reader.store(section.hash, bytes)) cached = false;
    } else {
      if (bytes.length !== section.bytes || await reader.hash(bytes) !== section.hash) throw new Error('Cached shardfile section hash or size mismatch');
      reader.cacheHit?.(section.path, section.hash, bytes.length);
    }
    if (reader.firstParty === true) await reader.pause?.();
    const value: unknown = reader.parseJson === undefined ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) : await reader.parseJson(bytes);
    if (reader.firstParty === true) await reader.pause?.();
    return [section.name, value];
  };
  // Each section is independently bounded; launch the complete inventory in
  // parallel, and settle every request before returning a failed admission.
  const results = await Promise.allSettled(inventory.sections.map(load));
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason;
    sections.set(...result.value);
  }
  if (current === null) {
    const state = sections.get('state/state');
    return { identity: inventory.identity, state: typeof state === 'object' && state !== null && 'state' in state ? state.state : undefined };
  }
  const index = current;
  const candidate = pinned?.receipt ?? (reader.firstParty === true ? builtValidationReceipt(index.build.sourceHash) : null);
  const indexHash = pinned?.digest ?? (candidate === null ? undefined : await reader.hash(await receiptBytes(input, reader)));
  const receipt = pinned?.receipt ?? (indexHash === undefined ? null : builtValidationReceipt(index.build.sourceHash, indexHash));
  // Unproved products keep the original serialized schema phase before paced
  // hashing; only a possible CI receipt needs that digest to decide the fast path.
  const digest = indexHash ?? await reader.hash(await receiptBytes(input, reader));
  let source: Shardfile;
  if (receipt === null) source = (await descriptorChecks(reader)).assemble(index, sections);
  else {
    const fields = assembleOutputTransport(index, sections);
    const actual = await reader.hash(await receiptBytes(fields, reader));
    if (actual !== index.build.sourceHash || !buildValidatedSource(fields, actual, digest)) throw new Error('Built shardfile source receipt mismatch');
    source = fields;
    buildValidated.add(source);
  }
  descriptors.set(source.files, { index, sections, get cached() { return cached && pendingStores === 0; }, indexHash: digest,
    ...(stores.length === 0 ? {} : { cacheStored: Promise.all(stores).then(() => cached) }),
    ...(receipt === null ? {} : { receipt }) });
  return source;
}

/** Per admitted file list: its own hashes and each hash's first index entry (outputBlobUrl ran a search of both per
 *  call, once per asset: O(files^2), ~28 ms of a neighbour's admission at 4x CPU). */
const blobLookups = new WeakMap<object, { readonly own: ReadonlySet<string>; readonly entries: ReadonlyMap<string, OutputIndex['files'][number]> }>();
function blobLookup(source: Shardfile, descriptor: OutputDescriptor): { readonly own: ReadonlySet<string>; readonly entries: ReadonlyMap<string, OutputIndex['files'][number]> } {
  let lookup = blobLookups.get(source.files);
  if (lookup === undefined) {
    const entries = new Map<string, OutputIndex['files'][number]>();
    for (const entry of descriptor.index.files) if (!entries.has(entry.hash)) entries.set(entry.hash, entry);
    lookup = { own: new Set(source.files.map(file => file.hash)), entries };
    blobLookups.set(source.files, lookup);
  }
  return lookup;
}

/** Resolve only a declared format-2 blob, using its admitted kind/hash path. */
export function outputBlobUrl(source: Shardfile, ref: string, base: string): string {
  const hash = ref.replace(/^commons:/u, '');
  const descriptor = outputDescriptor(source), lookup = descriptor === undefined ? undefined : blobLookup(source, descriptor);
  if (!/^[a-f0-9]{64}$/u.test(hash) || (ref.startsWith('commons:')
    ? !source.requires.commons.includes(hash) : !(lookup?.own.has(hash) ?? source.files.some(file => file.hash === hash)))) throw new Error('Undeclared shardfile blob');
  if (descriptor === undefined || lookup === undefined) throw new Error('Blob reads require an admitted format-2 output');
  const file = lookup.entries.get(hash);
  if (file === undefined) throw new Error('Missing shardfile blob path');
  return new URL(outputBlobPath(file), base).href;
}
