import type { Rolldown } from 'vite';
import { relative, resolve } from 'node:path';
import { startupModuleRoots, homeModuleRoots, gridModuleRoots } from './bootModules';

interface ModuleGraph {
  readonly getModuleInfo: (id: string) => { readonly importedIds: readonly string[] } | null;
}

/** Only static dependencies: an optional import never becomes an entry requirement. */
function staticClosure(graph: ModuleGraph, roots: readonly string[]): Set<string> {
  const found = new Set<string>(), pending = [...roots];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || found.has(id)) continue;
    found.add(id);
    pending.push(...graph.getModuleInfo(id)?.importedIds ?? []);
  }
  return found;
}

function membership(graph: ModuleGraph, rows: readonly (readonly string[])[]): Map<string, bigint> {
  const masks = new Map<string, bigint>();
  for (let index = 0; index < rows.length; index++) {
    const bit = 1n << BigInt(index);
    for (const id of staticClosure(graph, rows[index] ?? [])) masks.set(id, (masks.get(id) ?? 0n) | bit);
  }
  return masks;
}

/** Merge only equal requirements across actual title roots and home entries.
 * A home never fetches another home's optional feature. The session budget and
 * initial HTML boundaries remain separate. All graph state belongs to one build. */
export function controlChunkSelector(root: string, startup = startupModuleRoots(root), boundary: 'control' | 'title' | 'initial' | 'assets' = 'control', homes: readonly (readonly string[])[] = []): (id: string, graph: ModuleGraph) => string | null {
  let controls: Map<string, bigint> | undefined, title: Map<string, bigint> | undefined, initial: Map<string, bigint> | undefined, session: Set<string> | undefined;
  return (id, graph) => {
    if (controls === undefined) {
      controls = membership(graph, homes.length === 0 ? [startup] : homes);
      const titleRoots = ['src/client/app/entry.ts', 'src/client/engine/ui/StartTitle.ts', 'src/client/game/mainMenu.ts',
        'src/client/game/grid/pageEntry.ts', 'src/client/game/travel/travel.ts'].map(file => resolve(root, file));
      for (const file of titleRoots) if (graph.getModuleInfo(file) === null) throw new Error(`Missing title chunk boundary: ${file}`);
      title = membership(graph, titleRoots.map(file => [file]));
      initial = membership(graph, [[resolve(root, 'index.html')], [resolve(root, 'calibration/index.html')]]);
      session = staticClosure(graph, [resolve(root, 'src/client/game/session/session.ts')]);
    }
    const needed = controls.get(id) ?? 0n, titleMask = title?.get(id) ?? 0n;
    // An unconditional HTML dependency already runs in every entry in this
    // exact set. Later title/session labels cannot narrow its initial use;
    // keeping them here only makes another mandatory module transaction.
    if (boundary === 'initial') {
      const entryMask = initial?.get(id) ?? 0n;
      return entryMask === 0n || id.includes('/src/shards/') || /\.css(?:\?|$)/u.test(id) ? null : `entry-${entryMask.toString(36)}`;
    }
    if (needed === 0n && titleMask === 0n) return null;
    const roles = `${(initial?.get(id) ?? 0n).toString(36)}-${titleMask.toString(36)}-${needed.toString(36)}-${session?.has(id) === true ? 'session' : 'startup'}`;
    // Asset modules contain URL strings. Equal real requirements can share a
    // bank without fetching image bodies or admitting another home's code.
    if (boundary === 'assets') return /\.(?:avif|gif|jpe?g|png|svg|webp)$/u.test(id) ? `asset-urls-${roles}` : null;
    if (id.includes('/src/shards/')) return null;
    if (boundary === 'title') return titleMask > 0n ? `title-${roles}` : null;
    if (titleMask > 0n || !/\.(?:[cm]?[jt]sx?|json)$/u.test(id) || id.includes('/out/')) return null;
    return `control-${roles}`;
  };
}

/** Phase banks keep exact home requirements and initial/title execution
 * boundaries. Larger banks trade a wider update invalidation for fewer module
 * requests; shard and late banks remain entry-aware, so optional imports stay
 * optional. A content edit cannot fold another shard into a shared bank.
 * DL14 (11-03, G872): these banks stay byte-exact. The phone link is byte-bound: one shared core (e0fb9c3fef) cut
 * Driftwood grid's JS requests before control from 104 to 44 but added 0.58-0.93 MB on the wire per entry, and
 * request counts do not move control there. Any coarser bank must add no bytes to any entry. */
export function controlChunkGroups(root: string): Rolldown.CodeSplittingGroup[] {
  const startup = startupModuleRoots(root), grid = gridModuleRoots(root);
  const base = [...startup, ...['src/client/app/main.ts', 'src/client/game/shardfile/client.ts', 'src/client/game/session/session.ts'].map(file => resolve(root, file))];
  const homes = homeModuleRoots(root).flatMap(optional => [[...base, ...optional], [...base, ...optional, ...grid]]);
  const dataRoots = new Set([...startup, ...homes.flat()].filter(id => id.endsWith('.json')));
  return [
    { name: controlChunkSelector(root, startup, 'assets', homes), includeDependenciesRecursively: false },
    // Named JSON imports are boot-bank roots too. Give each an explicit owner
    // instead of depending on its residual locations in a coarse source map.
    { name: id => dataRoots.has(id) ? `startup-data-${relative(root, id)}` : null, includeDependenciesRecursively: false },
    // HTML proxies and compiler helpers are entry dependencies too. Their actual
    // entry sets keep calibration's initial Three graph off the public shell.
    { name: controlChunkSelector(root, startup, 'initial', homes), tags: ['$initial'], includeDependenciesRecursively: false, maxSize: 2_000_000 },
    { name: 'entry-optional', tags: ['$initial'], test: id => !id.includes('/src/shards/'), entriesAware: true, includeDependenciesRecursively: false, maxSize: 2_000_000 },
    { name: controlChunkSelector(root, startup, 'title', homes), includeDependenciesRecursively: false, maxSize: 2_000_000 },
    // This entry has its own 300 KB raw / 100 KB gzip per-chunk ceiling.
    // Its dependencies still join their exact shared requirement banks.
    { name: 'grid-session', test: id => id === resolve(root, 'src/client/game/grid/session.ts'), includeDependenciesRecursively: false },
    { name: controlChunkSelector(root, startup, 'control', homes), includeDependenciesRecursively: false, maxSize: 4_000_000 },
    { name: id => { const slug = /\/src\/shards\/([^/]+)\//u.exec(id)?.[1]; return slug === undefined ? null : `shard-${slug}`; },
      entriesAware: true, includeDependenciesRecursively: false, maxSize: 4_000_000 },
    { name: 'late', entriesAware: true, includeDependenciesRecursively: false, maxSize: 4_000_000 },
  ];
}

/** Entry-aware subgroup labels contain '~'; named module banks accept only
 * URL-safe tokens. Keep the content hash, not a permissive bank parser. */
export function controlChunkFileName(chunk: Pick<Rolldown.PreRenderedChunk, 'name'>, directory = 'assets'): string {
  return `${directory}/${chunk.name.replaceAll(/[^a-zA-Z0-9_.-]/gu, '-')}-[hash].js`;
}
