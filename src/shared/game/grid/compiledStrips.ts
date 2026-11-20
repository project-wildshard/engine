import * as v from 'valibot';
import { unzlibSync } from 'fflate';
import { GeometryPackData, PackedGeometryRowsSchema, type PackedGeometryRows } from '@wildshard/format/geometryPack';
import type { Scope } from '@wildshard/engine/app/scope';

import { platformShapeKeys, type GeneratedStrip, type PlatformCell, type PlatformShape, type StripMesh, type StripProfile } from '@wildshard/engine/sim/strips';
import { edgeProfileJson } from '@wildshard/engine/sim/edgeProfiles';
import type { ResidencyAllocator } from './allocator';
import { readGridAssetBytes } from './gridAssetBytes';
import type { SeamGeometryChannels } from './seamGeometry';

// ZONE-ENTRY ZE4 (was ROAD-PRELOAD RP2): the road between the cells, baked once per seam source as shared strip blocks.
// A block is the strips whose origin stands in one pitch square, each with its native order; a home's directory row names
// the blocks its initial ring and its outer road read, and the page keeps the strips its own ring selects. Every block is
// content-addressed and shared by every home that reads it, so no home builds its road on the phone and a second home
// reads the blocks the first already cached. A block's look is frame-free (each strip's own normals and colours); the
// home's uv and bounding sphere are made on the page (`seamMeshSteps`).

type SeamFeature = GeneratedStrip['features'][number];
type SeamFeatureKind = SeamFeature['kind'];
type SeamTurnIn = NonNullable<GeneratedStrip['turnIn']>;

export interface CompiledGridAddress { readonly url: string; readonly bytes: number; readonly sha256: string }
export type GridStripPhase = 'initial' | 'outer';
/** Only homes with a directory row fetch the directory; other pages add no data requests. */
export interface CompiledGridSelector { readonly directory: CompiledGridAddress; readonly homes: readonly string[] }
/** One shared block: its small header and its body (geometry, feature words, look). */
export interface CompiledGridBlock { readonly header: CompiledGridAddress; readonly body: CompiledGridAddress }
/** One home under one seam source: the blocks (indices into `blocks`) its initial ring and its outer road read. */
export interface CompiledGridHome { readonly source: string; readonly home: string; readonly initial: readonly number[]; readonly outer: readonly number[] }
/** `shapes`: the shape index (SB38e), read only when a home's live inputs miss every source row. */
export interface CompiledGridDirectory { readonly version: 2; readonly blocks: readonly CompiledGridBlock[]; readonly homes: readonly CompiledGridHome[]; readonly shapes?: CompiledGridAddress }
/** SB38e: each baked shape key's SHA-256 and the block row (block index, row in its header's strips) that holds its words. */
export interface CompiledGridShapeIndex { readonly version: 1; readonly shapes: readonly (readonly [string, number, number])[] }
export interface CompiledGridHeader {
  readonly version: 2; readonly block: string; readonly rows: PackedGeometryRows;
  readonly surfaces: readonly string[];
  readonly shapes: readonly { readonly features: { readonly offset: number; readonly count: number }; readonly turnIn?: SeamTurnIn }[];
  /** `order`: the strip's place in its source's whole native road (the page merges blocks back into it). */
  readonly strips: readonly { readonly id: string; readonly order: number; readonly shape: number; readonly origin: { readonly x: number; readonly z: number };
    readonly duplicates: readonly { readonly instance: string; readonly origin: { readonly x: number; readonly z: number } }[] }[];
  readonly look?: { readonly pitch: number; readonly vertices: number; readonly offset: number; readonly colours?: true; readonly codec?: 'deflate' };
}
const hash = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/u));
const text = v.pipe(v.string(), v.minLength(1), v.maxLength(512));
const natural = v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(16 * 1024 * 1024));
// JSON cannot carry signed zero. Only numerical fields accept its wire token.
const finite = v.pipe(v.union([v.pipe(v.number(), v.finite()), v.literal('-0')]), v.transform(value => value === '-0' ? -0 : value));
const point = v.strictObject({ x: finite, z: finite });
const address = (extension: 'json' | 'bin') => v.strictObject({ url: v.pipe(v.string(), v.regex(new RegExp(`^/assets/grid-strip-${extension === 'json' ? '(?:book|page)' : 'mesh'}-[a-f0-9]{8}\\.${extension}$`, 'u'))),
  bytes: v.pipe(natural, v.minValue(1)), sha256: hash });
const blockList = v.pipe(v.array(v.pipe(natural, v.maxValue(4095))), v.maxLength(4096));
const directorySchema = v.strictObject({ version: v.literal(2),
  blocks: v.pipe(v.array(v.strictObject({ header: address('json'), body: address('bin') })), v.maxLength(4096)),
  homes: v.pipe(v.array(v.strictObject({ source: hash, home: text, initial: blockList, outer: blockList })), v.maxLength(1024)),
  shapes: v.exactOptional(address('json')) });
const shapeIndexSchema = v.strictObject({ version: v.literal(1),
  shapes: v.pipe(v.array(v.tuple([hash, v.pipe(natural, v.maxValue(4095)), v.pipe(natural, v.maxValue(255))])), v.maxLength(65_536)) });
/** The build and runtime share one shape index admission: sorted unique keys, every row inside the directory's blocks. */
export function parseCompiledGridShapeIndex(input: unknown, blocks: number): CompiledGridShapeIndex {
  const index = v.parse(shapeIndexSchema, input);
  for (const [at, [key, block]] of index.shapes.entries()) {
    if (block >= blocks) throw new Error('Grid shape index names a missing block');
    if (at > 0 && (index.shapes[at - 1]?.[0] ?? '') >= key) throw new Error('Grid shape index is not sorted');
  }
  return index;
}
/** One shape key's index name. */
export async function gridShapeKeyHash(key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}
/** The build and runtime share one bounded directory admission: every block index names a block. */
export function parseCompiledGridDirectory(input: unknown): CompiledGridDirectory {
  const book = v.parse(directorySchema, input);
  for (const row of book.homes) for (const index of [...row.initial, ...row.outer]) if (index >= book.blocks.length) throw new Error('Grid strip directory names a missing block');
  if (new Set(book.homes.map(row => `${row.source}/${row.home}`)).size !== book.homes.length) throw new Error('Duplicate grid strip home');
  return book;
}
/** Stable binary feature codes; numeric records retain their exact Float64 words. */
export const GRID_STRIP_FEATURE_KINDS: readonly SeamFeatureKind[] = ['deck', 'neutral-buffer', 'gradient', 'overlap', 'retaining-wall', 'cliff', 'talus', 'parapet', 'dike', 'culvert', 'guard-rail', 'road-wall', 'turn-in', 'revetment'];
const headerSchema = v.strictObject({ version: v.literal(2), block: text, rows: PackedGeometryRowsSchema,
  surfaces: v.pipe(v.array(text), v.maxLength(2048)),
  shapes: v.pipe(v.array(v.strictObject({ features: v.strictObject({ offset: natural, count: v.pipe(natural, v.maxValue(100_000)) }), turnIn: v.exactOptional(v.strictObject({ at: v.literal(0), widths: v.tuple([finite, finite]) })) })), v.minLength(1), v.maxLength(256)),
  strips: v.pipe(v.array(v.strictObject({ id: text, order: v.pipe(natural, v.maxValue(65_535)), shape: natural, origin: point, duplicates: v.pipe(v.array(v.strictObject({ instance: text, origin: point })), v.maxLength(4)) })), v.minLength(1), v.maxLength(256)),
  look: v.exactOptional(v.strictObject({ pitch: v.pipe(v.number(), v.finite(), v.minValue(1)), vertices: natural, offset: natural,
    colours: v.exactOptional(v.literal(true)), codec: v.exactOptional(v.literal('deflate')) })) });

/** Exact source identity, independent of object property order and preserving -0. */
export async function platformGeometrySource(cells: readonly PlatformCell[], empty: StripProfile): Promise<string> {
  const zero = (_key: string, value: unknown): unknown => typeof value === 'number' && Object.is(value, -0) ? '-0' : value;
  const byObject = new Map<StripProfile, number>(), byValue = new Map<string, number>(), profiles: string[] = [];
  const profile = (row: StripProfile): number => {
    const previous = byObject.get(row); if (previous !== undefined) return previous;
    const encoded = edgeProfileJson(row);
    let index = byValue.get(encoded);
    if (index === undefined) { index = profiles.length; profiles.push(encoded); byValue.set(encoded, index); }
    byObject.set(row, index); return index;
  };
  const sides = ['north', 'east', 'south', 'west'] as const;
  const source = [cells.map(cell => [cell.instance, cell.cell, cell.origin.x, cell.origin.z, sides.map(side => {
    const observation = cell.observations?.[side];
    return [profile(cell.edges[side]), observation === undefined ? null : [observation.entryWidth, observation.geometry ?? null,
      observation.waterSurface ?? null, observation.sourceSurface ?? null, observation.outflows?.map(row => [row.from, row.to]) ?? null]];
  })]), profile(empty)];
  const wire = new TextEncoder().encode(`${JSON.stringify(source, zero)}\n${profiles.map(row => `${row.length}:${row}`).join('')}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', wire));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The runtime admits the small header before decoding the existing typed pack. */
export function parseCompiledGridHeader(input: unknown): CompiledGridHeader { return v.parse(headerSchema, input); }

// The codec returns real Float32 arrays. IEEE-754's all-one exponent is
// exactly NaN or infinity; scan the same words without a callback per scalar.
function finiteWords(values: Float32Array): boolean {
  const words = new Uint32Array(values.buffer, values.byteOffset, values.length);
  for (let index = 0; index < words.length; index++) if (((words[index] ?? 0) & 0x7f800000) === 0x7f800000) return false;
  return true;
}

/** One decoded strip of a block, with its native order and its own slice of the block's look. */
export interface BlockStrip { readonly strip: GeneratedStrip; readonly order: number; readonly normals?: Float32Array; readonly colours?: Float32Array }
/** One decoded block: its strips in block order, and its look's pitch when it has one. */
export interface DecodedGridBlock { readonly strips: readonly BlockStrip[]; readonly pitch?: number; readonly colours: boolean }
interface DecodedGridStrips { readonly strips: readonly GeneratedStrip[]; readonly look?: SeamGeometryChannels }

// Only these public decoders or the verified file reader admit this private
// snapshot. Keep all binary/feature/finite checks in the same steps.
function* blockSteps(header: CompiledGridHeader, bytes: Uint8Array, nativeLook?: Uint8Array, withLook = true): Generator<void, DecodedGridBlock> {
  if (header.rows.geometries.length !== header.shapes.length) throw new Error('Grid strip block layout differs');
  const featureStart = Math.ceil(header.rows.bytes / 8) * 8;
  const featureEnd = header.look?.offset ?? bytes.length;
  if (featureStart > featureEnd || featureEnd > bytes.length || (featureEnd - featureStart) % 72 !== 0 || new Set(header.surfaces).size !== header.surfaces.length) throw new Error('Grid strip feature layout differs');
  const pack = new GeometryPackData(bytes.subarray(0, header.rows.bytes), header.rows, 'Grid strips');
  const featureWords = new DataView(bytes.buffer, bytes.byteOffset + featureStart, featureEnd - featureStart);
  const shapes: { readonly mesh: Omit<StripMesh, 'origin'>; readonly features: readonly SeamFeature[] }[] = [];
  let featureOffset = 0;
  for (const [index, row] of header.rows.geometries.entries()) {
    if (row.own !== 'u32' || row.count !== row.unique || row.attrs.length !== 2 || row.attrs[0]?.[0] !== 'position' || row.attrs[0][1] !== 3
      || row.attrs[1]?.[0] !== 'color' || row.attrs[1][1] !== 3 || (row.groups?.length ?? 0) !== 0 || row.indexCount % 3 !== 0) throw new Error('Grid strip channels differ');
    const data = pack.read(index), positions = data.attributes[0]?.array, colours = data.attributes[1]?.array, indices = data.index;
    if (positions === undefined || colours === undefined || positions.length !== colours.length || !(indices instanceof Uint32Array)
      || !finiteWords(positions) || !finiteWords(colours) || indices.some(vertex => vertex >= row.unique)) throw new Error('Invalid grid strip geometry');
    const shape = header.shapes[index];
    if (shape === undefined || shape.features.offset !== featureOffset || (featureOffset + shape.features.count) * 72 > featureWords.byteLength) throw new Error('Grid strip feature range differs');
    const features: SeamFeature[] = [];
    for (let i = 0; i < shape.features.count; i++, featureOffset++) {
      const at = featureOffset * 72, word = (column: number): number => featureWords.getFloat64(at + column * 8, true);
      const code = word(0), firstIndex = word(1), indexCount = word(2), side = word(3), from = word(4), to = word(5), bottom = word(6), top = word(7), surface = word(8);
      const kind = GRID_STRIP_FEATURE_KINDS[code], sourceSurface = header.surfaces[surface];
      if (!Number.isSafeInteger(code) || kind === undefined || !Number.isSafeInteger(firstIndex) || firstIndex < 0 || firstIndex % 3 !== 0
        || !Number.isSafeInteger(indexCount) || indexCount < 0 || indexCount % 3 !== 0 || firstIndex + indexCount > indices.length
        || side !== -1 && side !== 0 && side !== 1 || !Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(bottom) || !Number.isFinite(top)
        || !Number.isSafeInteger(surface) || surface < -1 || surface !== -1 && sourceSurface === undefined) throw new Error('Grid strip feature range differs');
      features.push({ kind, firstIndex, indexCount, side, from, to, bottom, top, ...(sourceSurface === undefined ? {} : { sourceSurface }) });
    }
    shapes.push({ mesh: { positions, colours, indices }, features }); yield;
  }
  if (featureOffset * 72 !== featureWords.byteLength) throw new Error('Grid strip feature body differs');
  if (new Set(header.strips.map(strip => strip.id)).size !== header.strips.length) throw new Error('Duplicate grid strip');
  const result: { strip: GeneratedStrip; order: number }[] = [];
  for (const strip of header.strips) {
    const shape = shapes[strip.shape], metadata = header.shapes[strip.shape];
    if (shape === undefined || metadata === undefined || new Set(strip.duplicates.map(row => row.instance)).size !== strip.duplicates.length) throw new Error('Invalid grid strip placement');
    const mesh = { ...shape.mesh, origin: strip.origin };
    const duplicates: GeneratedStrip['duplicates'][number][] = [];
    for (const row of strip.duplicates) duplicates.push({ instance: row.instance, mesh: { ...shape.mesh, origin: row.origin } });
    result.push({ strip: { id: strip.id, mesh, features: shape.features, ...(metadata.turnIn === undefined ? {} : { turnIn: metadata.turnIn }), duplicates }, order: strip.order });
  }
  const look = header.look;
  if (look === undefined || !withLook) return { strips: result, colours: false };
  const vertices = result.reduce((sum, row) => sum + row.strip.mesh.positions.length / 3, 0);
  const decodedBytes = vertices * (look.colours === true ? 24 : 12);
  if (look.offset % 4 !== 0 || look.vertices !== vertices || decodedBytes > 16 * 1024 * 1024) throw new Error('Grid strip look layout differs');
  let channels = nativeLook ?? bytes.subarray(look.offset);
  if (look.codec === 'deflate' && nativeLook === undefined) {
    try { channels = unzlibSync(channels, { out: new Uint8Array(decodedBytes + 1) }); }
    catch (error) { throw new Error('Invalid grid strip look channels', { cause: error }); }
  }
  if (channels.length !== decodedBytes) throw new Error('Grid strip look layout differs');
  const floats = (offset: number, count: number): Float32Array => {
    const data = channels.subarray(offset, offset + count * 4), aligned = data.byteOffset % 4 === 0 ? data : data.slice();
    const values = new Float32Array(aligned.buffer, aligned.byteOffset, count);
    if (!finiteWords(values)) throw new Error('Invalid grid strip look channels');
    return values;
  };
  const normals = floats(0, vertices * 3), colours = look.colours === true ? floats(vertices * 12, vertices * 3) : undefined;
  let at = 0;
  const strips: BlockStrip[] = [];
  for (const { strip, order } of result) {
    const count = strip.mesh.positions.length; // three floats a vertex, as each channel
    strips.push({ strip, order, normals: normals.subarray(at, at + count), ...(colours === undefined ? {} : { colours: colours.subarray(at, at + count) }) });
    at += count;
  }
  return { strips, pitch: look.pitch, colours: colours !== undefined };
}

/** Renderer-free exact decoder of one block (authoring and byte-parity qualification). */
export function decodeCompiledGridBlock(input: unknown, bytes: Uint8Array): DecodedGridBlock {
  const steps = blockSteps(parseCompiledGridHeader(input), bytes);
  for (;;) { const step = steps.next(); if (step.done) return step.value; }
}

/**
 * A home's strips from its blocks: the strips whose origin `within` keeps, in their native order, and the look when every
 * block carries one (colours only when every block carries them). The cook certifies this merge against native for every
 * home and phase (`gridStripPages.ts`), and the page runs this same function.
 */
export function mergeGridBlocks(blocks: readonly DecodedGridBlock[], within: (x: number, z: number) => boolean): DecodedGridStrips {
  const kept: BlockStrip[] = [];
  for (const block of blocks) for (const row of block.strips) if (within(row.strip.mesh.origin.x, row.strip.mesh.origin.z)) kept.push(row);
  kept.sort((a, b) => a.order - b.order);
  for (let i = 1; i < kept.length; i++) if ((kept[i - 1]?.order ?? -1) >= (kept[i]?.order ?? -1)) throw new Error('Duplicate grid strip');
  const strips = kept.map(row => row.strip), pitch = blocks[0]?.pitch;
  if (pitch === undefined || blocks.some(block => block.pitch !== pitch) || kept.some(row => row.normals === undefined)) return { strips };
  const vertices = strips.reduce((sum, strip) => sum + strip.mesh.positions.length / 3, 0), withColours = blocks.every(block => block.colours);
  const normals = new Float32Array(vertices * 3), colours = withColours ? new Float32Array(vertices * 3) : undefined;
  let at = 0;
  for (const row of kept) {
    if (row.normals !== undefined) normals.set(row.normals, at);
    if (colours !== undefined && row.colours !== undefined) colours.set(row.colours, at);
    at += row.strip.mesh.positions.length;
  }
  return { strips, look: { pitch, normals, ...(colours === undefined ? {} : { colours }) } };
}

interface GridStripOwner { readonly scope: Scope; readonly allocator: ResidencyAllocator }
type GridStripFetch = (url: string, signal: AbortSignal) => Promise<Response>;
/** Continuation of the original admitted source, restricted to its owner tree. */
export type DeferredGridStrips = (scope: Scope, pause: () => Promise<void>, reads?: number) => Promise<readonly GeneratedStrip[]>;
export interface CompiledGridRead extends DecodedGridStrips { readonly readOuter?: DeferredGridStrips }

function liveGridOwner(scope: Scope): void { if (scope.disposed || scope.disposing) throw new Error('Grid admission scope disposed'); }
function reserveGridSource(owner: GridStripOwner, key: string, home: string, id: string, bytes: number): { readonly release: () => void } {
  const claim = owner.allocator.reserve({ id: `product:grid:seams:${key}:${id}`, category: 'product', owner: home, bytes, distance: 0, needed: true });
  if (claim === null) throw new Error('Grid strip metadata residency deferred');
  return claim;
}

async function inflateGridLook(bytes: Uint8Array, expected: number, scope: Scope): Promise<Uint8Array> {
  const body = new Response(bytes.slice()).body;
  if (body === null) throw new Error('Missing grid strip look stream');
  const reader = body.pipeThrough(new DecompressionStream('deflate')).getReader();
  const output = new Uint8Array(expected + 1); let size = 0;
  const cancel = (): void => { void reader.cancel('Grid admission scope disposed').catch(() => undefined); };
  const forget = scope.capture('disposers', cancel);
  try {
    for (;;) {
      liveGridOwner(scope);
      const next = await reader.read(); liveGridOwner(scope);
      if (next.done) break;
      if (next.value.length > expected - size) throw new Error('Grid strip look layout differs');
      output.set(next.value, size); size += next.value.length;
    }
    if (size !== expected) throw new Error('Grid strip look layout differs');
    return output.subarray(0, size);
  } finally {
    forget();
    await reader.cancel().catch(() => undefined);
  }
}

/** Read and decode one phase's blocks for `home` (`key` names its charges), then merge what `within` keeps. */
function readGridBlocks(blocks: readonly CompiledGridBlock[], key: string, home: string, owner: GridStripOwner, read: GridStripFetch,
  pause: () => Promise<void>, within: (x: number, z: number) => boolean, reads = Infinity): Promise<DecodedGridStrips> {
  return decodeGridBlocks(blocks, key, home, owner, read, pause, decoded => mergeGridBlocks(decoded, within), true, reads);
}

/**
 * DF8 (mini-driftwood13g): a paced outer ring (`debug.outerStartPaced`, client grid/outerPaced.ts) reads at most this many
 * of its blocks at a time. Its ~40 blocks started ~80 fetches in one task, in the reveal's fixed step: 32 to 41 ms of their
 * synchronous starts on the iPhone 13. Each next read starts as one lands; the home's own read, on the load's path, still
 * starts all of its blocks at once.
 */
export const OUTER_BLOCK_READS = 4;

/** `fn` over `items` with at most `limit` in flight, results in order; the first failure stops new starts and rejects. */
export async function pooled<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0, failed = false;
  const lane = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i] as T); } catch (error) { failed = true; throw error; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return out;
}

/** Read and decode these blocks under `key`'s charges; `finish` makes the published result (its arrays keep the source charge).
 *  `retain: false` (SB38e's seeds): no look, and `finish` copies what it keeps, so every charge ends with the read. */
async function decodeGridBlocks<T>(blocks: readonly CompiledGridBlock[], key: string, home: string, owner: GridStripOwner, read: GridStripFetch,
  pause: () => Promise<void>, finish: (decoded: readonly DecodedGridBlock[]) => T, retain = true, reads = Infinity): Promise<T> {
  liveGridOwner(owner.scope);
  const abort = new AbortController(), forget = owner.scope.capture('disposers', () => { abort.abort(); });
  const reservations: { readonly release: () => void }[] = [];
  const sourceLeases: { readonly release: () => void }[] = [];
  let releaseSource: (() => void) | undefined, forgetSource: (() => void) | undefined, published = false;
  const reserve = (id: string, bytes: number): { readonly release: () => void } => reserveGridSource(owner, key, home, id, bytes);
  const fetchAsset = async (asset: CompiledGridAddress): Promise<Uint8Array<ArrayBuffer>> => {
    liveGridOwner(owner.scope);
    const bytes = await readGridAssetBytes(asset, url => read(url, abort.signal), 'strips'); liveGridOwner(owner.scope); return bytes;
  };
  try {
    const headerBytes = blocks.reduce((sum, block) => sum + block.header.bytes, 0), bodyBytes = blocks.reduce((sum, block) => sum + block.body.bytes, 0);
    reservations.push(reserve('decode', headerBytes * 2 + bodyBytes * 2));
    sourceLeases.push(reserve('source', bodyBytes * 2 + headerBytes * 4));
    let released = false;
    releaseSource = (): void => { if (!released) { released = true; for (const lease of sourceLeases) lease.release(); } };
    forgetSource = owner.scope.capture('disposers', releaseSource);
    const readBlock = async (block: CompiledGridBlock): Promise<{ header: Uint8Array<ArrayBuffer>; body: Uint8Array<ArrayBuffer> }> => {
      const [header, body] = await Promise.all([fetchAsset(block.header), fetchAsset(block.body)]); return { header, body };
    };
    const wire = reads >= blocks.length ? await Promise.all(blocks.map(readBlock)) : await pooled(blocks, reads, readBlock);
    liveGridOwner(owner.scope);
    const metadata = wire.map(({ header }) => parseCompiledGridHeader(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(header))));
    const lookBytes = retain ? metadata.reduce((sum, row) => sum + (row.look?.codec === 'deflate' ? row.look.vertices * (row.look.colours === true ? 24 : 12) + 1 : 0), 0) : 0;
    if (lookBytes > 0) {
      if (lookBytes > 16 * 1024 * 1024 + blocks.length) throw new Error('Grid strip look layout differs');
      sourceLeases.push(reserve('look-source', lookBytes));
      reservations.push(reserve('look-decode', lookBytes));
    }
    const decoded: DecodedGridBlock[] = [];
    for (const [index, row] of metadata.entries()) {
      const body = wire[index]?.body; if (body === undefined) throw new Error('Missing grid strip block');
      let nativeLook: Uint8Array | undefined;
      if (retain && row.look?.codec === 'deflate' && typeof DecompressionStream !== 'undefined') {
        nativeLook = await inflateGridLook(body.subarray(row.look.offset), row.look.vertices * (row.look.colours === true ? 24 : 12), owner.scope);
      }
      liveGridOwner(owner.scope);
      const steps = blockSteps(row, body, nativeLook, retain);
      try {
        for (;;) {
          liveGridOwner(owner.scope); const step = steps.next();
          if (step.done) { decoded.push(step.value); break; }
          await pause();
        }
      } finally { steps.return({ strips: [], colours: false }); }
    }
    liveGridOwner(owner.scope);
    const merged = finish(decoded);
    published = retain;
    return merged;
  } finally {
    abort.abort(); forget(); for (const reservation of reservations) reservation.release();
    if (!published) { forgetSource?.(); releaseSource?.(); }
  }
}

function deferredGridBlocks(blocks: readonly CompiledGridBlock[], home: string, owner: GridStripOwner, read: GridStripFetch,
  within: (x: number, z: number) => boolean): DeferredGridStrips {
  // Capture only admitted addresses, never the directory, input rows or decoded initial buffers. No module cache owns this.
  const snapshot = blocks.map(block => ({ header: { ...block.header }, body: { ...block.body } }));
  const parent = owner.scope, allocator = owner.allocator;
  let consumed = false;
  return (scope, pause, reads) => {
    if (!scope.belongsTo(parent)) return Promise.reject(new Error('Grid strip continuation has another owner'));
    if (scope.disposed || scope.disposing) return Promise.reject(new Error('Grid admission scope disposed'));
    if (consumed) return Promise.reject(new Error('Grid strip continuation already consumed'));
    consumed = true;
    return readGridBlocks(snapshot, gridStripPageKey(home, 'outer'), home, { scope, allocator }, read, pause, within, reads).then(result => result.strips);
  };
}

/** The charge key of one home's phase. */
export function gridStripPageKey(home: string, phase: GridStripPhase): string { return phase === 'outer' ? `${home}:outer` : home; }

/** SB38e: a home whose live inputs miss every baked source: the build's shapes its strips still name, by shape key. */
export interface CompiledGridSeeds { readonly seeds: ReadonlyMap<string, PlatformShape> }
interface GridStripInput { readonly cells: readonly PlatformCell[]; readonly empty: StripProfile }

/** Optional exact-input baked road. A home with no row uses native construction; corrupt declared data refuses. `within`
 * selects the phase's strips by origin (the session's ring for initial, its complement for outer); an initial read may
 * continue to the outer blocks later, keeping the complement, and each new read still fingerprints its actual inputs. */
export async function readCompiledGridStrips(selector: CompiledGridSelector | undefined, input: GridStripInput, home: string,
  owner: GridStripOwner, read: GridStripFetch, pause: () => Promise<void>, within: (x: number, z: number) => boolean, phase: GridStripPhase = 'initial'): Promise<CompiledGridRead | null> {
  const result = await readGridStrips(selector, input, home, owner, read, pause, within, phase, false);
  return result === null || 'seeds' in result ? null : result;
}

/**
 * `readCompiledGridStrips`, and on a source miss (placements changed since the build: J379's auto-placed uploads) the
 * build's shapes for every strip `within` keeps whose shape key is unchanged, from only the blocks that hold them
 * (SB38e). The page seeds native construction with them (`generatePlatformSliced`'s `known`), so it certifies and builds
 * only the shapes beside a changed cell; every strip is still placed exactly as native placement does.
 */
export function readGridStripsOrSeeds(selector: CompiledGridSelector | undefined, input: GridStripInput, home: string,
  owner: GridStripOwner, read: GridStripFetch, pause: () => Promise<void>, within: (x: number, z: number) => boolean, phase: GridStripPhase = 'initial'): Promise<CompiledGridRead | CompiledGridSeeds | null> {
  return readGridStrips(selector, input, home, owner, read, pause, within, phase, true);
}

async function readGridStrips(selector: CompiledGridSelector | undefined, input: GridStripInput, home: string, owner: GridStripOwner, read: GridStripFetch,
  pause: () => Promise<void>, within: (x: number, z: number) => boolean, phase: GridStripPhase, seeds: boolean): Promise<CompiledGridRead | CompiledGridSeeds | null> {
  const key = gridStripPageKey(home, phase);
  if (selector === undefined || !selector.homes.includes(home)) return null;
  liveGridOwner(owner.scope);
  const abort = new AbortController(), forget = owner.scope.capture('disposers', () => { abort.abort(); });
  let directoryLease: { readonly release: () => void } | undefined;
  try {
    directoryLease = reserveGridSource(owner, key, home, 'directory', selector.directory.bytes * 2);
    const [directory, source] = await Promise.all([
      readGridAssetBytes(selector.directory, url => read(url, abort.signal), 'strips'), platformGeometrySource(input.cells, input.empty)]);
    liveGridOwner(owner.scope);
    const book = parseCompiledGridDirectory(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(directory)));
    const pick = (indices: readonly number[]): CompiledGridBlock[] => indices.map(index => { const block = book.blocks[index]; if (block === undefined) throw new Error('Grid strip directory names a missing block'); return block; });
    const row = book.homes.find(entry => entry.source === source && entry.home === home);
    if (row === undefined) {
      if (!seeds || book.shapes === undefined) return null;
      directoryLease.release(); directoryLease = undefined;
      try { return await readGridSeeds(book.shapes, book.blocks.length, pick, input, key, home, owner, read, abort.signal, pause, within); }
      catch (error) {
        liveGridOwner(owner.scope);
        // Seeds only save work: a refused, corrupt or deferred read keeps the page's native construction, as before SB38e.
        console.warn(`[grid] ${home} builds its road natively: baked shapes unread`, error);
        return null;
      }
    }
    const decoded = await readGridBlocks(pick(row[phase]), key, home, owner, read, pause, within); liveGridOwner(owner.scope);
    const outer = phase === 'initial' && row.outer.length > 0 ? pick(row.outer) : undefined;
    return { ...decoded, ...(outer === undefined ? {} : { readOuter: deferredGridBlocks(outer, home, owner, read, (x, z) => !within(x, z)) }) };
  } finally { abort.abort(); forget(); directoryLease?.release(); }
}

/** The baked shapes these live inputs still name, or null when they name none (or native construction would refuse them). */
async function readGridSeeds(shapeIndex: CompiledGridAddress, blockCount: number, pick: (indices: readonly number[]) => CompiledGridBlock[], input: GridStripInput,
  key: string, home: string, owner: GridStripOwner, read: GridStripFetch, signal: AbortSignal, pause: () => Promise<void>,
  within: (x: number, z: number) => boolean): Promise<CompiledGridSeeds | null> {
  let keys: readonly string[];
  try { keys = platformShapeKeys(input.cells, input.empty, within); }
  catch { return null; } // native construction reports these inputs (and takes its road-level fallback) as before
  const byHash = new Map<string, string>();
  for (const shape of new Set(keys)) byHash.set(await gridShapeKeyHash(shape), shape);
  liveGridOwner(owner.scope);
  const lease = reserveGridSource(owner, key, home, 'shapes', shapeIndex.bytes * 2);
  const hits: { readonly key: string; readonly block: number; readonly row: number }[] = [];
  try {
    const bytes = await readGridAssetBytes(shapeIndex, url => read(url, signal), 'strips'); liveGridOwner(owner.scope);
    const index = parseCompiledGridShapeIndex(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), blockCount);
    for (const [named, block, row] of index.shapes) { const shape = byHash.get(named); if (shape !== undefined) hits.push({ key: shape, block, row }); }
  } finally { lease.release(); }
  if (hits.length === 0) return null;
  const blocks = [...new Set(hits.map(hit => hit.block))].sort((a, b) => a - b), at = new Map(blocks.map((block, index) => [block, index]));
  return decodeGridBlocks(pick(blocks), key, home, owner, read, pause, decoded => {
    const shapes = new Map<string, PlatformShape>();
    for (const hit of hits) {
      const strip = decoded[at.get(hit.block) ?? -1]?.strips[hit.row]?.strip; if (strip === undefined) throw new Error('Grid shape index names a missing row');
      // own copies: the block bodies (often another source's, elsewhere on the grid) are garbage once this returns
      const { positions, colours, indices } = strip.mesh;
      shapes.set(hit.key, { mesh: { positions: positions.slice(), colours: colours.slice(), indices: indices.slice() }, features: strip.features,
        ...(strip.turnIn === undefined ? {} : { turnIn: strip.turnIn }) });
    }
    return { seeds: shapes };
  }, false);
}
