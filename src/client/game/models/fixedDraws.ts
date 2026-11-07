import { decodeLaneBytes } from '@wildshard/engine/core/deflate';
import { workSlice } from '@wildshard/engine/core/workSlice';
import { FixedDrawRowsSchema } from '@wildshard/format/fixedDraws';
import * as v from 'valibot';
import type { BufferGeometry } from 'three';
import { createOwnedGeometry, type OwnedGeometry } from '@wildshard/engine/models/ownedGeometry';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import type { Scope } from '@wildshard/engine/app/scope';
import { bakedGeometryBytes, expandBakedGeometry, fetchLaneBake, readBakedGeometry, type readWholeGeometry } from '../plugin/geometry';
import { timeClientPreparation } from '../shardfile/preparationTiming';

/** One loaded library of fixed draws (see fixedDraws). */
export interface FixedDraws {
  /** every slot's template has completed its intake */
  readonly ready: boolean;
  /** Load every slot together: through the product's verified reader, from `bytes` (a caller's named blobs: Explorer
   *  cards; a lane bake under its url), or from `owner`'s whole-geometry assembly of the product (the world build).
   *  `whole` is a construction's already-started, owner-bound intake; consumes it without reading/decoding again. */
  load: (bytes?: ReadonlyMap<string, Uint8Array | BufferGeometry>, owner?: Parameters<typeof readWholeGeometry>[0], whole?: ReturnType<typeof readWholeGeometry>) => Promise<void>;
  /** the slot's owned template: its intake, a deep copy, or the template itself transferred */
  handle: (slot: string) => OwnedGeometry;
}

type FixedDrawRow = Exclude<v.InferOutput<typeof FixedDrawRowsSchema>[number],{inline:string}>;
/** Refuse the complete inline source list before templates, IO or geometry. */
function fileRows(input:unknown):FixedDrawRow[] {
  return v.parse(FixedDrawRowsSchema,input).map(row=>{
    if('inline'in row)throw new Error('Fixed draws require binary sources');
    return row;
  });
}
type BakedRow = NonNullable<FixedDrawRow['baked']>;
/** Reads a lane-shuffled bake's restored bytes (the page's own fetch, or a test's). */
export type LaneBakeReader = (url: string) => Promise<Uint8Array>;

/** A baked block as a geometry: exactly its own bytes, expanded when declared, its declared channels renamed. */
function bakedDraw(slot: string, baked: BakedRow, channels: FixedDrawRow['channels'], bytes: Uint8Array): BufferGeometry {
  if (bytes.byteLength !== bakedGeometryBytes(baked)) throw new Error(`Baked fixed draw byte count differs: ${slot}`);
  let geometry = readBakedGeometry(bytes, 0, baked);
  if (baked.expand) geometry = expandBakedGeometry(geometry);
  for (const [from, to] of channels) {
    if (!geometry.hasAttribute(from)) { geometry.dispose(); throw new Error(`Baked fixed draw is missing ${from}: ${slot}`); }
    geometry.setAttribute(to, geometry.getAttribute(from)); geometry.deleteAttribute(from);
  }
  return geometry;
}
/** A block inside a lane bake: exactly its own bytes from the row's offset. */
function laneBlock(slot: string, baked: BakedRow, bytes: Uint8Array, offset: number): Uint8Array {
  const end = offset + bakedGeometryBytes(baked);
  if (end > bytes.byteLength) throw new Error(`Baked fixed draw exceeds its lane bake: ${slot}`);
  return bytes.subarray(offset, end);
}

/** One slot's intake: a GLB file (or an assembled geometry) through the template's own loader; a baked block (a file's
 *  bytes, a lane bake's whole bytes) decoded here and adopted without a copy. */
function admitSlot(row: FixedDrawRow, template: OwnedGeometry, value: Uint8Array | BufferGeometry | undefined): Promise<void> {
  const baked = row.baked;
  if (baked === undefined) return template.load(value);
  if (!(value instanceof Uint8Array)) return Promise.reject(new Error(`Baked fixed draw needs its file bytes: ${row.slot}`));
  try {
    const block = 'lane' in row ? laneBlock(row.slot, baked, value, row.lane.offset) : value;
    template.adopt(bakedDraw(row.slot, baked, row.channels, block));
    return Promise.resolve();
  } catch (error) { return Promise.reject(error instanceof Error ? error : new Error(String(error))); }
}

/** A row's source bytes: a supplied blob (under its file or lane url), a lane bake (one read per url),
 *  or the product's verified file. `undefined` only when supplied blobs lack it. */
function sourceOf(product: Pick<ShardProduct, 'file'>, lane: LaneBakeReader, lanes: Map<string, Promise<Uint8Array>>,
  row: FixedDrawRow, supplied?: ReadonlyMap<string, Uint8Array | BufferGeometry>): Promise<Uint8Array | BufferGeometry | undefined> {
  if ('lane' in row) {
    const source=row.lane,name='url'in source?source.url:source.file,given=supplied?.get(name);
    if (given !== undefined || supplied !== undefined) return Promise.resolve(given);
    const key=`${'url'in source?'url':'file'}:${name}`;
    let read = lanes.get(key); if (read === undefined) { read = 'url'in source?lane(source.url):product.file(source.file).then(decodeLaneBytes); lanes.set(key, read); }
    return read;
  }
  return supplied === undefined ? product.file(row.file) : Promise.resolve(supplied.get(row.file));
}

/** G571 / G602: a product's fixed draws (rows: `FixedDrawRowsSchema`) as owned geometry templates, loaded together:
 *  product GLB or baked files and baked blocks in a lane bake. Client-only. */
export function fixedDraws(product: Pick<ShardProduct, 'file' | 'slug'>, input: unknown, intake: typeof createOwnedGeometry = createOwnedGeometry,
  lane: LaneBakeReader = fetchLaneBake): FixedDraws {
  const rows = fileRows(input), templates = new Map(rows.map(row => [row.slot, intake(row.slot, Object.fromEntries(row.channels))]));
  if (templates.size !== rows.length) throw new Error('Repeated fixed draw slot');
  let ready = false;
  return {
    get ready() { return ready; },
    handle: slot => { const handle = templates.get(slot); if (handle === undefined) throw new Error(`Undeclared fixed draw: ${slot}`); return handle; },
    load: async (bytes, owner, whole) => {
      // Developer pages time the whole-geometry assembly ('wildshard.prepare:<slug>:fixed-draws:whole', G626 H3)
      const assembled = whole !== undefined ? await whole : owner === undefined ? undefined : await timeClientPreparation(product.slug, 'fixed-draws:whole', async () => (await import('../plugin/geometry')).readWholeGeometry(owner, product.slug));
      const lanes = new Map<string, Promise<Uint8Array>>();
      try {
        const admitted = new Map(await Promise.all(rows.map(async row => {
          // only a product GLB is part of the whole-geometry assembly; every other source reads its own bytes
          const glb = row.baked === undefined && 'file' in row ? row.file : undefined;
          const value = assembled !== undefined && glb !== undefined ? assembled.get(glb.slice(glb.lastIndexOf('/') + 1, -4))?.geometry
            : await sourceOf(product, lane, lanes, row, bytes);
          if (value === undefined) throw new Error(`Missing fixed draw: ${row.slot}`);
          return [row.slot, value] as const;
        })));
        if (assembled !== undefined && assembled.size !== rows.filter(row => row.baked === undefined).length) throw new Error('Unexpected assembled fixed draw');
        // G639: a baked slot decodes synchronously (its blocks, bounds and corner expansion), so the slots take turns
        // with the frame: together they made a ~180 ms Nalati cell-entry frame (Chromium phone 4x). GLB loads still all
        // start in row order and run together.
        const slice = workSlice(), admits: Promise<void>[] = [];
        for (const row of rows) {
          const template = templates.get(row.slot); if (template === undefined) throw new Error(`Undeclared fixed draw: ${row.slot}`);
          const admit = admitSlot(row, template, admitted.get(row.slot)); admit.catch(() => undefined); admits.push(admit);
          if (row.baked !== undefined) await slice.check();
        }
        await Promise.all(admits);
        ready = true;
      } finally { for (const view of assembled?.values() ?? []) view.release?.(); }
    },
  };
}

const productDraws = new WeakMap<object, Map<string, Promise<FixedDraws>>>();
/** A product's fixed draws from its named JSON file of rows: one library (one promise, its
 *  failure included) per exact product and file, so every world built from that product shares its loaded geometry. The
 *  product's readers must not change during intake. File rows require its actual file reader and slug;
 *  metadata-only callers retain the original binary lane path. */
export function productFixedDraws(product: { readonly json: (name: string) => Promise<unknown> } & Partial<Pick<ShardProduct, 'file' | 'slug'>>, file: string): Promise<FixedDraws> {
  let files = productDraws.get(product);
  if (files === undefined) { files = new Map(); productDraws.set(product, files); }
  const known = files.get(file);
  if (known !== undefined) return known;
  const read = product.json, readFile = product.file, made = read(file).then(input => {
    if (product.json !== read) throw new Error(`Fixed draw product reader changed: ${file}`);
    const rows = fileRows(input);
    if (!rows.some(row => 'file' in row||('lane'in row&&'file'in row.lane)))
      return fixedDraws({slug:'baked',file:name=>Promise.reject(new Error(`Fixed draws read no product file: ${name}`))},rows);
    if (readFile === undefined) throw new Error(`Fixed draw product file reader required: ${file}`);
    const sourceSlug = v.parse(v.string(), product.slug);
    const live = (): void => {
      if (product.json !== read || product.file !== readFile) throw new Error(`Fixed draw product reader changed: ${file}`);
    };
    live();
    return fixedDraws({ slug: sourceSlug, file: async name => {
      live(); const bytes = await readFile.call(product, name); live(); return bytes;
    } }, rows);
  });
  files.set(file, made);
  return made;
}

/** G571: a cold view's own fixed draws (a kit-figure Explorer card): exactly `slots` of the admitted rows, through the
 *  same loader and format, owned by `cardScope` (never the live world's library, and no cache). Every slot's read and
 *  decode settles before the result: a card closed or retiring meanwhile, or any failed slot, releases exactly the
 *  templates that did load and refuses; the card's retirement releases them later. Looks and materials stay the caller's. */
export async function coldFixedDraws(product: Pick<ShardProduct, 'file' | 'slug'>, input: unknown, cardScope: Scope, slots: readonly string[],
  intake: typeof createOwnedGeometry = createOwnedGeometry, lane: LaneBakeReader = fetchLaneBake): Promise<FixedDraws> {
  const wanted = new Set(slots), rows = fileRows(input).filter(row => wanted.has(row.slot));
  if (wanted.size !== slots.length || rows.length !== wanted.size) throw new Error('Cold fixed draws name an undeclared or repeated slot');
  const closed = (): boolean => cardScope.disposed || cardScope.disposing;
  if (closed()) throw new Error('Cold fixed draws owner left');
  const draws = fixedDraws(product, rows, intake, lane), loaded: string[] = [], lanes = new Map<string, Promise<Uint8Array>>();
  const release = (): void => { for (const slot of loaded.splice(0)) draws.handle(slot).take().dispose(); };
  const settled = await Promise.allSettled(rows.map(async row => {
    const bytes = await sourceOf(product, lane, lanes, row);
    if (closed()) throw new Error('Cold fixed draws owner left');
    await admitSlot(row, draws.handle(row.slot), bytes); loaded.push(row.slot);
  }));
  const failed = settled.find(result => result.status === 'rejected');
  if (failed !== undefined || closed()) {
    release();
    const reason: unknown = failed?.reason;
    throw reason instanceof Error ? reason : new Error('Cold fixed draws owner left');
  }
  let live = true;
  cardScope.onDispose(() => { live = false; release(); });
  const refuse = (): void => { if (!live || closed()) throw new Error('Cold fixed draws owner left'); };
  return { get ready() { return live && !closed(); }, handle: slot => { refuse(); return draws.handle(slot); },
    load: () => { try { refuse(); return Promise.resolve(); } catch (error) { return Promise.reject(error instanceof Error ? error : new Error(String(error))); } } };
}
