// GO7 (meta MMO-PLAN MP1G, DG4; MMO-ZONE-SELECT ZS4's goto and ZS5's retirement): one way in. On a build with a world (GO4's gate),
// Shard select → a grid shard enters the grid at that shard's cell, so Shard select only changes the spawn cell of the one online
// world, and no online page boots a bordered `'shard'` page for a grid shard. J300 (GRID-CROSSING GC20): that holds when the world's
// word is missing, late or never kept; only a world known to host one cell (production before GC16) keeps GO4's one-shard page. On a
// world build, a shard the world doesn't open (the grid doesn't place it, or its kept word leaves it out) is never entered (OFFLINE OF3). J311: a build with no world (preview) does the same with
// its in-page server, which hosts the whole grid: a Shard select tap enters the solo grid at the shard's cell (`entry.ts` asks only
// for a tap, so a bare `?chunk=` link, a harness or an author's embedded product still opens the shard alone).
import { pageScope } from '@wildshard/engine/app/resources';
import { jsonSlot, type Json } from '@wildshard/engine/saves/slots';
import { GridAssembly, type GridCell } from '../../../shared/game/grid/assembly';
import { hostsGrid } from '../shardfile/serverRoute';
import { pageGridIntents } from './intent';
import { DEVSERVER, gridMode } from './menu';
import { GAME_STRINGS } from '../../../shared/game/strings';

/** The grid cell a shard's page enters: the first in catalogue order that runs this shard, or undefined for a shard the grid doesn't place. */
export function shardCell(slug: string, assembly: GridAssembly = new GridAssembly(gridMode(DEVSERVER))): GridCell | undefined {
  return assembly.cells.find(cell => [slug].includes(cell.slug));
}

/** What a `?chunk=` page decides before anything loads. */
export interface OneWayIn {
  /** the build is stamped with a world (play, staging); false: the in-page server hosts the grid (J311) */
  readonly online: boolean;
  /** the world may host the grid: false only once its door's word (heard now or kept) says it opens one cell (`worldHosted`). Read only online */
  readonly hosted: boolean;
  /** the shard the URL names */
  readonly slug: string;
  /** a Developer's EXPLORE WORLD, an author's embedded product, or a page already entering the grid: never redirected */
  readonly kept: boolean;
}

/** OFFLINE OF3: the shards a world's word names (`shards`, opus-route2), or null when it names none (an older door, nonsense). */
export function wordShards(word: unknown): readonly string[] | null {
  const shards = typeof word === 'object' && word !== null && 'shards' in word ? word.shards : null;
  return Array.isArray(shards) && shards.every(shard => typeof shard === 'string') ? shards : null;
}

/** OFFLINE OF3 (J298): whether a world build may enter `slug`. The catalogue must place it (the world opens only grid cells, so a shard
 *  with no cell would be seated in another one), and a word that names shards (`shards`, heard now or kept) must name it. No word
 *  and nothing kept leaves the catalogue's answer (J300). This replaces ba88ac9a's "unplaced plays solo". */
export function inThisWorld(slug: string, shards: readonly string[] | null, assembly?: GridAssembly): boolean {
  return shardCell(slug, assembly) !== undefined && (shards === null || shards.includes(slug));
}

/** OF3: the title's line after a `?chunk=` link to a shard this world doesn't open (here, so the entry's static graph stays small). */
export function notInWorldLine(name: string): string { return GAME_STRINGS.notInWorld.line(name); }

/** The cell a one-shard page enters instead, or null when it stays a one-shard page. */
export function oneWayIn(page: OneWayIn, assembly?: GridAssembly): GridCell | null {
  if ((page.online && !page.hosted) || page.kept) return null;
  return shardCell(page.slug, assembly) ?? null;
}

/** The online module's gate, as `clientWorker.ts` reads it; a page with no world never asks. */
export interface OnlineGate { readonly worldWord: (world: { readonly release: string; readonly key: string }, waitMs?: number, keep?: WordKeep) => Promise<unknown> }
/** opus-wordkeep: the word the door said, which release and when (`online.js`'s `KeptWord`). */
interface KeptWord { readonly of: string; readonly at: number; readonly word: unknown }
interface WordKeep { readonly read: () => KeptWord | null; readonly write: (kept: KeptWord) => void }
/** opus-wordkeep: the tab's kept word, in the page's own session saves. `online.js` keeps the word a minute (so the title, a `?chunk=`
 *  page and the grid page share one socket), but its own store has no storage (OF4's finding for `release.kept`), so the page lends
 *  this one. The release is under `of`, not `release`: an older build in the same tab kept only a yes there. */
export function tabWordKeep(): WordKeep {
  const slot = (): ReturnType<typeof jsonSlot> => jsonSlot('gridGate', 'session');
  return {
    read: () => {
      const kept = slot().read();
      if (typeof kept !== 'object' || kept === null || Array.isArray(kept)) return null;
      const { of, at, word } = kept;
      return typeof of === 'string' && typeof at === 'number' && word !== undefined ? { of, at, word } : null;
    },
    // a word is parsed JSON, so it keeps as it came
    write: kept => { slot().write({ of: kept.of, at: kept.at, word: kept.word as Json }); },
  };
}

/** QA 11-12 row 36 (Jake on bad LTE: Driftwood sat 34 s on "Read audio 7 / 91"): the last answer this device got from its world, grid
 *  or one-shard, kept across sessions. A check that misses its deadline uses it, so a cached player stays on the route they downloaded
 *  instead of the one-shard route online play never fetches. */
export interface RouteMemory {
  /** the kept answer for this world's release (true: it hosts the grid), or null when this device never heard one */
  readonly read: (release: string) => boolean | null;
  /** OF3: the shards the kept word named, or null when it named none or nothing is kept */
  readonly shards: (release: string) => readonly string[] | null;
  readonly write: (release: string, grid: boolean, shards?: readonly string[] | null) => void;
}
/** The device's slot (`localStorage`), keyed by the world's release; the build that heard the answer rides along for diagnostics. */
export function deviceRouteMemory(): RouteMemory {
  const slot = (): ReturnType<typeof jsonSlot> => jsonSlot('gridRoute', 'device');
  const kept = (release: string): Readonly<Record<string, unknown>> | null => {
    try {
      const row = slot().read();
      return typeof row === 'object' && row !== null && !Array.isArray(row) && row['of'] === release ? row : null;
    } catch { return null; }
  };
  return {
    read: release => { const grid = kept(release)?.['grid']; return typeof grid === 'boolean' ? grid : null; },
    shards: release => wordShards(kept(release)),
    write: (release, grid, shards = null) => {
      const build = (globalThis as { __WS_BUILD_ID__?: string }).__WS_BUILD_ID__ ?? '';
      try { slot().write({ of: release, grid, ...(shards === null ? {} : { shards: [...shards] }), build, at: Date.now() }); } catch { /* a device that keeps nothing falls back to today's page */ }
    },
  };
}

const releaseOf = (world: unknown): string | null =>
  typeof world === 'object' && world !== null && 'release' in world && typeof world.release === 'string' ? world.release : null;
/** OF3: which shards a build may enter, by the world's kept word (`memory`) and the catalogue. A build with no world (preview,
 *  sharddev) opens every card: its in-page server hosts any shard. A word that arrives after the page's deadline is kept for the next
 *  launch only: until then the page enters as J300 says (no word takes the grid). */
export function worldOpens(world: unknown, memory: RouteMemory = deviceRouteMemory()): (slug: string) => boolean {
  if (world === undefined) return () => true;
  const release = releaseOf(world), shards = release === null ? null : memory.shards(release);
  let assembly: GridAssembly | undefined; // one catalogue read for a whole deck of cards
  return slug => { assembly ??= new GridAssembly(gridMode(DEVSERVER)); return inThisWorld(slug, shards, assembly); };
}
/** OF3: a page leaving for the title because its shard isn't in this world drops any grid entry it held (a tap's, or the one way in's). */
export function dropGridEntry(slug: string): void { pageGridIntents().consume(slug); }

/** What a world's word says, as this page reads it: whether it hosts the grid, and the shards it opens (OF3). */
export interface WorldHeard { readonly grid: boolean; readonly shards: readonly string[] | null }

/** One deadline over the whole read, the online module's import included (GO4's 3 s). */
const HOSTED_MS = 3000;
/** How long the read may go on after the deadline, so a late answer is still kept for the next launch. */
const KEEP_LATE_MS = 10_000;
/** Whether this build's world hosts the grid, within `HOSTED_MS`. An answer in time decides and is kept (`memory`). No answer (a
 *  failure, a late answer) takes the device's kept answer; a device with none takes the grid (J300, GC20): a world build never drops
 *  a grid shard to a one-shard page for want of a word, so only a world known to open one cell does. A build with no world answers
 *  false. Whether the page then reaches the world is the online shell's business: it never waits here. */
export async function worldHosted(world: unknown, waitMs: number = HOSTED_MS, memory: RouteMemory = deviceRouteMemory(),
  read: (world: unknown, waitMs: number) => Promise<WorldHeard | boolean | null> = readHosted): Promise<boolean> {
  const release = releaseOf(world);
  if (release === null) return false;
  const scope = pageScope.child('grid.hosted'), late = new Promise<null>(resolve => { scope.timeout(waitMs, () => { resolve(null); }); });
  // The read itself may run past the page's deadline (`KEEP_LATE_MS`): a link that always answers late still fills the memory
  // for the next launch, though this page has already gone on without it.
  // A bare yes or no (a test's reader) names no shards.
  const reading = read(world, Math.max(waitMs, KEEP_LATE_MS))
    .then((word): WorldHeard | null => word === null ? null : typeof word === 'boolean' ? { grid: word, shards: null } : word, () => null);
  void reading.then(word => { if (word !== null) memory.write(release, word.grid, word.shards); return undefined; });
  let heard: WorldHeard | null;
  try { heard = await Promise.race([reading, late]); } finally { scope.dispose(); }
  if (heard !== null) return heard.grid;
  return memory.read(release) ?? true;
}
/** This build's `online.js`, a bundle of its own. */
async function onlineGate(): Promise<OnlineGate> {
  const build = (globalThis as { __WS_BUILD_ID__?: string }).__WS_BUILD_ID__ ?? '';
  return await import(/* @vite-ignore */ `/b/${build}/standalone/online.js`) as OnlineGate;
}
/** The door's word read as grid or not and the shards it opens, or null when no word came (unreachable, stalled, closed before its word). */
export async function readHosted(world: unknown, waitMs: number, gate: () => Promise<OnlineGate> = onlineGate): Promise<WorldHeard | null> {
  if (typeof world !== 'object' || world === null || !('release' in world) || !('key' in world)) return null;
  const { release, key } = world;
  if (typeof release !== 'string' || typeof key !== 'string') return null;
  try {
    const word = await (await gate()).worldWord({ release, key }, waitMs, tabWordKeep());
    return word === null ? null : { grid: hostsGrid(word), shards: wordShards(word) };
  } catch { return null; }
}

/**
 * ZS5 on a `?chunk=` page: when the world hosts the grid and the grid places this shard, the page enters the grid at its cell. The
 * goto intent turns this same page into a grid page (`bootPageMode` consumes it), so Shard select loads once. Returns the cell's
 * instance, or null when the page stays a one-shard page.
 */
export async function enterByShard(page: Omit<OneWayIn, 'hosted'>, world: unknown, hosted: (world: unknown) => Promise<boolean> = worldHosted,
  opens: (slug: string) => boolean = slug => worldOpens(world)(slug)): Promise<string | null> {
  // Only a page that could turn asks the world: a kept page and a shard off the grid never wait on a read, and a solo build has no
  // world to ask (its in-page server hosts the grid, J311).
  if (oneWayIn({ ...page, hosted: true }) === null) return null;
  const cell = oneWayIn({ ...page, hosted: !page.online || await hosted(world) });
  // OF3: a world whose word (heard just now, or kept) leaves this shard out never seats it there: no grid entry, and the page's entry
  // (`entry.ts`) lands on the title with "Not in this world yet"
  if (cell === null || (page.online && !opens(page.slug))) return null;
  pageGridIntents().admit({ instance: cell.instance, slug: cell.slug, goto: true });
  return cell.instance;
}
