import { parseNavigation, readNavigation, type NavigationContent } from '@wildshard/format/navigation';
import { app } from '../app/runtime';
/**
 * The app's binding of the baked navmesh (SF72 split it from the renderer-free src/shared/engine/physics/navmesh.ts, which holds
 * the format, the parse and the queries): the active level's navmesh, and its fetch in the `physics` step. Every navmesh
 * this loads reports its query cost to the perf meter (frameCost.nav).
 */
import { buildNavmesh, parseNavmesh, type Navmesh } from '../../../shared/engine/physics/navmesh';
import { workSlice } from '../../../shared/engine/core/workSlice';
import { navmeshUrl } from '../../../shared/engine/physics/navmeshUrl';
import { frameCost } from '../../../shared/engine/core/frameCost';

/**
 * The session's admitted-navigation port: given the level's baked id (`levelBakedId`) and its declared navigation row's file
 * (the SHA-256 of the original WSNM bytes), it returns those bytes as its owner already admitted them (the game reads a
 * shard's admitted product), or null (now, or once it has looked) when it holds none, which keeps the declared URL's fetch.
 * A rejection falls back to that fetch with a warning. The engine names no source of bytes.
 */
export type NavigationReader = (declared: { readonly key: string; readonly file: string }) => Promise<Uint8Array | null> | null;
let navigationReader: NavigationReader | null = null;

/**
 * Install the session's admitted-navigation reader (E434: the game session calls this; importing the module installs
 * nothing). Returns the restore, which puts back the reader it replaced.
 */
export function installNavigationReader(next: NavigationReader): () => void {
  const previous = navigationReader;
  navigationReader = next;
  return () => { if (navigationReader === next) navigationReader = previous; };
}

/** Declared navigation's original bytes: the reader's admitted copy when it holds one, else the declared immutable URL. */
async function declaredBytes(key: string, file: string, url: string): Promise<Uint8Array> {
  const reading = navigationReader?.({ key, file }) ?? null;
  if (reading !== null) {
    try {
      const admitted = await reading;
      if (admitted !== null) return admitted;
    } catch (e) {
      console.warn(`[navmesh] admitted navigation for ${key} not used (${e instanceof Error ? e.message : String(e)}); fetching it`);
    }
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error('Required navigation bytes are unavailable');
  return new Uint8Array(await response.arrayBuffer());
}


/** Set (or clear) the active navmesh — node tests, or a shard switch. */
export function setActiveNavmesh(levelId: string, navmesh: Navmesh | null): void { app.navmesh = navmesh; app.navmeshId = navmesh ? levelId : null; }

/**
 * Fetch and parse the level `levelId`'s navmesh and make it the active one (the `physics` step; the file is a declared boot file, so
 * the loading bar counts it and the service worker caches it). Resolves null — a warning, never a failure — when the
 * build has none or it doesn't parse: the creatures then steer as they did before the navmesh.
 * `bakedId` selects an authored offline folder; cache ownership remains the independent `levelId`. Declared navigation
 * given by URL is first asked of the session's navigation reader (`installNavigationReader`), so bytes its owner already
 * admitted are not downloaded twice; either way they are checked against the row before any query mesh is built.
 */
export async function loadNavmesh(levelId: string, bakedId: string = levelId, content?: NavigationContent): Promise<Navmesh | null> {
  if (content !== undefined) {
    const row = parseNavigation(content.row);
    const bytes = 'bytes' in content ? content.bytes : await declaredBytes(bakedId, row.file, content.url);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)));
    const hash = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== row.file) throw new Error('Required navigation hash differs');
    // the checked layers are built as they are (one decode), a slice of tiles at a time
    const navmesh = await buildNavmesh(readNavigation(row, bytes), bytes.byteLength, workSlice());
    navmesh.costSink = ms => frameCost.nav(ms); setActiveNavmesh(levelId, navmesh); return navmesh;
  }
  if (app.navmeshId === levelId) return app.navmesh;
  const url = navmeshUrl(bakedId);
  if (url === null) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status}`);
    const navmesh = parseNavmesh(await res.arrayBuffer());
    if (navmesh === null) throw new Error('not a navmesh.bin of this version');
    navmesh.costSink = (ms) => frameCost.nav(ms);
    setActiveNavmesh(levelId, navmesh);
    return navmesh;
  } catch (e) {
    console.warn(`[navmesh] ${levelId}: not loaded (${(e as Error).message}); creatures steer without it`);
    return null;
  }
}
