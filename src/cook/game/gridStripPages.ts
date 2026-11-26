/// <reference types="node" />
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import { homedir } from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import { basename, join, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The cook is a Node process (J28).
import { isDeepStrictEqual } from 'node:util';
import { StripPackWriter } from './stripPack';
import { gridLookBytes } from './encodedBytes';
import type { GeneratedStrip } from '@wildshard/engine/sim/strips';
import { GRID_STRIP_FEATURE_KINDS, decodeCompiledGridBlock, mergeGridBlocks, parseCompiledGridDirectory, parseCompiledGridHeader, parseCompiledGridShapeIndex, type CompiledGridAddress, type CompiledGridDirectory, type CompiledGridHeader, type CompiledGridSelector, type DecodedGridBlock } from '../../shared/game/grid/compiledStrips';
import { seamMeshSteps } from '../../shared/game/grid/seamGeometry';
import { BrotliSizeCache } from './brotliSizeCache.mjs';

// What a deploy sends for these bytes, the page host's on-the-fly Brotli.
const wireSizes = new BrotliSizeCache(process.env['WILDSHARD_WIRE_SIZE_CACHE'] ?? resolve(homedir(), '.cache/wildshard/gen/served-bytes/1'));
const servedBytes = (bytes: Uint8Array): number => wireSizes.bytes(bytes);

export interface CompiledGridArtifact { readonly address: CompiledGridAddress; readonly bytes: Uint8Array }
/** One encoded shared block (ZONE-ENTRY ZE4). */
export interface CompiledGridBlockFile { readonly block: string; readonly header: CompiledGridArtifact; readonly body: CompiledGridArtifact }
/** One home's road as a build row: `added` is the wire of its directory and its blocks, `set` the whole block set's ratchet. */
export interface GridStripWireRow { readonly source: string; readonly home: string; readonly slug: string; readonly added: number; readonly set: number; readonly included: boolean; readonly outer: boolean }
/** One seam source's whole native road and the homes that read it. `keys` (SB38e): each strip's shape key
 *  (`platformShapeKeys`, in the same order); when every source has them the build writes the shape index. */
export interface GridStripSource { readonly source: string; readonly pitch: number; readonly strips: readonly GeneratedStrip[]; readonly keys?: readonly string[];
  readonly homes: readonly { readonly instance: string; readonly slug: string; readonly origin: { readonly x: number; readonly z: number } }[] }
export interface CompiledGridBuild {
  readonly geometry?: CompiledGridSelector; readonly files: readonly CompiledGridAddress[]; readonly rows: readonly GridStripWireRow[];
}
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value, (_key, item: unknown) => typeof item === 'number' && Object.is(item, -0) ? '-0' : item));
/** Plain acyclic data has the same equality before and after JSON transport.
 * Accessors, JSON hooks and other values retain the original codec comparison. */
function plainFacts(value: unknown, parents: Set<object>): boolean {
  if (value === null || typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value !== 'object' || parents.has(value) || 'toJSON' in value) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && (!Array.isArray(value) || prototype !== Array.prototype)) return false;
  parents.add(value);
  try {
    for (const key of Object.keys(value)) {
      const field = Object.getOwnPropertyDescriptor(value, key);
      if (field === undefined || !('value' in field)) return false;
      const child: unknown = field.value;
      if (!plainFacts(child, parents)) return false;
    }
    return true;
  } finally { parents.delete(value); }
}
/** Optional outer pages over the original transport cap retain native construction. */
export class GridStripTransportLimitError extends Error {
  constructor(message: string) { super(message); this.name = 'GridStripTransportLimitError'; }
}
function artifact(bytes: Uint8Array, extension: 'json' | 'bin', kind: 'book' | 'page' | 'mesh'): CompiledGridArtifact {
  const sha256 = hash(bytes);
  if (bytes.length === 0 || bytes.length > 16 * 1024 * 1024) throw new GridStripTransportLimitError('Grid strip artifact exceeds its transport cap');
  return { bytes, address: { url: `/assets/grid-strip-${kind}-${sha256.slice(0, 8)}.${extension}`, bytes: bytes.length, sha256 } };
}

/** A strip's block: the pitch square its origin stands in (blocks are storage; each home keeps the strips its ring selects). */
export function gridStripBlockKey(origin: { readonly x: number; readonly z: number }, pitch: number): string {
  return `${String(Math.floor(origin.x / pitch))},${String(Math.floor(origin.z / pitch))}`;
}

function encodeLookChannels(normals: Float32Array, colours: Float32Array | undefined): Uint8Array {
  const bytes = new Uint8Array(normals.byteLength + (colours?.byteLength ?? 0));
  bytes.set(new Uint8Array(normals.buffer, normals.byteOffset, normals.byteLength));
  if (colours !== undefined) bytes.set(new Uint8Array(colours.buffer, colours.byteOffset, colours.byteLength), normals.byteLength);
  return gridLookBytes.encode(bytes);
}

/** The frame-free look of these strips, as the page's own merge makes it: each strip's normals and default colours. */
function blockLook(strips: readonly GeneratedStrip[], pitch: number): { readonly normals: Float32Array; readonly colours: Float32Array } {
  const steps = seamMeshSteps(strips, { origin: { x: 0, z: 0 } }, undefined, pitch);
  for (;;) { const next = steps.next(); if (next.done) return { normals: next.value.normal, colours: next.value.colour }; }
}

const sameWords = (a: ArrayBufferView, b: ArrayBufferView): boolean => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

/** One shared block: the strips' original indexed words, never deduplicated or quantized, each with its native order. */
export function encodeGridStripBlock(block: string, strips: readonly { readonly strip: GeneratedStrip; readonly order: number }[], pitch?: number): CompiledGridBlockFile {
  const writer = new StripPackWriter(), indices = new Map<string, number>(), shapes: CompiledGridHeader['shapes'][number][] = [];
  const rows: CompiledGridHeader['strips'][number][] = [];
  const featureWords: number[] = [], surfaces: string[] = [], surfaceCodes = new Map<string, number>();
  for (const { strip, order } of strips) {
    const { mesh, features, turnIn } = strip;
    const digest = createHash('sha256');
    digest.update(json([mesh.positions.length, mesh.colours.length, mesh.indices.length]));
    for (const array of [mesh.positions, mesh.colours, mesh.indices]) digest.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
    digest.update(json({ features, ...(turnIn === undefined ? {} : { turnIn }) }));
    const key = digest.digest('hex'); let shape = indices.get(key);
    if (shape === undefined) {
      shape = writer.add(mesh.positions, mesh.colours, mesh.indices);
      const offset = featureWords.length / 9;
      for (const feature of features) {
        let surface = -1;
        if (feature.sourceSurface !== undefined) {
          const previous = surfaceCodes.get(feature.sourceSurface);
          if (previous !== undefined) surface = previous;
          else { surface = surfaces.length; surfaces.push(feature.sourceSurface); surfaceCodes.set(feature.sourceSurface, surface); }
        }
        featureWords.push(GRID_STRIP_FEATURE_KINDS.indexOf(feature.kind), feature.firstIndex, feature.indexCount, feature.side, feature.from, feature.to, feature.bottom, feature.top, surface);
      }
      indices.set(key, shape); shapes.push({ features: { offset, count: features.length }, ...(turnIn === undefined ? {} : { turnIn }) });
    }
    const duplicates: CompiledGridHeader['strips'][number]['duplicates'][number][] = [];
    for (const duplicate of strip.duplicates) {
      for (const field of ['positions', 'colours', 'indices'] as const) if (!sameWords(mesh[field], duplicate.mesh[field])) throw new Error('Grid strip duplicate changed native words');
      duplicates.push({ instance: duplicate.instance, origin: { ...duplicate.mesh.origin } });
    }
    rows.push({ id: strip.id, order, shape, origin: { ...mesh.origin }, duplicates });
  }
  const geometry = writer.bytes(), featureStart = Math.ceil(geometry.length / 8) * 8;
  const featureEnd = featureStart + featureWords.length * 8;
  const native = strips.map(row => row.strip);
  let look = pitch === undefined ? undefined : blockLook(native, pitch);
  let withColours = look !== undefined;
  if (look !== undefined && look.normals.byteLength + look.colours.byteLength > 16 * 1024 * 1024) withColours = false;
  // Optional render channels cannot remove a native triangle bank that fits.
  if (look !== undefined && look.normals.byteLength > 16 * 1024 * 1024) look = undefined;
  let lookBytes = look === undefined ? new Uint8Array() : encodeLookChannels(look.normals, withColours ? look.colours : undefined);
  if (featureEnd + lookBytes.length > 16 * 1024 * 1024) { look = undefined; lookBytes = new Uint8Array(); }
  const packed = new Uint8Array(featureEnd + lookBytes.length); packed.set(geometry);
  const view = new DataView(packed.buffer);
  for (const [index, value] of featureWords.entries()) view.setFloat64(featureStart + index * 8, value, true);
  packed.set(lookBytes, featureEnd);
  const header = artifact(json({ version: 2, block, rows: writer.rows(), surfaces, shapes, strips: rows,
    ...(look === undefined || pitch === undefined ? {} : { look: { pitch, vertices: look.normals.length / 3, offset: featureEnd, codec: 'deflate' as const,
      ...(withColours ? { colours: true as const } : {}) } }) } satisfies CompiledGridHeader), 'json', 'page');
  // Exercise the same valibot grammar the runtime admits, including signed zero.
  parseCompiledGridHeader(JSON.parse(new TextDecoder().decode(header.bytes)));
  const body = artifact(packed, 'bin', 'mesh');
  // Certify the bytes that will ship against this build's actual native output.
  const decoded = decodeCompiledGridBlock(JSON.parse(new TextDecoder().decode(header.bytes)), body.bytes);
  certifyStrips(decoded.strips.map(row => row.strip), native);
  for (const [index, row] of decoded.strips.entries()) if (row.order !== strips[index]?.order) throw new Error('Grid strip bake changed its order');
  if (look !== undefined) {
    let at = 0;
    for (const row of decoded.strips) {
      const count = row.strip.mesh.positions.length;
      if (row.normals === undefined || !sameWords(row.normals, look.normals.subarray(at, at + count))) throw new Error('Grid strip bake changed look words');
      if (withColours && (row.colours === undefined || !sameWords(row.colours, look.colours.subarray(at, at + count)))) throw new Error('Grid strip bake changed look words');
      at += count;
    }
  }
  return { block, header, body };
}

/** Exact shape equality: words, features and turn-in (placement is each strip's own). */
function certifyShape(strip: GeneratedStrip, shape: GeneratedStrip): void {
  for (const field of ['positions', 'colours', 'indices'] as const) if (!sameWords(strip.mesh[field], shape.mesh[field])) throw new Error('Grid shape key names two shapes');
  if (!isDeepStrictEqual(JSON.parse(new TextDecoder().decode(json({ features: strip.features, turnIn: strip.turnIn ?? null }))),
    JSON.parse(new TextDecoder().decode(json({ features: shape.features, turnIn: shape.turnIn ?? null }))))) throw new Error('Grid shape key names two shapes');
}

/** Exact strip equality: order, ids, original words, placement, features and duplicates. */
function certifyStrips(decoded: readonly GeneratedStrip[], strips: readonly GeneratedStrip[]): void {
  if (decoded.length !== strips.length) throw new Error('Grid strip bake changed its order');
  for (const [index, original] of strips.entries()) {
    const copy = decoded[index]; if (copy === undefined || copy.id !== original.id) throw new Error('Grid strip bake changed its order');
    for (const field of ['positions', 'colours', 'indices'] as const) if (!sameWords(original.mesh[field], copy.mesh[field])) throw new Error('Grid strip bake changed native words');
    const facts = (strip: GeneratedStrip): unknown => ({ origin: strip.mesh.origin, features: strip.features,
      turnIn: strip.turnIn ?? null, duplicates: strip.duplicates.map(row => ({ instance: row.instance, origin: row.mesh.origin })) });
    const before = facts(original), after = facts(copy);
    // Header/shape serialization above already exercises these JSON inputs.
    // Equal native fields need no extra UTF-8/JSON copies. Different optional
    // field representations retain the original canonical comparison.
    const direct = plainFacts(before, new Set()) && plainFacts(after, new Set()) && isDeepStrictEqual(before, after);
    if (!direct && !isDeepStrictEqual(JSON.parse(new TextDecoder().decode(json(before))),
      JSON.parse(new TextDecoder().decode(json(after))))) throw new Error('Grid strip bake changed physical placement or features');
  }
}

/**
 * The whole block set's wire ratchet: budgets/grid-strip-room.json's `perHome` room times the distinct homes baked. Preview
 * bakes staging's placed cells (SA35), and each brings its own road, so the room scales with the grid, not a fixed 25.
 */
export function gridStripSetBudget(room: unknown, sources: readonly GridStripSource[]): number {
  const perHome = typeof room === 'object' && room !== null && 'perHome' in room ? room.perHome : undefined;
  if (typeof perHome !== 'number' || !Number.isInteger(perHome) || perHome <= 0) throw new Error('budgets/grid-strip-room.json needs a positive integer perHome');
  return perHome * new Set(sources.flatMap(source => source.homes.map(home => home.instance))).size;
}

/**
 * Whether a strip set over its room fails the build or is only reported. A shipping build fails. Two builds bake a grid that
 * never ships, so they report: a dev build over the shared staging snapshot (more cells than the pin), and a Ring build,
 * whose catalogue (src/scripts/pins.ts ringCatalogue, out/.ring-catalogue.json) stands Brasscap road in for every shard the
 * ring leaves out. A release (WS_RELEASE=1) always fails.
 */
export function gridStripOverRoom(env: Readonly<Record<string, string | undefined>>): 'fail' | 'report' {
  if (env['WS_RELEASE'] === '1') return 'fail';
  if (env['WS_DEV_STAGING'] === '1') return 'report';
  const catalogue = env['WILDSHARD_CATALOGUE'];
  return catalogue !== undefined && basename(catalogue) === '.ring-catalogue.json' ? 'report' : 'fail';
}

/**
 * Bake every source's road as shared blocks and one directory, certify each home's two phases against native, and write
 * them under out/.app/grid-strip-pages. `reach` is the session's ring (a strip whose origin is within it of the home is
 * initial, the rest outer); `set` is the whole block set's wire ratchet (budgets/grid-strip-room.json).
 */
export function writeGridStripBlocks(root: string, seams: string, sources: readonly GridStripSource[], reach: number, set: number, report?: (message: string) => void): CompiledGridBuild {
  if (new Set(sources.map(row => row.source)).size !== sources.length) throw new Error('Grid strip source is not deterministic');
  const blocks: CompiledGridBlockFile[] = [], blockIndex = new Map<string, number>(), decodedBlocks: DecodedGridBlock[] = [];
  const homes: CompiledGridDirectory['homes'][number][] = [], owners: { readonly source: string; readonly home: string; readonly slug: string }[] = [];
  // SB38e: shape key hash -> the first block row holding its words, and the native strip that row was certified against.
  const indexed = sources.length > 0 && sources.every(source => source.keys?.length === source.strips.length);
  const shapeRows = new Map<string, { readonly block: number; readonly row: number; readonly strip: GeneratedStrip }>();
  for (const source of [...sources].sort((a, b) => a.source.localeCompare(b.source))) {
    const groups = new Map<string, { strip: GeneratedStrip; order: number }[]>();
    for (const [order, strip] of source.strips.entries()) {
      const key = gridStripBlockKey(strip.mesh.origin, source.pitch), rows = groups.get(key) ?? [];
      rows.push({ strip, order }); groups.set(key, rows);
    }
    const sourceBlocks = new Map<string, number>();
    for (const [key, rows] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      const file = encodeGridStripBlock(key, rows, source.pitch), identity = `${file.header.address.sha256}/${file.body.address.sha256}`;
      let index = blockIndex.get(identity);
      if (index === undefined) {
        index = blocks.length; blocks.push(file); blockIndex.set(identity, index);
        decodedBlocks.push(decodeCompiledGridBlock(JSON.parse(new TextDecoder().decode(file.header.bytes)), file.body.bytes));
      }
      sourceBlocks.set(key, index);
      if (!indexed) continue;
      for (const [row, { strip, order }] of rows.entries()) {
        const shape = source.keys?.[order]; if (shape === undefined) throw new Error('Missing grid shape key');
        const named = hash(new TextEncoder().encode(shape)), previous = shapeRows.get(named);
        // A shape key names one shape: every strip under it carries the same words, features and turn-in.
        if (previous !== undefined) { certifyShape(strip, previous.strip); continue; }
        if (decodedBlocks[index]?.strips[row]?.strip.id !== strip.id) throw new Error('Grid shape index row differs');
        shapeRows.set(named, { block: index, row, strip });
      }
    }
    for (const home of [...source.homes].sort((a, b) => a.instance.localeCompare(b.instance))) {
      const within = (x: number, z: number): boolean => Math.abs(x - home.origin.x) <= reach && Math.abs(z - home.origin.z) <= reach;
      const initial = new Set<number>(), outer = new Set<number>();
      for (const strip of source.strips) {
        const index = sourceBlocks.get(gridStripBlockKey(strip.mesh.origin, source.pitch)); if (index === undefined) throw new Error('Missing grid strip block');
        (within(strip.mesh.origin.x, strip.mesh.origin.z) ? initial : outer).add(index);
      }
      const row = { source: source.source, home: home.instance, initial: [...initial].sort((a, b) => a - b), outer: [...outer].sort((a, b) => a - b) };
      // Certify the page's own merge for both phases against this build's native road.
      for (const [phase, keep] of [['initial', within], ['outer', (x: number, z: number) => !within(x, z)]] as const) {
        const merged = mergeGridBlocks(row[phase].map(index => { const block = decodedBlocks[index]; if (block === undefined) throw new Error('Missing grid strip block'); return block; }), keep);
        certifyStrips(merged.strips, source.strips.filter(strip => keep(strip.mesh.origin.x, strip.mesh.origin.z)));
      }
      homes.push(row); owners.push({ source: source.source, home: home.instance, slug: home.slug });
    }
  }
  const shapeIndex = { version: 1 as const, shapes: [...shapeRows].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([named, row]) => [named, row.block, row.row] as const) };
  const shapes = indexed && blocks.length > 0 ? artifact(json(shapeIndex), 'json', 'book') : undefined;
  if (shapes !== undefined) parseCompiledGridShapeIndex(JSON.parse(new TextDecoder().decode(shapes.bytes)), blocks.length);
  const book = { version: 2 as const, blocks: blocks.map(file => ({ header: file.header.address, body: file.body.address })), homes,
    ...(shapes === undefined ? {} : { shapes: shapes.address }) };
  parseCompiledGridDirectory(JSON.parse(new TextDecoder().decode(json(book))));
  const directory = artifact(json(book), 'json', 'book');
  const files = new Map<string, CompiledGridArtifact>();
  for (const file of blocks.length === 0 ? [] : [directory, ...(shapes === undefined ? [] : [shapes]), ...blocks.flatMap(block => [block.header, block.body])]) {
    const previous = files.get(file.address.url);
    if (previous !== undefined && previous.address.sha256 !== file.address.sha256) throw new Error('Grid strip content URL collision');
    files.set(file.address.url, file);
  }
  const wire = new Map([...files.values()].map(file => [file.address.sha256, servedBytes(file.bytes)]));
  const total = [...wire.values()].reduce((sum, bytes) => sum + bytes, 0);
  if (total > set) {
    const message = `Grid strip blocks are ${String(total)} wire bytes, over the ${String(set)} in budgets/grid-strip-room.json`;
    if (report === undefined) throw new Error(message);
    report(message);
  }
  const folder = join(root, 'out/.app/grid-strip-pages'); rmSync(folder, { recursive: true, force: true }); mkdirSync(folder, { recursive: true });
  for (const file of files.values()) writeFileSync(join(folder, basename(file.address.url)), file.bytes);
  const blockWire = (index: number): number => { const block = blocks[index]; return block === undefined ? 0 : (wire.get(block.header.address.sha256) ?? 0) + (wire.get(block.body.address.sha256) ?? 0); };
  const rows: GridStripWireRow[] = homes.map((row, index) => {
    const owner = owners[index]; if (owner === undefined) throw new Error('Missing grid page owner');
    return { source: row.source, home: row.home, slug: owner.slug, included: row.initial.length > 0, outer: row.outer.length > 0, set,
      added: (wire.get(directory.address.sha256) ?? 0) + [...new Set([...row.initial, ...row.outer])].reduce((sum, block) => sum + blockWire(block), 0) };
  });
  const homesWithRows = [...new Set(homes.map(row => row.home))].sort();
  const result: CompiledGridBuild = { ...(blocks.length === 0 ? {} : { geometry: { directory: directory.address, homes: homesWithRows } }),
    files: [...files.values()].map(file => file.address), rows };
  writeFileSync(join(root, 'out/.app/grid-strip-index.json'), JSON.stringify({ seams, ...result }));
  return result;
}
