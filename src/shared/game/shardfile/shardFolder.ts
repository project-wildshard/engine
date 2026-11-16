import { OUTPUT_SECTIONS, isPlatformDataSection } from '@wildshard/format/outputFields';
import { platformFileFamily, validatePlatformFile } from '@wildshard/format/platformFileFamilies';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { PlatformSectionName, PlatformSections, SectionName } from '@wildshard/format/sections';
import { pacedResolve } from '@wildshard/engine/core/workSlice';
import { parseNamedJson } from '@wildshard/format/json';
import { registeredJsonContract,validateRegisteredJson,type RegisteredJsonName,type RegisteredJsonValues } from '@wildshard/format/registeredJson';
import { readCheckedNamedJson, type NamedJsonCheck } from './namedJsonChecks';

/**
 * The runtime data API (SHARD-PLATFORM P2a, spec progress/shard-platform/p2a-runtime-data-api/README.md): what a shard's
 * standalone `runtime/` reads from its built output instead of importing source `data/` (G448, G449).
 *
 * The loader builds one product per admitted shard and hands it to the plugin as `ctx.product` (and to a headless entry
 * as `product`). Every `boot` and `enter` section is fetched, hash-checked and decoded before the first hook runs, so
 * `section()` and `strings()` are synchronous lookups. Only platform sections are
 * admitted; named JSON keeps its complete registered grammar. Blobs are read by
 * logical name, asynchronously, through the shard's verified asset reader.
 */
export interface ShardFolder {
  readonly slug: string;
  readonly revision: number;
  /**
   * Today's in-memory shardfile, assembled by the loader from the sections: hand it to hosts that take a `Shardfile`
   * (`prepareClientWorld`, `bindQuestPageInteractions`, `prepareRuntimePlan` …). Runtime code reads data with `section()`.
   */
  readonly shardfile: Shardfile;
  /** Does the index list this section? Use it for a section a shard may leave out; `section()` refuses a missing one. */
  readonly has: (name: SectionName) => boolean;
  /** A platform section value, typed by its defining format. */
  readonly section: SectionReader;
  /** The named strings from `ui/strings`, all at once; refuses listing every missing key. */
  readonly strings: <const K extends string>(keys: readonly K[]) => FolderStrings<K>;
  /** Does the index name this blob (`models/roc.glb`, `behaviour/director.wasm`)? */
  readonly hasFile: (name: string) => boolean;
  /** A blob's verified bytes by logical name (cached by the shard's asset reader). */
  readonly file: (name: string) => Promise<Uint8Array>;
  /** Build-validated named JSON, typed by a generated declaration and decoded from verified bytes. */
  readonly json: JsonReader;
  /** A blob's content-addressed URL by logical name, for loaders that only take a URL. Prefer `file()`. */
  readonly url: (name: string) => string;
}

/** Registered names infer their wire input; defining consumers apply defaults.
 * Every named JSON read requires a registered complete platform family. */
export interface JsonReader {
  <Name extends RegisteredJsonName>(name:Name):Promise<RegisteredJsonValues[Name]>;
  <T>(name:string):Promise<T>;
}

/** Platform values are shared between readers and must remain read-only. */
export type SectionReader = <K extends PlatformSectionName>(name: K) => PlatformSections[K];

/** The strings a runtime asked for, by key. */
export type FolderStrings<K extends string> = Readonly<Record<K, string>>;

/** Why a product read refused. Every refusal is a build or wiring error, so callers let it fail the load. */
export type FolderRefusal = 'absent' | 'missing-section' | 'stream-section' | 'missing-strings' | 'missing-file' | 'schema';

/** A refused product read: the shard, the section, strings or file asked for, and why. */
export class FolderError extends Error {
  readonly slug: string;
  readonly item: string;
  readonly reason: FolderRefusal;
  constructor(slug: string, item: string, reason: FolderRefusal, detail: string) {
    super(`${slug}: ${detail}`);
    this.name = 'FolderError'; this.slug = slug; this.item = item; this.reason = reason;
  }
}

/** One named blob: its content hash (what the reader verifies) and its content-addressed URL. */
export interface FolderFile { readonly hash: string; readonly url: string; readonly jsonSchema?: Readonly<Record<string, unknown>> }
/** What the loader (browser or Node) gives `createShardFolder`. */
export interface ShardFolderInput {
  readonly slug: string;
  readonly revision: number;
  readonly shardfile: Shardfile;
  /** every section the loader fetched, hash-checked and decoded, by name (`OutputDescriptor.sections`) */
  readonly sections: ReadonlyMap<string, unknown>;
  /** sections the index lists that the loader left to their host to stream (not decoded here) */
  readonly streamed?: ReadonlySet<string>;
  /** every blob the index names, by logical name */
  readonly files: ReadonlyMap<string, FolderFile>;
  /** the verified reader: bytes for a hash, checked against it (`ClientAssets.read`, or a Node file read) */
  readonly read: (hash: string) => Promise<Uint8Array>;
  /** Deep-freeze admitted values for tests and validation. */
  readonly check?: boolean;
  /** a first-party build's named JSON: its build validated each file against its schema (nameBlob) and `read` checks the
   *  bytes against that build's hash, so a read parses it without validating it again (an external product validates) */
  readonly builtJson?: boolean;
  /** Explicit Node author capability; never supplied by authored JSON. */
  readonly jsonCheck?: NamedJsonCheck;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** each loaded product's content-addressed reader (its closure's unnamed files) */
const closureReaders = new WeakMap<ShardFolder, (hash: string) => Promise<Uint8Array>>();
/**
 * D74: a closure file's verified bytes by content hash, for the files a catalogue names by hash rather than by logical
 * name (a material's graph file, `{ family: 'graph', file }`). Refuses a product with no loaded output.
 */
export function folderClosureFile(product: ShardFolder, hash: string): Promise<Uint8Array> {
  const read = closureReaders.get(product);
  if (read === undefined) return Promise.reject(new FolderError(product.slug, hash, 'absent', 'this product has no content-addressed reader'));
  return read(hash);
}

/** Build the product the loader passes to a runtime. Pure: it fetches nothing and decodes nothing itself. */
export function createShardFolder(input: ShardFolderInput): ShardFolder {
  const { slug, sections, files, check = false } = input, streamed = input.streamed ?? new Set<string>();
  /** Named JSON that already passed its platform and registered checks for this product. */
  const passedJson = new Set<string>();
  for (const name of new Set([...sections.keys(), ...streamed])) if (!isPlatformDataSection(name) && !OUTPUT_SECTIONS.some(row => row.name === name)) throw new FolderError(slug, name, 'schema', 'only platform sections are admitted');
  for (const name of files.keys()) if (name.startsWith('custom/')) throw new FolderError(slug, name, 'schema', 'custom output names are retired');
  const value = (name: string): unknown => {
    if (streamed.has(name)) throw new FolderError(slug, name, 'stream-section', `section ${name} streams; read it through its host`);
    if (!sections.has(name)) throw new FolderError(slug, name, 'missing-section', `the built shard has no section ${name}`);
    const entry = sections.get(name);
    return check ? deepFreeze(entry) : entry;
  };
  const named = (name: string): FolderFile => {
    const file = files.get(name);
    if (file === undefined) throw new FolderError(slug, name, 'missing-file', `the built shard names no file ${name}`);
    return file;
  };
  function section<K extends PlatformSectionName>(name: K): PlatformSections[K];
  function section(name: string): unknown { return value(name); }
  function json<Name extends RegisteredJsonName>(name:Name):Promise<RegisteredJsonValues[Name]>;
  function json<T>(name: string): Promise<T>;
  async function json(name: string): Promise<unknown> {
    const file = named(name);
    if (name.startsWith('custom/') || platformFileFamily(name, typeof file.jsonSchema?.['$comment'] === 'string' ? file.jsonSchema['$comment'] : undefined) === undefined) throw new FolderError(slug, name, 'schema', 'unregistered named JSON is retired');
    // Unsupported browser ingestion refuses before touching the blob reader.
    // An explicit native port keeps author bundles checked even under SSR:false.
    if (!(import.meta.env?.SSR ?? true) && input.builtJson !== true && input.jsonCheck === undefined && file.jsonSchema !== undefined) {
      throw new Error('Shardfile needs server validation before client admission');
    }
    const contract=registeredJsonContract(name);
    if(contract!==undefined&&file.jsonSchema?.['$comment']!==contract.source)
      throw new FolderError(slug,name,'schema','registered JSON requires its exact defining format contract');
    const bytes = await input.read(file.hash);
    // a read in play lets a due frame through between its parse, schema compile and validation (pacedResolve)
    const decoded: unknown = file.jsonSchema === undefined ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      : input.builtJson === true ? parseNamedJson(bytes) : await (input.jsonCheck ?? readCheckedNamedJson)(file.jsonSchema, bytes, () => pacedResolve(undefined));
    if(input.builtJson!==true){
      const comment=typeof file.jsonSchema?.['$comment']==='string'?file.jsonSchema['$comment']:undefined;
      // TEST-SPEED TS4: both checks only read the decoded value. With a pure decoder (plain JSON, or a checker marked
      // `pure`), the same verified bytes decode to the same value, so a name and hash that passed once pass again: skip
      // the repeat (every resident a world opens reads the same files). Only a pass is remembered; a refusal, or any
      // value from a checker not marked pure, is checked every time.
      const pure=file.jsonSchema===undefined||(input.jsonCheck??readCheckedNamedJson).pure===true;
      const key=`${name}\u0000${file.hash}`;
      if(!pure||!passedJson.has(key)){
        try{validatePlatformFile(name,comment,decoded);if(contract!==undefined)validateRegisteredJson(name,decoded);}
        catch(error){throw new FolderError(slug,name,'schema',`registered JSON refuses its defining contract: ${String(error)}`);}
        if(pure)passedJson.add(key);
      }
    }
    return input.check === true ? deepFreeze(decoded) : decoded;
  }
  const product: ShardFolder = {
    slug, revision: input.revision, shardfile: input.shardfile, section, json,
    has: name => sections.has(name) || streamed.has(name),
    strings: <const K extends string>(keys: readonly K[]): FolderStrings<K> => {
      if (keys.length === 0) return Object.freeze({}) as FolderStrings<K>;
      const table: Readonly<Record<string, string>> = sections.has('ui/strings') ? section('ui/strings') : {};
      const missing = keys.filter(key => table[key] === undefined);
      if (missing.length > 0) throw new FolderError(slug, missing.join(','), 'missing-strings', `ui/strings has no ${missing.join(', ')}`);
      return Object.freeze(Object.fromEntries(keys.map(key => [key, table[key] ?? '']))) as FolderStrings<K>;
    },
    hasFile: name => files.has(name),
    file: name => {
      try { return input.read(named(name).hash); } catch (error) { return Promise.reject(error instanceof Error ? error : new Error(String(error))); }
    },
    url: name => named(name).url,
  };
  closureReaders.set(product, hash => { try { return input.read(hash); } catch (error) { return Promise.reject(error instanceof Error ? error : new Error(String(error))); } });
  return product;
}

/**
 * The product of a shard with no built output (a frozen `-legacy` entry, or a session that has not loaded one): every
 * read refuses with `absent`, so a runtime that needs data fails its load with the slug and the fix.
 */
export function absentShardFolder(slug: string): ShardFolder {
  const absent = (item: string): never => {
    throw new FolderError(slug, item, 'absent', `no built shard was loaded for this entry (run \`wildshard build ${slug}\`)`);
  };
  function section<K extends PlatformSectionName>(name: K): PlatformSections[K];
  function section(name: string): never { return absent(name); }
  return {
    slug, revision: 0, get shardfile(): Shardfile { return absent('shardfile'); }, section,
    has: () => false, hasFile: () => false,
    strings: keys => absent(keys.join(',')),
    file: name => Promise.reject(new FolderError(slug, name, 'absent', `no built shard was loaded for this entry (run \`wildshard build ${slug}\`)`)),
    json: (name:string) => Promise.reject(new FolderError(slug, name, 'absent', `no built shard was loaded for this entry (run \`wildshard build ${slug}\`)`)),
    url: name => absent(name),
  };
}
