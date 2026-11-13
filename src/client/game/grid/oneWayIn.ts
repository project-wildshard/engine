// GO7 (meta MMO-PLAN MP1G, DG4; MMO-ZONE-SELECT ZS4's goto and ZS5's retirement): one way in. On a build with a world (GO4's gate),
// Shard select → a grid shard enters the grid at that shard's cell, so Shard select only changes the spawn cell of the one online
// world, and no online page boots a bordered `'shard'` page for a grid shard. J300 (GRID-CROSSING GC20): that holds when the world's
// word is missing, late or never kept; only a world known to host one cell (production before GC16) keeps GO4's one-shard page. A
// shard the grid doesn't place (OFFLINE OF3's) and a build with no world (preview, sharddev) keep today's one-shard page.
import { pageScope } from '@wildshard/engine/app/resources';
import { jsonSlot } from '@wildshard/engine/saves/slots';
import { GridAssembly, type GridCell } from '../../../shared/game/grid/assembly';
import { hostsGrid } from '../shardfile/serverRoute';
import { pageGridIntents } from './intent';
import { DEVSERVER, gridMode } from './menu';

/** The grid cell a shard's page enters: the first in catalogue order that runs this shard, or undefined for a shard the grid doesn't place. */
export function shardCell(slug: string, assembly: GridAssembly = new GridAssembly(gridMode(DEVSERVER))): GridCell | undefined {
  return assembly.cells.find(cell => [slug].includes(cell.slug));
}

/** What a `?chunk=` page decides before anything loads. */
export interface OneWayIn {
  /** the build is stamped with a world (play, staging) */
  readonly online: boolean;
  /** the world may host the grid: false only once its door's word (heard now or kept) says it opens one cell (`worldHosted`) */
  readonly hosted: boolean;
  /** the shard the URL names */
  readonly slug: string;
  /** a Developer's EXPLORE WORLD, an author's embedded product, or a page already entering the grid: never redirected */
  readonly kept: boolean;
}

/** The cell a one-shard page enters instead, or null when it stays a one-shard page. */
export function oneWayIn(page: OneWayIn, assembly?: GridAssembly): GridCell | null {
  if (!page.online || !page.hosted || page.kept) return null;
  return shardCell(page.slug, assembly) ?? null;
}

/** The online module's gate, as `clientWorker.ts` reads it; a page with no world never asks. */
interface OnlineGate { readonly worldWord: (world: { readonly release: string; readonly key: string }, waitMs?: number) => Promise<unknown> }

/** QA 11-12 row 36 (Jake on bad LTE: Driftwood sat 34 s on "Read audio 7 / 91"): the last answer this device got from its world, grid
 *  or one-shard, kept across sessions. A check that misses its deadline uses it, so a cached player stays on the route they downloaded
 *  instead of the one-shard route online play never fetches. */
export interface RouteMemory {
  /** the kept answer for this world's release (true: it hosts the grid), or null when this device never heard one */
  readonly read: (release: string) => boolean | null;
  readonly write: (release: string, grid: boolean) => void;
}
/** The device's slot (`localStorage`), keyed by the world's release; the build that heard the answer rides along for diagnostics. */
export function deviceRouteMemory(): RouteMemory {
  const slot = (): ReturnType<typeof jsonSlot> => jsonSlot('gridRoute', 'device');
  return {
    read: release => {
      try {
        const kept = slot().read();
        return typeof kept === 'object' && kept !== null && !Array.isArray(kept) && kept['of'] === release && typeof kept['grid'] === 'boolean' ? kept['grid'] : null;
      } catch { return null; }
    },
    write: (release, grid) => {
      const build = (globalThis as { __WS_BUILD_ID__?: string }).__WS_BUILD_ID__ ?? '';
      try { slot().write({ of: release, grid, build, at: Date.now() }); } catch { /* a device that keeps nothing falls back to today's page */ }
    },
  };
}

/** One deadline over the whole read, the online module's import included (GO4's 3 s). */
const HOSTED_MS = 3000;
/** How long the read may go on after the deadline, so a late answer is still kept for the next launch. */
const KEEP_LATE_MS = 10_000;
/** Whether this build's world hosts the grid, within `HOSTED_MS`. An answer in time decides and is kept (`memory`). No answer (a
 *  failure, a late answer) takes the device's kept answer; a device with none takes the grid (J300, GC20): a world build never drops
 *  a grid shard to a one-shard page for want of a word, so only a world known to open one cell does. A build with no world answers
 *  false. Whether the page then reaches the world is the online shell's business: it never waits here. */
export async function worldHosted(world: unknown, waitMs: number = HOSTED_MS, memory: RouteMemory = deviceRouteMemory(),
  read: (world: unknown, waitMs: number) => Promise<boolean | null> = readHosted): Promise<boolean> {
  const release = typeof world === 'object' && world !== null && 'release' in world && typeof world.release === 'string' ? world.release : null;
  if (release === null) return false;
  const scope = pageScope.child('grid.hosted'), late = new Promise<null>(resolve => { scope.timeout(waitMs, () => { resolve(null); }); });
  // The read itself may run past the page's deadline (`KEEP_LATE_MS`): a link that always answers late still fills the memory
  // for the next launch, though this page has already gone on without it.
  const reading = read(world, Math.max(waitMs, KEEP_LATE_MS)).catch(() => null);
  void reading.then(word => { if (word !== null) memory.write(release, word); return undefined; });
  let heard: boolean | null;
  try { heard = await Promise.race([reading, late]); } finally { scope.dispose(); }
  if (heard !== null) return heard;
  return memory.read(release) ?? true;
}
/** The door's word read as grid or not, or null when no word came (unreachable, stalled, closed before its word). */
async function readHosted(world: unknown, waitMs: number): Promise<boolean | null> {
  if (typeof world !== 'object' || world === null || !('release' in world) || !('key' in world)) return null;
  const { release, key } = world;
  if (typeof release !== 'string' || typeof key !== 'string') return null;
  try {
    const build = (globalThis as { __WS_BUILD_ID__?: string }).__WS_BUILD_ID__ ?? '';
    const gate = await import(/* @vite-ignore */ `/b/${build}/standalone/online.js`) as OnlineGate;
    const word = await gate.worldWord({ release, key }, waitMs);
    return word === null ? null : hostsGrid(word);
  } catch { return null; }
}

/**
 * ZS5 on a `?chunk=` page: when the world hosts the grid and the grid places this shard, the page enters the grid at its cell. The
 * goto intent turns this same page into a grid page (`bootPageMode` consumes it), so Shard select loads once. Returns the cell's
 * instance, or null when the page stays a one-shard page.
 */
export async function enterByShard(page: Omit<OneWayIn, 'hosted'>, world: unknown, hosted: (world: unknown) => Promise<boolean> = worldHosted): Promise<string | null> {
  // Only a page that could turn asks the world: a solo build, a kept page and a shard off the grid never wait on a read.
  if (oneWayIn({ ...page, hosted: true }) === null) return null;
  const cell = oneWayIn({ ...page, hosted: await hosted(world) });
  if (cell === null) return null;
  pageGridIntents().admit({ instance: cell.instance, slug: cell.slug, goto: true });
  return cell.instance;
}
