/** One shard-script body as a client draws it: a mover's pose, in the cell's frame. */
export interface ScriptNetView {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly euler: { readonly x: number; readonly y: number; readonly z: number };
  readonly enabled: boolean;
}
/** One public shared field of a shard's declared state, by its declared name. */
export interface StateNetRow { readonly name: string; readonly value: number }
/** One owner's lines for a player. */
export type OwnedRead = (player: string, out: Map<string, number>) => void;
/** What a host's shard publishes to a room. Read only when a room samples it; the page publishes too and never reads. */
export interface ShardRows {
  /** What each player holds in this world, by whoever keeps it, into `out`. */
  readonly owned: Map<string, OwnedRead>;
  readonly bodies: Map<string, () => ScriptNetView>;
  state: (() => readonly StateNetRow[]) | null;
  /** `state` rows a world system publishes for itself, by that system's id (E6: weather). */
  readonly world: Map<string, () => readonly StateNetRow[]>;
  /** What a fight told its views since a room last took them. */
  readonly calls: FightViewCall[];
}
/** The view call a body's pose input goes by: this, its id, a dot and the input. */
export const NET_POSE = 'pose.';
/** One call a fight made on its views. */
export interface FightViewCall { readonly name: string; readonly args: readonly number[] }

/** The row a day clock publishes: its phase of the day, 0 to 1. */
export const DAY_ROW = 'day.phase';
/** A clock's row moves in steps of this much of a day: a 24 minute day writes a row every 0.35 s, and no sun shows the step. */
const DAY_STEPS = 4096;
/** Publish a day clock for the host's lifetime. A client's sky follows it. */
export function publishDay(host: RowHost, clock: { readonly phase: number }): void {
  const row = { name: DAY_ROW, value: 0 }, rows: readonly StateNetRow[] = [row];
  publishWorldState(host, 'day', () => { row.value = Math.round(clock.phase * DAY_STEPS) / DAY_STEPS; return rows; });
}
/** A tick's worth of a fight's looks, many times over: a host no room drains stops here. */
const MAX_VIEW_CALLS = 256;
const books = new WeakMap<object, ShardRows>();
const NO_ROWS: ShardRows = { owned: new Map<string, OwnedRead>(), bodies: new Map<string, () => ScriptNetView>(), state: null, world: new Map<string, () => readonly StateNetRow[]>(), calls: [] };
interface RowHost { readonly scope: { readonly onDispose: (run: () => void) => unknown } }
function bookOf(host: RowHost): ShardRows {
  let book = books.get(host);
  if (book === undefined) { const fresh: ShardRows = { owned: new Map<string, OwnedRead>(), bodies: new Map<string, () => ScriptNetView>(), state: null, world: new Map<string, () => readonly StateNetRow[]>(), calls: [] }; book = fresh; books.set(host, fresh); host.scope.onDispose(() => { fresh.owned.clear(); fresh.bodies.clear(); fresh.state = null; fresh.world.clear(); }); }
  return book;
}
/** Publish a script body under its stable id for the host's lifetime. */
export function publishScriptBody(host: RowHost, id: string, read: () => ScriptNetView): void {
  const { bodies } = bookOf(host), wire = `script:${id}`;
  if (bodies.has(wire)) throw new Error(`Duplicate script row ${id}`);
  bodies.set(wire, read);
}
/** Publish the shard's public shared state. One lane owns a host's declared state. */
export function publishShardState(host: RowHost, read: () => readonly StateNetRow[]): void {
  const book = bookOf(host);
  if (book.state !== null) throw new Error('Duplicate declared state rows');
  book.state = read;
}
/** What a native lair's kernel tells its views, by its id: its ground ring, nothing after it for "gone". */
export const eliteGroundWord = (id: string): string => `elite.ground:${id}`;
/** Its moments, by the name its rows give each: an index into `ELITE_MOMENTS`, then where. */
export const eliteMomentWord = (id: string): string => `elite.moment:${id}`;
export const ELITE_MOMENTS = ['opened', 'growl', 'regrouped', 'interrupted', 'closed', 'howl', 'grounded', 'cry'] as const;
/** A captain's strike lane: its ends, width, strength and time, or nothing for none. */
export const eliteLaneWord = (id: string): string => `elite.lane:${id}`;
/** A captain's cue: an index into its row's cues, then where. */
export const eliteCueWord = (id: string): string => `elite.cue:${id}`;
/** A wind elite's beam and chevron: where it aims from and at, strength and time, or nothing for none. */
export const eliteWindWord = (id: string): string => `elite.wind:${id}`;
/** A fight told its views something. Nothing reads it unless a room is listening, so a page's own host keeps only what's bounded. */
export function sayFightView(host: RowHost, name: string, args: readonly number[]): void {
  const { calls } = bookOf(host);
  if (calls.length < MAX_VIEW_CALLS) calls.push({ name, args });
}
/** Publish a world system's own `state` rows for the host's lifetime. */
export function publishWorldState(host: RowHost, id: string, read: () => readonly StateNetRow[]): void {
  const { world } = bookOf(host);
  if (world.has(id)) throw new Error(`Duplicate world rows ${id}`);
  world.set(id, read);
}
/** Publish what an owner keeps for each player, for the host's lifetime. A later owner's line for the same name wins. */
export function publishOwned(host: RowHost, id: string, read: OwnedRead): void {
  const { owned } = bookOf(host);
  if (owned.has(id)) throw new Error(`Duplicate owned rows ${id}`);
  owned.set(id, read);
}
/** Everything a host publishes. */
export function shardRows(host: object): ShardRows { return books.get(host) ?? NO_ROWS; }
