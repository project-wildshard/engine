import * as v from 'valibot';
import { unzlibSync } from 'fflate';
import { GeometryPackData, PackedGeometryRowsSchema, type PackedGeometryRows } from '@wildshard/format/geometryPack';
import type { Scope } from '@wildshard/engine/app/scope';

import type { GeneratedStrip, PlatformCell, StripMesh, StripProfile } from '@wildshard/engine/sim/strips';
import { edgeProfileJson } from '@wildshard/engine/sim/edgeProfiles';
import type { ResidencyAllocator } from './allocator';
import { readGridAssetBytes } from './gridAssetBytes';
import type { SeamGeometryChannels } from './seamGeometry';

type SeamFeature = GeneratedStrip['features'][number];
type SeamFeatureKind = SeamFeature['kind'];
type SeamTurnIn = NonNullable<GeneratedStrip['turnIn']>;

export interface CompiledGridAddress { readonly url: string; readonly bytes: number; readonly sha256: string }
export type GridStripPhase = 'initial' | 'outer';
/** The outer capability has a distinct address and is never read by initial admission. */
export function gridStripPageKey(home: string, phase: GridStripPhase): string { return phase === 'outer' ? `${home}:outer` : home; }
/** Only eligible homes fetch the optional directory; other pages add no data requests. */
export interface CompiledGridSelector { readonly directory: CompiledGridAddress; readonly homes: readonly string[] }
export interface CompiledGridPage { readonly source: string; readonly home: string; readonly header: CompiledGridAddress; readonly body: CompiledGridAddress }
export interface CompiledGridDirectory { readonly version: 1; readonly pages: readonly CompiledGridPage[] }
export interface CompiledGridHeader {
  readonly version: 1; readonly source: string; readonly home: string; readonly rows: PackedGeometryRows;
  readonly surfaces: readonly string[];
  readonly shapes: readonly { readonly features: { readonly offset: number; readonly count: number }; readonly turnIn?: SeamTurnIn }[];
  readonly strips: readonly { readonly id: string; readonly shape: number; readonly origin: { readonly x: number; readonly z: number };
    readonly duplicates: readonly { readonly instance: string; readonly origin: { readonly x: number; readonly z: number } }[] }[];
  readonly look?: { readonly origin: SeamGeometryChannels['origin']; readonly pitch: number; readonly vertices: number; readonly offset: number;
    readonly sphere: SeamGeometryChannels['sphere']; readonly colours?: true; readonly codec?: 'deflate' };
}
const hash = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/u));
const text = v.pipe(v.string(), v.minLength(1), v.maxLength(512));
const natural = v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(16 * 1024 * 1024));
// JSON cannot carry signed zero. Only numerical fields accept its wire token.
const finite = v.pipe(v.union([v.pipe(v.number(), v.finite()), v.literal('-0')]), v.transform(value => value === '-0' ? -0 : value));
const point = v.strictObject({ x: finite, z: finite });
const address = (extension: 'json' | 'bin') => v.strictObject({ url: v.pipe(v.string(), v.regex(new RegExp(`^/assets/grid-strip-${extension === 'json' ? '(?:book|page)' : 'mesh'}-[a-f0-9]{8}\\.${extension}$`, 'u'))),
  bytes: v.pipe(natural, v.minValue(1)), sha256: hash });
const directorySchema = v.strictObject({ version: v.literal(1), pages: v.pipe(v.array(v.strictObject({ source: hash, home: text, header: address('json'), body: address('bin') })), v.maxLength(512)) });
/** The build and runtime share the original bounded directory admission. */
export function parseCompiledGridDirectory(input: unknown): CompiledGridDirectory { return v.parse(directorySchema, input); }
/** Stable binary feature codes; numeric records retain their exact Float64 words. */
export const GRID_STRIP_FEATURE_KINDS: readonly SeamFeatureKind[] = ['deck', 'neutral-buffer', 'gradient', 'overlap', 'retaining-wall', 'cliff', 'talus', 'parapet', 'dike', 'culvert', 'guard-rail', 'road-wall', 'turn-in', 'revetment'];
const headerSchema = v.strictObject({ version: v.literal(1), source: hash, home: text, rows: PackedGeometryRowsSchema,
  surfaces: v.pipe(v.array(text), v.maxLength(2048)),
  shapes: v.pipe(v.array(v.strictObject({ features: v.strictObject({ offset: natural, count: v.pipe(natural, v.maxValue(100_000)) }), turnIn: v.exactOptional(v.strictObject({ at: v.literal(0), widths: v.tuple([finite, finite]) })) })), v.minLength(1), v.maxLength(128)),
  strips: v.pipe(v.array(v.strictObject({ id: text, shape: natural, origin: point, duplicates: v.pipe(v.array(v.strictObject({ instance: text, origin: point })), v.maxLength(4)) })), v.minLength(1), v.maxLength(256)),
  look: v.exactOptional(v.strictObject({ origin: point, pitch: v.pipe(v.number(), v.finite(), v.minValue(1)), vertices: natural, offset: natural,
    sphere: v.strictObject({ centre: v.tuple([finite, finite, finite]), radius: v.pipe(v.number(), v.finite(), v.minValue(0)) }), colours: v.exactOptional(v.literal(true)), codec: v.exactOptional(v.literal('deflate')) })) });

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

interface DecodedGridStrips { readonly strips: readonly GeneratedStrip[]; readonly look?: SeamGeometryChannels }
// Only these public decoders or the verified file reader admit this private
// snapshot. Keep all binary/source/feature/finite checks in the same steps.
function* stripSteps(header: CompiledGridHeader, bytes: Uint8Array, source: string, home: string, nativeLook?: Uint8Array): Generator<void, DecodedGridStrips> {
  if (header.source !== source || header.home !== home || header.rows.geometries.length !== header.shapes.length) throw new Error('Grid strip source differs from this page');
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
  const result: GeneratedStrip[] = [];
  for (const strip of header.strips) {
    const shape = shapes[strip.shape], metadata = header.shapes[strip.shape];
    if (shape === undefined || metadata === undefined || new Set(strip.duplicates.map(row => row.instance)).size !== strip.duplicates.length) throw new Error('Invalid grid strip placement');
    const mesh = { ...shape.mesh, origin: strip.origin };
    const duplicates: GeneratedStrip['duplicates'][number][] = [];
    for (const row of strip.duplicates) duplicates.push({ instance: row.instance, mesh: { ...shape.mesh, origin: row.origin } });
    result.push({ id: strip.id, mesh, features: shape.features, ...(metadata.turnIn === undefined ? {} : { turnIn: metadata.turnIn }), duplicates });
  }
  const look = header.look;
  if (look === undefined) return { strips: result };
  const vertices = result.reduce((sum, strip) => sum + strip.mesh.positions.length / 3, 0);
  const decodedBytes = vertices * (look.colours === true ? 32 : 20);
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
  const normals = floats(0, vertices * 3), uvs = floats(vertices * 12, vertices * 2);
  return { strips: result, look: { origin: look.origin, pitch: look.pitch, sphere: look.sphere, normals, uvs,
    ...(look.colours === true ? { colours: floats(vertices * 20, vertices * 3) } : {}) } };
}

/** Renderer-free exact decoder for authoring and byte-parity qualification. */
export function decodeCompiledGridStrips(input: unknown, bytes: Uint8Array, source: string, home: string): readonly GeneratedStrip[] {
  const steps = stripSteps(parseCompiledGridHeader(input), bytes, source, home);
  for (;;) { const step = steps.next(); if (step.done) return step.value.strips; }
}

/** Decode the optional source-verified normal/UV channels alongside the original collision triangles. */
export function decodeCompiledGridLook(input: unknown, bytes: Uint8Array, source: string, home: string): DecodedGridStrips {
  const steps = stripSteps(parseCompiledGridHeader(input), bytes, source, home);
  for (;;) { const step = steps.next(); if (step.done) return step.value; }
}

interface GridStripOwner { readonly scope: Scope; readonly allocator: ResidencyAllocator }
type GridStripFetch = (url: string, signal: AbortSignal) => Promise<Response>;
/** Continuation of the original admitted source, restricted to its owner tree. */
export type DeferredGridStrips = (scope: Scope, pause: () => Promise<void>) => Promise<readonly GeneratedStrip[]>;
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

async function readDeclaredGridPage(page: CompiledGridPage, home: string, owner: GridStripOwner, read: GridStripFetch, pause: () => Promise<void>): Promise<DecodedGridStrips> {
  liveGridOwner(owner.scope);
  const abort = new AbortController(), forget = owner.scope.capture('disposers', () => { abort.abort(); });
  const reservations: { readonly release: () => void }[] = [];
  const sourceLeases: { readonly release: () => void }[] = [];
  let releaseSource: (() => void) | undefined, forgetSource: (() => void) | undefined, published = false;
  const reserve = (id: string, bytes: number): { readonly release: () => void } => reserveGridSource(owner, page.home, home, id, bytes);
  const fetchAsset = async (asset: CompiledGridAddress): Promise<Uint8Array<ArrayBuffer>> => {
    liveGridOwner(owner.scope);
    const bytes = await readGridAssetBytes(asset, url => read(url, abort.signal), 'strips'); liveGridOwner(owner.scope); return bytes;
  };
  try {
    reservations.push(reserve('decode', page.header.bytes * 2 + page.body.bytes * 2));
    const sourceLease = reserve('source', page.body.bytes * 2 + page.header.bytes * 4);
    sourceLeases.push(sourceLease);
    let released = false;
    releaseSource = (): void => { if (!released) { released = true; for (const lease of sourceLeases) lease.release(); } };
    forgetSource = owner.scope.capture('disposers', releaseSource);
    const [header, body] = await Promise.all([fetchAsset(page.header), fetchAsset(page.body)]); liveGridOwner(owner.scope);
    const metadata = parseCompiledGridHeader(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(header)));
    let nativeLook: Uint8Array | undefined;
    if (metadata.look?.codec === 'deflate') {
      const decodedBytes = metadata.look.vertices * (metadata.look.colours === true ? 32 : 20) + 1;
      if (decodedBytes > 16 * 1024 * 1024 + 1) throw new Error('Grid strip look layout differs');
      sourceLeases.push(reserve('look-source', decodedBytes));
      reservations.push(reserve('look-decode', decodedBytes));
      if (typeof DecompressionStream !== 'undefined') nativeLook = await inflateGridLook(body.subarray(metadata.look.offset), decodedBytes - 1, owner.scope);
    }
    liveGridOwner(owner.scope);
    const steps = stripSteps(metadata, body, page.source, page.home, nativeLook);
    try {
      for (;;) {
        liveGridOwner(owner.scope); const step = steps.next();
        if (step.done) { published = true; return step.value; }
        await pause();
      }
    } finally { steps.return({ strips: [] }); }
  } finally {
    abort.abort(); forget(); for (const reservation of reservations) reservation.release();
    if (!published) { forgetSource?.(); releaseSource?.(); }
  }
}

function deferredGridPage(page: CompiledGridPage, home: string, owner: GridStripOwner, read: GridStripFetch): DeferredGridStrips {
  // Capture only admitted addresses/source, never the directory, input rows
  // or decoded initial buffers. No module cache owns this continuation.
  const snapshot = { source: page.source, home: page.home, header: { ...page.header }, body: { ...page.body } };
  const parent = owner.scope, allocator = owner.allocator;
  let consumed = false;
  return (scope, pause) => {
    if (!scope.belongsTo(parent)) return Promise.reject(new Error('Grid strip continuation has another owner'));
    if (scope.disposed || scope.disposing) return Promise.reject(new Error('Grid admission scope disposed'));
    if (consumed) return Promise.reject(new Error('Grid strip continuation already consumed'));
    consumed = true;
    return readDeclaredGridPage(snapshot, home, { scope, allocator }, read, pause).then(result => result.strips);
  };
}

/** Optional exact-input baked ring. Missing entries use native construction;
 * corrupt declared data refuses. Initial admission may continue its SAME
 * verified source later; each new read still fingerprints its actual inputs. */
export async function readCompiledGridStrips(selector: CompiledGridSelector | undefined, input: { readonly cells: readonly PlatformCell[]; readonly empty: StripProfile }, home: string,
  owner: GridStripOwner, read: GridStripFetch, pause: () => Promise<void>, phase: GridStripPhase = 'initial'): Promise<CompiledGridRead | null> {
  const key = gridStripPageKey(home, phase);
  if (selector === undefined || !selector.homes.includes(key)) return null;
  liveGridOwner(owner.scope);
  const abort = new AbortController(), forget = owner.scope.capture('disposers', () => { abort.abort(); });
  let directoryLease: { readonly release: () => void } | undefined;
  try {
    directoryLease = reserveGridSource(owner, key, home, 'directory', selector.directory.bytes * 2);

    const [directory, source] = await Promise.all([
      readGridAssetBytes(selector.directory, url => read(url, abort.signal), 'strips'), platformGeometrySource(input.cells, input.empty)]);
    liveGridOwner(owner.scope);
    const book = parseCompiledGridDirectory(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(directory)));
    if (new Set(book.pages.map(page => `${page.source}/${page.home}`)).size !== book.pages.length) throw new Error('Duplicate grid strip page');
    const page = book.pages.find(row => row.source === source && row.home === key); if (page === undefined) return null;
    const decoded = await readDeclaredGridPage(page, home, owner, read, pause); liveGridOwner(owner.scope);
    const outerKey = gridStripPageKey(home, 'outer');
    const outer = phase === 'initial' && selector.homes.includes(outerKey) ? book.pages.find(row => row.source === source && row.home === outerKey) : undefined;
    return { ...decoded, ...(outer === undefined ? {} : { readOuter: deferredGridPage(outer, home, owner, read) }) };
  } finally { abort.abort(); forget(); directoryLease?.release(); }
}
