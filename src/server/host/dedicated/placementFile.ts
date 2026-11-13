// SA33 (meta SHARD-AUTHORING, J314): a new slug's cell reaches a running server with no engine release. The API places a new slug (SA30) and
// writes this file, signed with its own placement key; the release key stays engine CI's, because it vouches for the server bundle the box
// runs. A placement can only add a cell on an empty spot, for a shard whose server pack this build's book already holds: it never moves the
// build, the bundle or the save epoch, and a new serial here starts no grace, so players in every other cell stay connected.
import { Scope } from '@wildshard/engine/app/scope';
import { fetchSignedText, readSigned } from './releaseFile';
import { PlacementSchema, type PlacementFile } from '@wildshard/engine/game/grid/placementRows';
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
  /** Open these cells, the ones this server hasn't opened yet; answer the instances that opened. A cell left out is asked for again next look. */
  readonly open: (cells: readonly PlacedCell[]) => Promise<readonly string[]>;
  /** A look that failed. The server plays on with the cells it has. */
  readonly failed: (error: unknown) => void;
  readonly everyMs?: number;
}
/** SA33: a running server's cells grow when the placement file names one it hasn't opened. It never closes one: delete is SA31's, at a restart. */
export class PlacementWatch {
  private readonly options: PlacementWatchOptions;
  private readonly scope = new Scope('dedicated.placement');
  private readonly opened = new Set<string>();
  private looking = false;
  private seen = -1;
  constructor(options: PlacementWatchOptions) {
    this.options = options;
    this.scope.interval(options.everyMs ?? POLL_MS, () => { void this.look(); });
  }
  /** The newest serial this server has believed, or -1. */
  get serial(): number { return this.seen; }
  /** One look. An older file than one already believed changes nothing. */
  async look(): Promise<void> {
    if (this.looking) return;
    this.looking = true;
    try {
      const file = await this.options.read();
      if (file.channel !== this.options.channel) throw new Error(`A ${file.channel} placement file on a ${this.options.channel} server`);
      if (file.serial < this.seen) throw new Error(`Placement serial ${String(file.serial)} is older than ${String(this.seen)}`);
      this.seen = file.serial;
      const fresh = file.cells.filter(cell => !this.opened.has(cell.instance));
      if (fresh.length > 0) for (const instance of await this.options.open(fresh)) this.opened.add(instance);
    } catch (error) { this.options.failed(error); } finally { this.looking = false; }
  }
  dispose(): void { this.scope.dispose(); }
}
