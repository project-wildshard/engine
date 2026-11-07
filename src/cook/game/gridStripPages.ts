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
import { GRID_STRIP_FEATURE_KINDS, decodeCompiledGridLook, gridStripPageKey, parseCompiledGridHeader, type CompiledGridAddress, type CompiledGridHeader, type CompiledGridPage, type CompiledGridSelector, type GridStripPhase } from '../../shared/game/grid/compiledStrips';
import { seamMeshSteps, type SeamGeometryChannels } from '../../shared/game/grid/seamGeometry';
import { BrotliSizeCache } from './brotliSizeCache.mjs';

// What a deploy sends for these bytes, Vercel's on-the-fly Brotli.
const wireSizes = new BrotliSizeCache(process.env['WILDSHARD_WIRE_SIZE_CACHE'] ?? resolve(homedir(), '.cache/wildshard/gen/served-bytes/1'));
const servedBytes = (bytes: Uint8Array): number => wireSizes.bytes(bytes);

export interface CompiledGridArtifact { readonly address: CompiledGridAddress; readonly bytes: Uint8Array }
export interface CompiledGridCandidate { readonly page: CompiledGridPage; readonly owner: string; readonly phase: GridStripPhase; readonly slug: string; readonly header: CompiledGridArtifact; readonly body: CompiledGridArtifact }
export interface GridStripWireRow { readonly source: string; readonly home: string; readonly slug: string; readonly added: number; readonly room: number | null; readonly included: boolean; readonly outer: boolean }
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

function bakeLookChannels(strips: readonly GeneratedStrip[], frame: Pick<SeamGeometryChannels, 'origin' | 'pitch'>): SeamGeometryChannels {
  const steps = seamMeshSteps(strips, { origin: frame.origin }, undefined, frame.pitch);
  for (;;) {
    const next = steps.next(); if (!next.done) continue;
    const { normal, uv, colour, sphere } = next.value;
    return { origin: { x: frame.origin.x, z: frame.origin.z }, pitch: frame.pitch, normals: normal, uvs: uv, colours: colour, sphere };
  }
}

function encodeLookChannels(look: SeamGeometryChannels): Uint8Array {
  const bytes = new Uint8Array(look.normals.byteLength + look.uvs.byteLength + (look.colours?.byteLength ?? 0));
  bytes.set(new Uint8Array(look.normals.buffer, look.normals.byteOffset, look.normals.byteLength));
  bytes.set(new Uint8Array(look.uvs.buffer, look.uvs.byteOffset, look.uvs.byteLength), look.normals.byteLength);
  if (look.colours !== undefined) bytes.set(new Uint8Array(look.colours.buffer, look.colours.byteOffset, look.colours.byteLength), look.normals.byteLength + look.uvs.byteLength);
  return gridLookBytes.encode(bytes);
}

/** Store the original indexed words, never deduplicate vertices or quantize them. */
export function encodeGridStripPage(source: string, home: string, slug: string, strips: readonly GeneratedStrip[], phase: GridStripPhase = 'initial', frame?: Pick<SeamGeometryChannels, 'origin' | 'pitch'>): CompiledGridCandidate {
  const keyHome = gridStripPageKey(home, phase);
  const writer = new StripPackWriter(), indices = new Map<string, number>(), shapes: CompiledGridHeader['shapes'][number][] = [];
  const rows: CompiledGridHeader['strips'][number][] = [];
  const featureWords: number[] = [], surfaces: string[] = [], surfaceCodes = new Map<string, number>();
  for (const strip of strips) {
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
      for (const field of ['positions', 'colours', 'indices'] as const) {
        const a = mesh[field], b = duplicate.mesh[field];
        if (!Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength))) throw new Error('Grid strip duplicate changed native words');
      }
      duplicates.push({ instance: duplicate.instance, origin: { ...duplicate.mesh.origin } });
    }
    rows.push({ id: strip.id, shape, origin: { ...mesh.origin }, duplicates });
  }
  const geometry = writer.bytes(), featureStart = Math.ceil(geometry.length / 8) * 8;
  const featureEnd = featureStart + featureWords.length * 8;
  let look = frame === undefined ? undefined : bakeLookChannels(strips, frame);
  if (look !== undefined && look.normals.byteLength + look.uvs.byteLength + (look.colours?.byteLength ?? 0) > 16 * 1024 * 1024) {
    look = { origin: look.origin, pitch: look.pitch, normals: look.normals, uvs: look.uvs, sphere: look.sphere };
  }
  // Optional render channels cannot remove a native triangle bank that fits.
  if (look !== undefined && look.normals.byteLength + look.uvs.byteLength > 16 * 1024 * 1024) look = undefined;
  let lookBytes = look === undefined ? new Uint8Array() : encodeLookChannels(look);
  if (featureEnd + lookBytes.length > 16 * 1024 * 1024) { look = undefined; lookBytes = new Uint8Array(); }
  const packed = new Uint8Array(featureEnd + lookBytes.length); packed.set(geometry);
  const view = new DataView(packed.buffer);
  for (const [index, value] of featureWords.entries()) view.setFloat64(featureStart + index * 8, value, true);
  packed.set(lookBytes, featureEnd);
  const header = artifact(json({ version: 1, source, home: keyHome, rows: writer.rows(), surfaces, shapes, strips: rows,
    ...(look === undefined ? {} : { look: { origin: look.origin, pitch: look.pitch, vertices: look.normals.length / 3, offset: featureEnd, sphere: look.sphere, codec: 'deflate' as const,
      ...(look.colours === undefined ? {} : { colours: true as const }) } }) } satisfies CompiledGridHeader), 'json', 'page');
  // Exercise the same valibot grammar the runtime admits, including signed zero.
  parseCompiledGridHeader(JSON.parse(new TextDecoder().decode(header.bytes)));
  const body = artifact(packed, 'bin', 'mesh');
  // Certify the bytes that will ship against this build's actual native output.
  const decoded = decodeCompiledGridLook(JSON.parse(new TextDecoder().decode(header.bytes)), body.bytes, source, keyHome);
  if (look !== undefined) {
    const copy = decoded.look; if (copy === undefined || !isDeepStrictEqual(copy.sphere, look.sphere)) throw new Error('Grid strip bake changed look bounds');
    for (const channel of ['normals', 'uvs', 'colours'] as const) {
      const a = look[channel], b = copy[channel];
      if (a === undefined && b === undefined) continue;
      if (a === undefined || b === undefined) throw new Error('Grid strip bake changed look channels');
      if (!Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength))) throw new Error('Grid strip bake changed look words');
    }
  }
  for (const [index, original] of strips.entries()) {
    const copy = decoded.strips[index]; if (copy === undefined || copy.id !== original.id) throw new Error('Grid strip bake changed its order');
    for (const field of ['positions', 'colours', 'indices'] as const) {
      const a = original.mesh[field], b = copy.mesh[field];
      if (!Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength))) throw new Error('Grid strip bake changed native words');
    }
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
  return { slug, owner: home, phase, page: { source, home: keyHome, header: header.address, body: body.address }, header, body };
}

/** What two rows for one page must agree on. */
const pageIdentity = (row: CompiledGridCandidate): string => JSON.stringify([row.owner, row.phase, row.slug, row.page.body.sha256, row.page.header.sha256]);

/** Choose only pages whose added directory/header/body wire fits their shard's room (budgets/grid-strip-room.json). */
export function writeGridStripPages(root: string, seams: string, candidates: readonly CompiledGridCandidate[], rooms: Readonly<Record<string, number>>): CompiledGridBuild {
  const unique = new Map<string, CompiledGridCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.page.source}/${candidate.page.home}`, previous = unique.get(key);
    if (previous !== undefined && pageIdentity(previous) !== pageIdentity(candidate)) throw new Error('Grid strip page is not deterministic');
    unique.set(key, candidate);
  }
  const all = [...unique.values()].sort((a, b) => `${a.page.source}/${a.page.home}`.localeCompare(`${b.page.source}/${b.page.home}`));
  const ownerKey = (candidate: CompiledGridCandidate): string => `${candidate.page.source}/${candidate.owner}`;
  const groups = new Map<string, CompiledGridCandidate[]>();
  for (const candidate of all) {
    const key = ownerKey(candidate), rows = groups.get(key) ?? [];
    rows.push(candidate); groups.set(key, rows);
  }
  for (const rows of groups.values()) if (new Set(rows.map(row => row.slug)).size !== 1) throw new Error('Grid strip owner differs');
  const roomOf = new Map(Object.entries(rooms));
  const measured = new Map<string, number>();
  const wireOf = (file: CompiledGridArtifact): number => {
    let wire = measured.get(file.address.sha256);
    if (wire === undefined) { wire = servedBytes(file.bytes); measured.set(file.address.sha256, wire); }
    return wire;
  };
  const ownWire = new Map(all.map(candidate => [candidate, wireOf(candidate.header) + wireOf(candidate.body)]));
  let selected = all.filter(candidate => { const room = roomOf.get(candidate.slug); return room !== undefined && (ownWire.get(candidate) ?? 0) <= room; });
  let directory = artifact(json({ version: 1, pages: selected.map(candidate => candidate.page) }), 'json', 'book');
  for (;;) {
    const wire = servedBytes(directory.bytes), blockedHomes = new Set(all.filter(candidate => {
      const room = roomOf.get(candidate.slug); return room === undefined || wire > room;
    }).map(candidate => candidate.owner));
    const costs = new Map<string, number>(), hasOuter = new Set<string>();
    for (const candidate of selected) {
      const key = ownerKey(candidate); costs.set(key, (costs.get(key) ?? 0) + (ownWire.get(candidate) ?? 0));
      if (candidate.phase === 'outer') hasOuter.add(key);
    }
    const next = selected.filter(candidate => {
      const room = roomOf.get(candidate.slug), key = ownerKey(candidate);
      if (blockedHomes.has(candidate.owner) || room === undefined) return false;
      if ((costs.get(key) ?? 0) + wire <= room) return true;
      // Keep initial readiness first. An outer bank cannot consume its headroom.
      return candidate.phase === 'initial' && hasOuter.has(key);
    });
    if (next.length === selected.length) break;
    selected = next; directory = artifact(json({ version: 1, pages: selected.map(candidate => candidate.page) }), 'json', 'book');
  }
  const homes = [...new Set(selected.map(candidate => candidate.page.home))].sort();
  const directoryWire = servedBytes(directory.bytes);
  // A directory may be fetched on another mode of an eligible home even if that mode has no body entry.
  for (const candidate of all) if (homes.includes(candidate.page.home)) {
    const room = roomOf.get(candidate.slug);
    if (room === undefined || directoryWire > room) throw new Error(`Grid strip directory exceeds ${candidate.slug}'s room`);
  }
  const chosen = new Set(selected), artifacts = selected.flatMap(candidate => [candidate.header, candidate.body]);
  if (selected.length > 0) artifacts.push(directory);
  const files = new Map<string, CompiledGridAddress>();
  const folder = join(root, 'out/.app/grid-strip-pages'); rmSync(folder, { recursive: true, force: true }); mkdirSync(folder, { recursive: true });
  for (const file of artifacts) {
    const previous = files.get(file.address.url);
    if (previous !== undefined && previous.sha256 !== file.address.sha256) throw new Error('Grid strip content URL collision');
    files.set(file.address.url, file.address);
    writeFileSync(join(folder, basename(file.address.url)), file.bytes);
  }
  const rows: GridStripWireRow[] = [...groups.values()].map(group => {
    const candidate = group[0]; if (candidate === undefined) throw new Error('Missing grid page owner');
    const included = group.some(part => part.phase === 'initial' && chosen.has(part)), outer = group.some(part => part.phase === 'outer' && chosen.has(part));
    const readsDirectory = homes.includes(gridStripPageKey(candidate.owner, 'initial')) || homes.includes(gridStripPageKey(candidate.owner, 'outer'));
    return { source: candidate.page.source, home: candidate.owner, slug: candidate.slug, included, outer,
      room: roomOf.get(candidate.slug) ?? null,
      added: (readsDirectory ? directoryWire : 0) + group.reduce((sum, part) => sum + (chosen.has(part) ? ownWire.get(part) ?? 0 : 0), 0) };
  });
  const result: CompiledGridBuild = { ...(selected.length === 0 ? {} : { geometry: { directory: directory.address, homes } }), files: [...files.values()], rows };
  writeFileSync(join(root, 'out/.app/grid-strip-index.json'), JSON.stringify({ seams, ...result }));
  return result;
}
