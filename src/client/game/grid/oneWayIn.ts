// GO7 (meta MMO-PLAN MP1G, DG4; MMO-ZONE-SELECT ZS4's goto and ZS5's retirement): one way in. On a build with a world whose server
// hosts the grid (GO4's gate), Shard select → a grid shard enters the grid at that shard's cell, so Shard select and Infinite Wildshard
// land in the same online world, and no online page boots a bordered `'shard'` page for a grid shard. A shard the grid doesn't place,
// a build with no world (preview, sharddev), and a world that hosts only its home cell keep today's one-shard page.
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
  /** the world's `/health` table names more than the home cell (GO4's gate) */
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
interface OnlineGate { readonly worldHostsGrid: (world: { readonly release: string; readonly key: string }, hosts: (health: unknown) => boolean) => Promise<boolean> }

/** Whether this build's world hosts the grid. Any failure, and a build with no world, answer false: today's one-shard page. */
export async function worldHosted(world: unknown): Promise<boolean> {
  if (typeof world !== 'object' || world === null || !('release' in world) || !('key' in world)) return false;
  const { release, key } = world;
  if (typeof release !== 'string' || typeof key !== 'string') return false;
  try {
    const build = (globalThis as { __WS_BUILD_ID__?: string }).__WS_BUILD_ID__ ?? '';
    const gate = await import(/* @vite-ignore */ `/b/${build}/standalone/online.js`) as OnlineGate;
    return await gate.worldHostsGrid({ release, key }, hostsGrid);
  } catch { return false; }
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
  return pageGridIntents().set({ instance: cell.instance, slug: cell.slug, goto: true }) ? cell.instance : null;
}
