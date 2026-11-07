import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/** Files build-app writes into the bundle folder after the bundler: never part of the emitted bundle. */
const LATER = new Set(['build-flags.json', '.vite/chunk-modules.json']);
export interface EmittedFile {
  readonly type: 'chunk' | 'asset'; readonly code?: string; readonly source?: Uint8Array; readonly imports?: readonly string[];
  readonly isEntry?: boolean; readonly facadeModuleId?: string | null; readonly modules?: Readonly<Record<string, unknown>>;
  readonly facadeModuleIds?: readonly string[];
  readonly originalFileNames?: readonly string[];
}
interface ManifestRow { readonly file: string; readonly src?: string; readonly isEntry?: boolean; readonly imports?: readonly string[] }

/** A chunk's modules, from its hidden source map's `sources` (a chunk without a map holds no source module). */
function mapModules(path: string): string[] {
  const map = `${path}.map`;
  if (!existsSync(map)) return [];
  const { sources = [], sourceRoot = '' } = JSON.parse(readFileSync(map, 'utf8')) as { sources?: string[]; sourceRoot?: string };
  return sources.map(source => resolve(dirname(map), sourceRoot, source));
}

/** The bundle as the bundler wrote it into `outDir`: every file it emitted (not a copy of `publicDir`, not one build-app
 *  writes later), each manifest chunk with its code, static imports, entry facade and modules (from its source map),
 *  each asset with the source files the manifest names for it. */
export function writtenBundle(outDir: string, root: string, publicDir = join(root, 'public')): Record<string, EmittedFile> {
  const manifest = JSON.parse(readFileSync(join(outDir, '.vite/manifest.json'), 'utf8')) as Record<string, ManifestRow>;
  const chunks = new Map<string, { key: string; row: ManifestRow; roots: Set<string> }>(), originals = new Map<string, string[]>();
  for (const [key, row] of Object.entries(manifest)) {
    if (row.file.endsWith('.js')) {
      let chunk = chunks.get(row.file);
      if (chunk === undefined) { chunk = { key, row, roots: new Set() }; chunks.set(row.file, chunk); }
      if (row.src !== undefined) chunk.roots.add(resolve(root, row.src));
    }
    else originals.set(row.file, [...originals.get(row.file) ?? [], key]);
  }
  const bundle: Record<string, EmittedFile> = {};
  for (const entry of readdirSync(outDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name), name = relative(outDir, path).replaceAll('\\', '/');
    if (LATER.has(name) || name.startsWith('shardfiles/') || existsSync(join(publicDir, name))) continue;
    const bytes = readFileSync(path), chunk = chunks.get(name);
    bundle[name] = chunk === undefined ? { type: 'asset', source: new Uint8Array(bytes), originalFileNames: originals.get(name) ?? [] } : {
      type: 'chunk', code: bytes.toString('utf8'), imports: (chunk.row.imports ?? []).map(key => manifest[key]?.file ?? key),
      isEntry: chunk.row.isEntry === true, facadeModuleId: chunk.row.isEntry === true ? join(root, chunk.key) : null,
      facadeModuleIds: [...chunk.roots],
      // an entry chunk's own module too: a facade that only re-exports emits no code, so its map names nothing
      modules: Object.fromEntries([...mapModules(path), ...chunk.roots, ...chunk.row.src === undefined ? [] : [resolve(root, chunk.row.src)]].map(id => [id, true])),
    };
  }
  return bundle;
}
