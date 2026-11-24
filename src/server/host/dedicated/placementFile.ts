// SA33 (meta SHARD-AUTHORING, J314): a new slug's cell reaches a running server with no engine release. The API places a new slug (SA30) and
// writes this file, signed with its own placement key; the release key stays engine CI's, because it vouches for the server bundle the box
// runs. A placement can only add a cell on an empty spot, for a shard whose server pack this build's book holds or (SA47) the cook's index
// of the cell's shardfile `hash` names: it never moves the build, the bundle or the save epoch, and a new serial here starts no grace, so
// players in every other cell stay connected.
import { Scope } from '@wildshard/engine/app/scope';
import { fetchSignedText, readSigned } from './releaseFile';
import { PlacementSchema, type PlacementFile } from '@wildshard/engine/game/grid/placementRows';
import { adoptSlugAliases } from '@wildshard/engine/game/slugNames';
import type { PlacedCell } from './gridCells';

/** How often the server looks, in ms: the release file's minute, so a placement is open inside SA33's two minutes. */
const POLL_MS = 60_000;
const WHAT = 'placement file';
/** The file's text as what it says, under the placement key (SPKI DER in hex). */
export function readPlacementFile(text: string, publicKey: string): PlacementFile { return readSigned(text, publicKey, PlacementSchema, WHAT); }
/** The placement file at `url`, an `https:` bucket or a `file:` path. */
export async function fetchPlacementFile(url: string, publicKey: string): Promise<PlacementFile> { return readPlacementFile(await fetchSignedText(url, WHAT), publicKey); }

/** How a placement watch is built. */
export interface PlacementWatchOptions {
  readonly read: () => Promise<PlacementFile>;
  /** The channel this server plays. */
  readonly channel: string;
  /** Open these cells, the ones this server hasn't opened yet; answer the instances that opened. A cell left out is asked for again next look.
   *  `file` is every cell the file names, in its order, so a late cell keeps its place (MA10k). */
  readonly open: (cells: readonly PlacedCell[], file: readonly PlacedCell[]) => Promise<readonly string[]>;
  /** MZ33: every look's file, before any cell opens, so the server drops a cell the file no longer names (a `wildshard delete`) and
   *  re-slots the rest as a page does. Answers the instances that left, which a later file may name and open again. */
  readonly keep?: (file: readonly PlacedCell[]) => readonly string[];
  /** A look that failed. The server plays on with the cells it has. */
  readonly failed: (error: unknown) => void;
  readonly everyMs?: number;
}
/** SA33: a running server's cells grow when the placement file names one it hasn't opened. MZ33: a cell the file stops naming leaves the
 *  server's grid (`keep`), so a delete needs no restart; its worker idles until the next restart deals the cells out again. */
export class PlacementWatch {
  private readonly options: PlacementWatchOptions;
  private readonly scope = new Scope('dedicated.placement');
  private readonly opened = new Set<string>();
  private looking = false;
  private seen = -1;
  private featuredOrder: readonly string[] | undefined;
  constructor(options: PlacementWatchOptions) {
    this.options = options;
    this.scope.interval(options.everyMs ?? POLL_MS, () => { void this.look(); });
  }
  /** The newest serial this server has believed, or -1. */
  get serial(): number { return this.seen; }
  /** OF31i: the newest believed file's featured order, or undefined when it names none (Featured then lists every visible zone). */
  get featured(): readonly string[] | undefined { return this.featuredOrder; }
  /** One look. An older file than one already believed changes nothing. */
  async look(): Promise<void> {
    if (this.looking) return;
    this.looking = true;
    try {
      const file = await this.options.read();
      if (file.channel !== this.options.channel) throw new Error(`A ${file.channel} placement file on a ${this.options.channel} server`);
      if (file.serial < this.seen) throw new Error(`Placement serial ${String(file.serial)} is older than ${String(this.seen)}`);
      this.seen = file.serial;
      this.featuredOrder = file.featured; adoptSlugAliases(file.aliases);
      for (const instance of this.options.keep?.(file.cells) ?? []) this.opened.delete(instance);
      const fresh = file.cells.filter(cell => !this.opened.has(cell.instance));
      if (fresh.length > 0) for (const instance of await this.options.open(fresh, file.cells)) this.opened.add(instance);
    } catch (error) { this.options.failed(error); } finally { this.looking = false; }
  }
  dispose(): void { this.scope.dispose(); }
}

/** What a watch's `open` needs from the door. */
export interface PlacementOpenerOptions {
  /** SA34a: the pack first, so the door's placed list holds only cells it opens; MA10k: its frame is its place in the file, so a late
   *  pack never swaps two cells' numbers between the door, the workers and the page. A throw refuses the row; the next look asks again. */
  readonly read: (row: PlacedCell) => Promise<void>;
  readonly place: (row: PlacedCell, file: readonly PlacedCell[]) => void;
  /** Whether the world already runs this cell: a release's own cell the file also names, or one an upload activation opened. */
  readonly running: (instance: string) => boolean;
  /** Open these cells on the running world; answers the ones that opened. */
  readonly open: (instances: readonly string[]) => Promise<readonly string[]>;
  readonly refused: (row: PlacedCell, error: unknown) => void;
}
/** The watch's `open`. QA-FEEDBACK-2026-11-24 row 61 (opus-lag): a cell the world already runs counts as opened once its row is
 *  placed. Before, `World.openCells` skipped it and answered nothing, so the watch asked for it again every minute, and each look read
 *  and checked its whole pack on the door thread: a 60 to 90 ms stall every minute on the staging and production doors. */
export function placementOpener(options: PlacementOpenerOptions): PlacementWatchOptions['open'] {
  return async (rows, file) => {
    const ready: string[] = [];
    for (const row of rows) {
      try { await options.read(row); options.place(row, file); ready.push(row.instance); } catch (error) { options.refused(row, error); }
    }
    const running = ready.filter(instance => options.running(instance)), fresh = ready.filter(instance => !running.includes(instance));
    return fresh.length === 0 ? running : [...running, ...await options.open(fresh)];
  };
}
