#!/usr/bin/env node
// The build and the page use the same catalogue, edge reader and certifier.
// The retained native lattice rows ship, and each slug's declared edge source (what the page's reader returns for it), so
// a grid entry reads no product for its edges; placement, meshes and colliders stay generated normally.
// Output: {"plans": [[key, rows]...], "edges": [[slug, source]...]}.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import { GridAssembly } from '../src/shared/game/grid/assembly.ts';
import { installCatalogue } from '../src/shared/game/grid/catalogueSlot.ts';
import { loadGridEdgeProfiles } from '../src/shared/game/grid/edgeProfiles.ts';
import { readGridEdges } from '../src/client/game/grid/edgeSources.ts';
import { readGridProductEdges } from '../src/client/game/grid/products.ts';
import { findShard } from '../src/client/game/shard/registry.ts';
import { platformInputs } from '../src/shared/game/grid/platformInputs.ts';
import { generatePlatform } from '../src/shared/engine/sim/strips.ts';
import { platformGeometrySource } from '../src/shared/game/grid/compiledStrips.ts';
import { writeGridCollision } from '../src/cook/game/gridCollision.ts';
import { encodeGridStripPage, GridStripTransportLimitError, writeGridStripPages } from '../src/cook/game/gridStripPages.ts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const root = process.cwd(), outputRoot = resolve(process.argv[2] ?? root), base = 'https://build.invalid/';
// Native worker proofs consume only the plain-grid collider files. The normal
// build still prepares every mode and all client strip pages below.
const collisionOnly = process.argv[3] === '--collision-only';
// A deploy that names its catalogue (`bakeCatalogue`) gets seams for that grid, or the page's catalogue and its seams differ.
if (process.env.WILDSHARD_CATALOGUE !== undefined) installCatalogue(JSON.parse(await readFile(process.env.WILDSHARD_CATALOGUE, 'utf8')));
/** @param {string} path */
const fetchFile = async path => {
  const url = new URL(path, base), product = url.pathname.startsWith('/shardfiles/');
  const relative = decodeURIComponent(url.pathname.slice(product ? '/shardfiles/'.length : 1));
  const folder = resolve(root, product ? 'out' : 'public'), file = resolve(folder, relative);
  if (!file.startsWith(`${folder}/`)) throw new Error('Grid bake path escapes its root');
  try { return new Response(new Uint8Array(await readFile(file))); }
  catch (error) { if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return new Response(null, { status: 404 }); throw error; }
};
const plans = new Map(), seen = new Map(), products = new Map(), sources = new Map(), entryModes = new Map();
/** @type {import('../src/cook/game/gridStripPages.ts').CompiledGridCandidate[]} */
const compiled = [];
const modes = collisionOnly ? [false] : [false, true];
for (const developer of modes) for (const devserver of modes) for (const nineDragon of modes) {
  const assembly = new GridAssembly({ developer, devserver, nineDragon });
  const key = JSON.stringify(assembly.cells);
  const mode = `${Number(developer)}${Number(devserver)}${Number(nineDragon)}`;
  const previous = seen.get(key);
  if (previous !== undefined) { entryModes.set(mode, previous); continue; }
  const empty = assembly.emptyNeighbour.edge;
  const edges = await loadGridEdgeProfiles(assembly.cells, async cell => {
    try {
      const source = await readGridEdges(cell, { fetch: fetchFile, edges: slug => {
        const manifest = findShard(slug), descriptor = manifest?.shardfile ?? manifest?.gridShardfile;
        if (descriptor === undefined) return null;
        let pending = products.get(slug);
        if (pending === undefined) {
          const url = new URL(descriptor, base).href;
          pending = readGridProductEdges(url, slug, { base, firstParty: true, offline: false, fetch: fetchFile,
            hash: bytes => Promise.resolve(createHash('sha256').update(bytes).digest('hex')) });
          products.set(slug, pending);
        }
        return pending;
      } });
      // only a JSON-exact declared source ships (a failed read keeps the page's own read)
      const wire = JSON.stringify(source);
      if (source.kind === 'declared' && isDeepStrictEqual(JSON.parse(wire), source)) sources.set(cell.slug, source);
      return source;
    } catch (error) {
      // Partial --shard builds retain the page's existing exact-input runtime fallback.
      console.error(`[grid bake] ${cell.instance}: ${String(error)}`);
      const closed = { entryWidth: 0 };
      return { kind: 'declared', profiles: { north: empty, east: empty, south: empty, west: empty },
        observations: { north: closed, east: closed, south: closed, west: closed } };
    }
  });
  const input = platformInputs(assembly, edges);
  let cells = input.cells, strips;
  try { strips = generatePlatform(cells, input.empty, plans); }
  catch (error) { console.error(`[grid bake] road-level fallback: ${String(error)}`); cells = input.flat; strips = generatePlatform(cells, input.empty, plans); }
  const source = await platformGeometrySource(cells, input.empty), reach = 1.5 * assembly.pitch + 1;
  seen.set(key, source); entryModes.set(mode, source);
  // C2: the worker's road is the page's, from the catalogue a plain visit reads.
  if (mode === '000') writeGridCollision(outputRoot, source, strips);
  if (collisionOnly) continue;
  for (const home of assembly.cells) {
    /** @param {import('../src/shared/engine/sim/strips.ts').GeneratedStrip} strip */
    const within = strip => Math.abs(strip.mesh.origin.x - home.origin.x) <= reach && Math.abs(strip.mesh.origin.z - home.origin.z) <= reach;
    const initial = strips.filter(within);
    compiled.push(encodeGridStripPage(source, home.instance, home.slug, initial, 'initial', { origin: home.origin, pitch: assembly.pitch }));
    if (!existsSync(resolve(root, 'out', home.slug, 'shard.json'))) continue;
    try { compiled.push(encodeGridStripPage(source, home.instance, home.slug, strips.filter(strip => !within(strip)), 'outer')); }
    catch (error) {
      if (!(error instanceof GridStripTransportLimitError)) throw error;
      console.error(`[grid bake] ${home.instance} outer retains native construction: ${String(error)}`);
    }
  }
}
// Edge reads complete concurrently. Their completion order must not change the
// content URL (and every importing chunk) when all certified values are equal.
/** @template T @param {ReadonlyMap<string,T>} rows */
const ordered = rows => [...rows].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
const output = JSON.stringify({ plans: ordered(plans), edges: ordered(sources) });
if (!collisionOnly) {
  const { room } = JSON.parse(readFileSync(resolve(root, 'budgets/grid-strip-room.json'), 'utf8'));
  const pages = writeGridStripPages(outputRoot, createHash('sha256').update(output).digest('hex'), compiled, room);
  // Addressing only: all original strip bytes, hashes and room selection stay in
  // writeGridStripPages. The title can request its exact existing initial page.
  writeFileSync(resolve(outputRoot, 'out/.app/grid-strip-entry-modes.json'), JSON.stringify(Object.fromEntries(entryModes)));
  for (const row of pages.rows) console.error(`[grid strip wire] ${row.home} source=${row.source.slice(0, 8)} added=${row.added} room=${String(row.room)} ${row.included ? 'compiled' : 'native'}${row.outer ? '+outer' : ''}`);
}
process.stdout.write(output);
