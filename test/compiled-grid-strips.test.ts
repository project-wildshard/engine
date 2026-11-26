// @vitest-environment node
/// <reference types="node" />
import { expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { CONTENT_CAPS } from '@wildshard/format/contentBounds';
import { generatePlatform, type GeneratedStrip, type PlatformCell, type StripProfile } from '../src/shared/engine/sim/strips';
import { ResidencyAllocator } from '../src/shared/game/grid/allocator';
import { decodeCompiledGridBlock, mergeGridBlocks, parseCompiledGridHeader, platformGeometrySource, readCompiledGridStrips, type CompiledGridAddress } from '../src/shared/game/grid/compiledStrips';
import { seamLookGeometrySteps } from '../src/client/game/grid/seamLook';
import { encodeGridStripBlock, gridStripBlockKey, gridStripOverRoom, gridStripSetBudget, writeGridStripBlocks, type CompiledGridBlockFile } from '../src/cook/game/gridStripPages';
import { gridSeamAsset, readGridSeams, writeGridSeams } from '../src/scripts/app-build/gridSeams.mjs';
// oxlint-disable-next-line import/no-nodejs-modules -- This artifact fixture owns and removes only its bounded tmp directory.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the fixture's own ignored scratch output.
import { basename, join, resolve } from 'node:path';

function native(count = 257): { cells: PlatformCell[]; empty: StripProfile; strips: readonly GeneratedStrip[] } {
  const empty: StripProfile = { roadHeight: 0, heights: Array.from({ length: 257 }, () => 0), colours: Array.from({ length: 257 }, () => [0.25, 0.25, 0.25]) };
  const profile: StripProfile = { roadHeight: 0,
    heights: Array.from({ length: count }, (_, i) => i === 0 || i === count - 1 || Math.abs(-250 + i * 500 / (count - 1)) < 12 ? 0 : i % 31 - 10),
    colours: Array.from({ length: count }, (_, i) => i === 0 || i === count - 1 ? [0.25, 0.25, 0.25] : [i % 2 === 0 ? -0 : 0.125, (i % 7) / 7, (i % 11) / 11]) };
  const observed = { entryWidth: 8, waterSurface: 0, geometry: 'ground' as const, sourceSurface: 'terrain', outflows: [{ from: -30, to: -15 }] };
  const cells: PlatformCell[] = [{ instance: 'probe', cell: [0, 0], origin: { x: 0, z: -0 },
    edges: { north: profile, east: profile, south: empty, west: empty }, observations: { north: observed, east: { ...observed, geometry: 'void' }, south: { entryWidth: 0 }, west: { entryWidth: 0 } } }];
  return { cells, empty, strips: generatePlatform(cells, empty) };
}
/** A 5x5 grid of plain cells, its whole road and the session's ring round a home. */
function grid(): { cells: PlatformCell[]; empty: StripProfile; strips: readonly GeneratedStrip[]; ring: (home: { x: number; z: number }) => (x: number, z: number) => boolean } {
  const empty = native().empty, cells: PlatformCell[] = [];
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) cells.push({ instance: `cell_${x}_${z}`, cell: [x, z],
    origin: { x: x * CONTENT_CAPS.pitch, z: z * CONTENT_CAPS.pitch }, edges: { north: empty, east: empty, south: empty, west: empty } });
  const reach = 1.5 * CONTENT_CAPS.pitch + 1;
  return { cells, empty, strips: generatePlatform(cells, empty), ring: home => (x, z) => Math.abs(x - home.x) <= reach && Math.abs(z - home.z) <= reach };
}
const wire = (array: Float32Array | Uint32Array): Uint8Array => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
function sameWords(actual: ArrayBufferView | undefined, expected: ArrayBufferView | undefined): void {
  if (actual === undefined || expected === undefined) throw new Error('Missing exact channel');
  expect(actual.constructor).toBe(expected.constructor);
  // Compare every byte, including signed zero, without enumerating numeric keys.
  expect(Buffer.compare(new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength),
    new Uint8Array(expected.buffer, expected.byteOffset, expected.byteLength))).toBe(0);
}
function sameStrips(actual: readonly GeneratedStrip[], expected: readonly GeneratedStrip[]): void {
  expect(actual.map(strip => strip.id)).toEqual(expected.map(strip => strip.id));
  for (const [index, source] of expected.entries()) {
    const copy = actual[index]; if (copy === undefined) throw new Error('Missing shipped strip');
    expect(copy.mesh.origin).toEqual(source.mesh.origin); expect(copy.features).toEqual(source.features); expect(copy.turnIn).toEqual(source.turnIn);
    for (const key of ['positions', 'colours', 'indices'] as const) {
      expect(Buffer.compare(wire(copy.mesh[key]), wire(source.mesh[key]))).toBe(0); expect(copy.mesh[key].buffer).not.toBe(source.mesh[key].buffer);
    }
    expect(copy.duplicates.map(row => ({ instance: row.instance, origin: row.mesh.origin }))).toEqual(source.duplicates.map(row => ({ instance: row.instance, origin: row.mesh.origin })));
  }
}
const ordered = (strips: readonly GeneratedStrip[]) => strips.map((strip, order) => ({ strip, order }));
const headerOf = (file: CompiledGridBlockFile): unknown => JSON.parse(new TextDecoder().decode(file.header.bytes));
const build = (...args: Parameters<typeof seamLookGeometrySteps>) => {
  const steps = seamLookGeometrySteps(...args);
  for (;;) { const next = steps.next(); if (next.done) return next.value; }
};

test('native certification keeps optional JSON fields and refuses dropped feature facts', () => {
  const original = native();
  const first = original.strips.find(strip => strip.features.length > 0), feature = first?.features[0];
  if (feature === undefined) throw new Error('Missing native feature');
  Object.defineProperty(feature, 'optionalNote', { value: undefined, enumerable: true, configurable: true });
  expect(() => encodeGridStripBlock('0,0', ordered(original.strips))).not.toThrow();
  Object.defineProperty(feature, 'optionalNote', { value: 'must survive', enumerable: true });
  expect(() => encodeGridStripBlock('0,0', ordered(original.strips))).toThrow('physical placement or features');
});

test('native certification retains JSON hooks in its physical fact comparison', () => {
  const original = native();
  const feature = original.strips.find(strip => strip.features.length > 0)?.features[0];
  if (feature === undefined) throw new Error('Missing native feature');
  Object.defineProperty(feature, 'toJSON', { value: () => ({ ...feature, top: feature.top + 1 }) });
  expect(() => encodeGridStripBlock('0,0', ordered(original.strips))).toThrow('physical placement or features');
});

test.each([256, 257])('a shipped block matches native construction word for word, with its orders (%s samples)', count => {
  const original = native(count), block = encodeGridStripBlock('0,0', ordered(original.strips)), header = headerOf(block);
  const actual = decodeCompiledGridBlock(header, block.body.bytes);
  sameStrips(actual.strips.map(row => row.strip), original.strips);
  expect(actual.strips.map(row => row.order)).toEqual(original.strips.map((_, order) => order));
  const first = actual.strips[0]?.strip, before = original.strips[0];
  if (first === undefined || before === undefined) throw new Error('Missing mutation probe');
  first.mesh.positions[0] = 999;
  expect(before.mesh.positions[0]).not.toBe(999);
  expect(() => decodeCompiledGridBlock(header, block.body.bytes.slice(1))).toThrow();
  const admitted = parseCompiledGridHeader(header), bad = block.body.bytes.slice(); new DataView(bad.buffer).setUint32(admitted.rows.bytes - 4, 0xffffffff, true);
  expect(() => decodeCompiledGridBlock(header, bad)).toThrow('geometry');
  const malformed = block.body.bytes.slice(); new DataView(malformed.buffer).setFloat64(Math.ceil(admitted.rows.bytes / 8) * 8 + 32, Number.NaN, true);
  expect(() => decodeCompiledGridBlock(header, malformed)).toThrow('feature');
  for (const bits of [0x7f800000, 0xff800000, 0x7fc00000, 0x7f800001]) {
    const nonfinite = block.body.bytes.slice(); new DataView(nonfinite.buffer).setUint32(0, bits, true);
    expect(() => decodeCompiledGridBlock(header, nonfinite)).toThrow('geometry');
  }
});

test.each([256, 257])('a block\'s frame-free look draws every home\'s exact words and bound (%s samples)', count => {
  const original = native(count), pitch = CONTENT_CAPS.pitch, block = encodeGridStripBlock('0,0', ordered(original.strips), pitch), header = headerOf(block);
  const decoded = mergeGridBlocks([decodeCompiledGridBlock(header, block.body.bytes)], () => true);
  if (decoded.look === undefined) throw new Error('Missing baked channels');
  sameStrips(decoded.strips, original.strips);
  // ZE4: one bake, any home: the uv and the sphere are the home frame's and come from the page
  for (const frame of [{ origin: { x: 17.25, z: -8.5 } }, { origin: { x: -2 * pitch, z: pitch } }]) for (const explicit of [false, true]) {
    const surfaces = explicit ? () => [0.2, 0.4, 0.6] as const : undefined;
    const before = build(original.strips, frame, surfaces, pitch);
    const after = build(decoded.strips, frame, surfaces, pitch, decoded.look);
    try {
      for (const name of ['position', 'normal', 'color', 'uv']) sameWords(after.geometry.getAttribute(name).array, before.geometry.getAttribute(name).array);
      sameWords(after.geometry.getIndex()?.array, before.geometry.getIndex()?.array);
      expect(after.geometry.groups).toEqual(before.geometry.groups);
      expect(after.geometry.boundingSphere).toEqual(before.geometry.boundingSphere);
      expect(after.state).toEqual(before.state);
    } finally { before.geometry.dispose(); after.geometry.dispose(); }
  }
  expect(() => build(decoded.strips, { origin: { x: 0, z: 0 } }, undefined, pitch / 2, decoded.look)).toThrow('differ from these strips');
  const metadata = parseCompiledGridHeader(header).look;
  if (metadata === undefined) throw new Error('Missing baked metadata');
  const bad = block.body.bytes.slice(); bad.set(new Uint8Array(8).fill(0xff), metadata.offset + 2);
  expect(() => decodeCompiledGridBlock(header, bad)).toThrow('look channels');
  expect(() => decodeCompiledGridBlock({ ...parseCompiledGridHeader(header), look: { ...metadata, vertices: metadata.vertices + 1 } }, block.body.bytes)).toThrow('look layout');
});

test('baked source identity ignores property order but distinguishes changed values and signed zero', async () => {
  const input = native(), source = await platformGeometrySource(input.cells, input.empty);
  const reordered = input.cells.map(cell => ({ ...cell, edges: { west: cell.edges.west, south: cell.edges.south, east: cell.edges.east, north: cell.edges.north } }));
  expect(await platformGeometrySource(reordered, input.empty)).toBe(source);
  expect(await platformGeometrySource(structuredClone(input.cells), structuredClone(input.empty))).toBe(source);
  const moved = input.cells.map(cell => ({ ...cell, origin: { x: cell.origin.x, z: 0 } }));
  expect(await platformGeometrySource(moved, input.empty)).not.toBe(source);
});

/** Bake a grid's blocks into a scratch root; read them back as the page does. */
async function baked(set = 64 * 1024 * 1024, report?: (message: string) => void) {
  const g = grid(), source = await platformGeometrySource(g.cells, g.empty), root = mkdtempSync(resolve('tmp/grid-strip-blocks-'));
  mkdirSync(join(root, 'out/.app'), { recursive: true });
  try {
    const result = writeGridStripBlocks(root, 'a'.repeat(64), [{ source, pitch: CONTENT_CAPS.pitch, strips: g.strips,
      homes: g.cells.map(cell => ({ instance: cell.instance, slug: 'fixture', origin: cell.origin })) }], 1.5 * CONTENT_CAPS.pitch + 1, set, report);
    const files = new Map<string, Uint8Array>();
    for (const file of result.files) files.set(file.url, readFileSync(join(root, 'out/.app/grid-strip-pages', basename(file.url))));
    return { g, source, result, files, root };
  } catch (error) { rmSync(root, { recursive: true, force: true }); throw error; }
}
const reader = (files: ReadonlyMap<string, Uint8Array>, urls: string[] = []) => (url: string): Promise<Response> => {
  urls.push(url); const bytes = files.get(url); if (bytes === undefined) throw new Error(`Unexpected request ${url}`);
  return Promise.resolve(new Response(Uint8Array.from(bytes).buffer));
};

test('ZE4: every home reads its ring and its outer road exactly from blocks the homes share', async () => {
  const b = await baked();
  try {
    const { g, result } = b, selector = result.geometry; if (selector === undefined) throw new Error('Missing block selector');
    expect(result.rows).toHaveLength(25); expect(result.rows.every(row => row.included && row.outer)).toBe(true);
    expect(selector.homes).toHaveLength(25);
    const book = JSON.parse(new TextDecoder().decode(b.files.get(selector.directory.url)));
    // shared: 25 homes read far fewer blocks than 25 private copies of their ring
    const initialReads = (book.homes as { initial: number[] }[]).reduce((sum, row) => sum + row.initial.length, 0);
    expect(book.blocks.length).toBeLessThan(initialReads / 4);
    for (const cell of [g.cells[0], g.cells[12], g.cells[7]]) {
      if (cell === undefined) throw new Error('Missing home');
      const scope = new Scope(`home ${cell.instance}`), allocator = new ResidencyAllocator(), ring = g.ring(cell.origin);
      const read = await readCompiledGridStrips(selector, g, cell.instance, { scope, allocator }, reader(b.files), () => Promise.resolve(), ring);
      if (read === null || read.look === undefined || read.readOuter === undefined) throw new Error('Missing home blocks');
      const expected = generatePlatform(g.cells, g.empty, new Map(), ring);
      sameStrips(read.strips, expected);
      const frame = { origin: cell.origin }, before = build(expected, frame, undefined, CONTENT_CAPS.pitch), after = build(read.strips, frame, undefined, CONTENT_CAPS.pitch, read.look);
      try { for (const name of ['normal', 'color', 'uv']) sameWords(after.geometry.getAttribute(name).array, before.geometry.getAttribute(name).array); }
      finally { before.geometry.dispose(); after.geometry.dispose(); }
      const child = scope.child('outer');
      sameStrips(await read.readOuter(child, () => Promise.resolve()), generatePlatform(g.cells, g.empty, new Map(), (x, z) => !ring(x, z)));
      scope.dispose(); expect(allocator.entries()).toEqual([]);
    }
    expect(gridStripBlockKey({ x: -0.5, z: CONTENT_CAPS.pitch }, CONTENT_CAPS.pitch)).toBe('-1,1');
  } finally { rmSync(b.root, { recursive: true, force: true }); }
  await expect(baked(1000)).rejects.toThrow('budgets/grid-strip-room.json');
});

test('only a completed exact read publishes arrays and a scoped source charge', async () => {
  const b = await baked();
  try {
    const { g, result } = b, selector = result.geometry, home = g.cells[12]; if (selector === undefined || home === undefined) throw new Error('Missing block selector');
    const scope = new Scope('compiled blocks'), allocator = new ResidencyAllocator(), urls: string[] = [], signals: AbortSignal[] = [];
    const read = reader(b.files, urls);
    const actual = await readCompiledGridStrips(selector, g, home.instance, { scope, allocator }, (url, signal) => { signals.push(signal); return read(url); }, () => Promise.resolve(), g.ring(home.origin));
    if (actual === null || actual.look === undefined) throw new Error('Missing compiled blocks');
    expect(urls[0]).toBe(selector.directory.url); expect(urls.length % 2).toBe(1);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(allocator.entries().map(row => row.id).sort()).toEqual([`product:grid:seams:${home.instance}:look-source`, `product:grid:seams:${home.instance}:source`]);
    scope.dispose(); expect(allocator.entries()).toEqual([]);
  } finally { rmSync(b.root, { recursive: true, force: true }); }
});

test('optional misses start no block reads; corrupt declared data refuses and releases claims', async () => {
  const b = await baked();
  try {
    const { g, result } = b, selector = result.geometry, home = g.cells[12]; if (selector === undefined || home === undefined) throw new Error('Missing block selector');
    const scope = new Scope('refused blocks'), allocator = new ResidencyAllocator(), urls: string[] = [], ring = g.ring(home.origin);
    const mesh = [...b.files.keys()].find(url => url.endsWith('.bin')); if (mesh === undefined) throw new Error('Missing block body');
    const corrupt = new Map(b.files), bytes = Uint8Array.from(b.files.get(mesh) ?? []); bytes[0] = (bytes[0] ?? 0) ^ 1; corrupt.set(mesh, bytes);
    await expect(readCompiledGridStrips(undefined, g, home.instance, { scope, allocator }, reader(corrupt, urls), () => Promise.resolve(), ring)).resolves.toBeNull();
    await expect(readCompiledGridStrips(selector, g, 'other', { scope, allocator }, reader(corrupt, urls), () => Promise.resolve(), ring)).resolves.toBeNull(); expect(urls).toEqual([]);
    const moved = { cells: g.cells.map((cell, index) => index === 0 ? { ...cell, origin: { x: 777, z: 0 } } : cell), empty: g.empty };
    await expect(readCompiledGridStrips(selector, moved, home.instance, { scope, allocator }, reader(corrupt, urls), () => Promise.resolve(), ring)).resolves.toBeNull();
    expect(urls).toEqual([selector.directory.url]);
    const all = { ...selector, homes: selector.homes };
    // a home whose ring reads the corrupt block refuses
    let refused = 0;
    for (const cell of g.cells) {
      try { await readCompiledGridStrips(all, g, cell.instance, { scope, allocator }, reader(corrupt), () => Promise.resolve(), g.ring(cell.origin)); }
      catch (error) { expect(String(error)).toContain('differs'); refused++; }
    }
    expect(refused).toBeGreaterThan(0);
    expect(allocator.entries().every(row => row.id.endsWith(':source') || row.id.endsWith(':look-source'))).toBe(true);
    scope.dispose(); expect(allocator.entries()).toEqual([]);
  } finally { rmSync(b.root, { recursive: true, force: true }); }
});

test('a retiring owner aborts before publication and leaves no source reservation', async () => {
  const b = await baked();
  try {
    const { g, result } = b, selector = result.geometry, home = g.cells[12]; if (selector === undefined || home === undefined) throw new Error('Missing block selector');
    const scope = new Scope('retiring blocks'), allocator = new ResidencyAllocator(), signals: AbortSignal[] = [], read = reader(b.files);
    await expect(readCompiledGridStrips(selector, g, home.instance, { scope, allocator }, (url, signal) => {
      signals.push(signal); if (url.endsWith('.bin')) scope.dispose(); return read(url);
    }, () => Promise.resolve(), g.ring(home.origin))).rejects.toThrow('scope disposed');
    expect(signals.every(signal => signal.aborted)).toBe(true); expect(allocator.entries()).toEqual([]);
  } finally { rmSync(b.root, { recursive: true, force: true }); }
});

test('retiring during native look inflation cancels publication and every source charge', async () => {
  const b = await baked();
  try {
    const { g, result } = b, selector = result.geometry, home = g.cells[12]; if (selector === undefined || home === undefined) throw new Error('Missing block selector');
    const scope = new Scope('retiring native look');
    const allocator = new class extends ResidencyAllocator {
      override reserve(claim: Parameters<ResidencyAllocator['reserve']>[0]): ReturnType<ResidencyAllocator['reserve']> {
        const lease = super.reserve(claim);
        if (claim.id.endsWith(':look-decode')) queueMicrotask(() => { scope.dispose(); });
        return lease;
      }
    }();
    await expect(readCompiledGridStrips(selector, g, home.instance, { scope, allocator }, reader(b.files), () => Promise.resolve(), g.ring(home.origin))).rejects.toThrow('scope disposed');
    expect(allocator.entries()).toEqual([]);
  } finally { rmSync(b.root, { recursive: true, force: true }); }
});

test('outer data is never initial demand; a one-shot continuation keeps its owner tree and verifies every byte', async () => {
  const b = await baked();
  try {
    const { g, result } = b, selector = result.geometry, home = g.cells[12]; if (selector === undefined || home === undefined) throw new Error('Missing block selector');
    const scope = new Scope('continued blocks'), child = scope.child('outer'), foreign = new Scope('other page'), allocator = new ResidencyAllocator(), urls: string[] = [];
    const ring = g.ring(home.origin), book = JSON.parse(new TextDecoder().decode(b.files.get(selector.directory.url)));
    const row = (book.homes as { home: string; initial: number[]; outer: number[] }[]).find(entry => entry.home === home.instance);
    if (row === undefined) throw new Error('Missing home row');
    const admitted = await readCompiledGridStrips(selector, g, home.instance, { scope, allocator }, reader(b.files, urls), () => Promise.resolve(), ring);
    const continued = admitted?.readOuter; if (continued === undefined) throw new Error('Missing deferred capability');
    const blockUrls = (indices: number[]) => indices.flatMap(index => { const block = (book.blocks as { header: CompiledGridAddress; body: CompiledGridAddress }[])[index]; return block === undefined ? [] : [block.header.url, block.body.url]; });
    expect(urls.slice(1).sort()).toEqual(blockUrls(row.initial).sort()); urls.length = 0;
    await expect(continued(foreign, () => Promise.resolve())).rejects.toThrow('another owner'); expect(urls).toEqual([]);
    sameStrips(await continued(child, () => Promise.resolve()), generatePlatform(g.cells, g.empty, new Map(), (x, z) => !ring(x, z)));
    expect(urls.sort()).toEqual(blockUrls(row.outer).sort()); urls.length = 0;
    await expect(continued(child, () => Promise.resolve())).rejects.toThrow('already consumed'); expect(urls).toEqual([]);
    expect(allocator.entries().some(entry => entry.id.startsWith(`product:grid:seams:${home.instance}:outer:`))).toBe(true);
    child.dispose(); expect(allocator.entries().some(entry => entry.id.includes(':outer:'))).toBe(false);
    // an explicit outer read keeps the complement too
    const explicitScope = scope.child('explicit outer');
    const explicit = await readCompiledGridStrips(selector, g, home.instance, { scope: explicitScope, allocator }, reader(b.files), () => Promise.resolve(), (x, z) => !ring(x, z), 'outer');
    if (explicit === null) throw new Error('Missing explicit outer read');
    sameStrips(explicit.strips, generatePlatform(g.cells, g.empty, new Map(), (x, z) => !ring(x, z)));
    explicitScope.dispose();
    // a corrupt outer body refuses the continuation and releases its source
    const again = await readCompiledGridStrips(selector, g, home.instance, { scope: foreign, allocator }, reader(b.files), () => Promise.resolve(), ring);
    const outerOnly = blockUrls(row.outer).find(url => url.endsWith('.bin') && !blockUrls(row.initial).includes(url));
    if (again?.readOuter === undefined || outerOnly === undefined) throw new Error('Missing outer-only block');
    const corrupt = Uint8Array.from(b.files.get(outerOnly) ?? []); corrupt[0] = (corrupt[0] ?? 0) ^ 1; b.files.set(outerOnly, corrupt);
    const foreignChild = foreign.child('outer');
    await expect(again.readOuter(foreignChild, () => Promise.resolve())).rejects.toThrow('differs');
    expect(allocator.entries().some(entry => entry.id.includes(':outer:'))).toBe(false);
    foreignChild.dispose(); scope.dispose(); foreign.dispose(); expect(allocator.entries()).toEqual([]);
  } finally { rmSync(b.root, { recursive: true, force: true }); }
});

test('an ancestor retiring before outer demand prevents all IO and source publication', async () => {
  const b = await baked();
  try {
    const { g, result } = b, selector = result.geometry, home = g.cells[12]; if (selector === undefined || home === undefined) throw new Error('Missing block selector');
    const scope = new Scope('retiring continuation'), child = scope.child('outer'), allocator = new ResidencyAllocator(), urls: string[] = [];
    const admitted = await readCompiledGridStrips(selector, g, home.instance, { scope, allocator }, reader(b.files, urls), () => Promise.resolve(), g.ring(home.origin));
    const continued = admitted?.readOuter; if (continued === undefined) throw new Error('Missing deferred capability'); urls.length = 0;
    scope.onDispose(() => undefined); const retiring = scope.disposeSteps(); retiring.next();
    expect(child.disposed).toBe(false); expect(child.disposing).toBe(true);
    await expect(continued(child, () => Promise.resolve())).rejects.toThrow('scope disposed'); expect(urls).toEqual([]);
    for (const _step of retiring) { /* Drain the original sliced owner teardown. */ }
    expect(allocator.entries()).toEqual([]);
  } finally { rmSync(b.root, { recursive: true, force: true }); }
});

test('the plain app step ships the exact block set, and the set ratchet refuses a bigger one', async () => {
  const b = await baked();
  try {
    const source = '{"plans":[],"edges":[]}', asset = gridSeamAsset(source);
    writeFileSync(join(b.root, 'out/.app/grid-seams.json'), source);
    const index = JSON.parse(readFileSync(join(b.root, 'out/.app/grid-strip-index.json'), 'utf8'));
    writeFileSync(join(b.root, 'out/.app/grid-strip-index.json'), JSON.stringify({ ...index, seams: asset.address.sha256 }));
    const built = readGridSeams(b.root); expect(built.address.geometry?.homes).toHaveLength(25); expect(built.source).toBe(source);
    writeGridSeams(join(b.root, 'dist'), b.root);
    for (const file of built.files ?? []) expect(readFileSync(join(b.root, 'dist', file.url.slice(1))).length).toBe(file.bytes);
    const total = b.result.rows[0]?.set ?? 0; expect(total).toBe(64 * 1024 * 1024);
  } finally { rmSync(b.root, { recursive: true, force: true }); }
});

// Preview red since 2026-11-17 00:43 UTC: preview bakes staging's grid (SA35), so each cell staging places adds its road to
// the block set. The fixed 3.7 MB set (sized for the pinned 25 homes) refused 30 homes at 3,988,526 wire bytes; the room is
// per home, so a placed cell brings its own room and the ratchet still catches a block encoding that grows.
test('the strip set budget is the committed room per distinct home, so staging\'s placed cells fit', () => {
  const room: unknown = JSON.parse(readFileSync('budgets/grid-strip-room.json', 'utf8'));
  const homes = (count: number, prefix: string) => [{ source: prefix, pitch: 1, strips: [], homes: Array.from({ length: count }, (_, index) => ({ instance: `${prefix}-${String(index)}`, slug: 's', origin: { x: 0, z: 0 } })) }];
  expect(gridStripSetBudget(room, homes(25, 'pinned'))).toBeGreaterThanOrEqual(3_700_000);
  expect(gridStripSetBudget(room, homes(30, 'staging'))).toBeGreaterThan(3_988_526);
  // a home every grid mode shares counts once
  expect(gridStripSetBudget(room, [...homes(25, 'pinned'), ...homes(25, 'pinned')])).toBe(gridStripSetBudget(room, homes(25, 'pinned')));
  expect(() => gridStripSetBudget({ set: 3_700_000 }, homes(1, 'a'))).toThrow('budgets/grid-strip-room.json');
});


test('a grid that never ships reports an over-room strip set; a shipping build fails it (FM11)', () => {
  // A Ring build stands Brasscap road in for every shard outside the ring (pins.ts ringCatalogue): the failmodes fixture's
  // grid is 4.02 MB against the shipping 3.55 MB room, and failed its build on every main push from 2026-11-19.
  expect(gridStripOverRoom({ WILDSHARD_CATALOGUE: 'out/.ring-catalogue.json', WS_RELEASE: '0' })).toBe('report');
  expect(gridStripOverRoom({ WILDSHARD_CATALOGUE: '/work/engine/out/.ring-catalogue.json' })).toBe('report');
  expect(gridStripOverRoom({ WS_DEV_STAGING: '1' })).toBe('report');
  // the shipping grid, a named deploy catalogue and any release keep the hard room
  expect(gridStripOverRoom({})).toBe('fail');
  expect(gridStripOverRoom({ WILDSHARD_CATALOGUE: 'tmp/deploy/catalogue.json' })).toBe('fail');
  expect(gridStripOverRoom({ WILDSHARD_CATALOGUE: 'out/.ring-catalogue.json', WS_RELEASE: '1' })).toBe('fail');
  expect(gridStripOverRoom({ WS_DEV_STAGING: '1', WS_RELEASE: '1' })).toBe('fail');
});

test('only an explicit local report handler keeps the exact over-budget strip blocks', async () => {
  await expect(baked(1)).rejects.toThrow('over the 1 in budgets/grid-strip-room.json');
  const messages: string[] = [], b = await baked(1, message => { messages.push(message); });
  try {
    expect(messages).toEqual([expect.stringContaining('over the 1 in budgets/grid-strip-room.json')]);
    expect(b.result.geometry?.homes).toHaveLength(25);
  } finally { rmSync(b.root, { recursive: true, force: true }); }
});
