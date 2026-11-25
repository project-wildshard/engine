// SHARD-COMPAT NB2 (J494, Jake 2026-11-22: "the page should always run the server revision"). The rooms are the one source of truth
// for which bytes a zone runs. P1, 2026-11-22: an upload moved staging's Driftwood cell to r9 (`uploadActivation.ts` moves a catalogue
// cell's hash; the signed placement file names only the cells the baked grid lacks), while the page drew its own baked r8, and every
// enemy was invisible. The door's world word now names each cell's upload hash (`revisions`); a page that runs other bytes for its zone
// keeps the rooms' word for this build and reloads once, and the next boot draws the rooms' upload (`placedCells.ts`) or refuses with
// Reload. Every slot is on `globalThis` or the tab's session storage: the online door's bundle and the game's share them.
import { saveEnvironment } from '@wildshard/engine/saves/environment';
import { bareSlug, installedCatalogue } from '../../../shared/game/grid/catalogueSlot';

const FOLLOWED = Symbol.for('game.rooms-followed');
const HEX = /^[a-f0-9]{64}$/u;
const followedMap = (): Map<string, string> => {
  const held: unknown = Reflect.get(globalThis, FOLLOWED);
  if (held instanceof Map) return held as Map<string, string>;
  const made = new Map<string, string>();
  Reflect.set(globalThis, FOLLOWED, made);
  return made;
};
/** This page now draws `slug` from the rooms' upload `hash`. */
export function noteFollowed(slug: string, hash: string): void { followedMap().set(bareSlug(slug), hash); }
export function clearFollowed(): void { followedMap().clear(); }
/** The bytes this page runs for `slug`: the rooms' upload it followed, else its build's own (`catalogue.shards`); undefined for a slug
 *  the build never baked (an upload after it, SA48's own path). */
export function pageRevision(slug: string): string | undefined {
  const bare = bareSlug(slug);
  return followedMap().get(bare) ?? installedCatalogue()?.shards?.find(row => bareSlug(row.slug) === bare)?.hash;
}
/** The world word's `revisions`, slug to upload hash; empty for a door that names none (an older one). */
export function roomsWord(word: unknown): ReadonlyMap<string, string> {
  const said: unknown = typeof word === 'object' && word !== null ? Reflect.get(word, 'revisions') : undefined;
  if (typeof said !== 'object' || said === null) return new Map();
  return new Map(Object.entries(said).filter((pair): pair is [string, string] => typeof pair[1] === 'string' && HEX.test(pair[1]))
    .map(([slug, hash]) => [bareSlug(slug), hash]));
}
/** The slugs this page baked whose rooms run other bytes, with the rooms' hash. */
export function aheadOfPage(revisions: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const [slug, hash] of revisions) { const runs = pageRevision(slug); if (runs !== undefined && runs !== hash) out.set(slug, hash); }
  return out;
}

/** The rooms' last word this tab heard, for this build: which uploads to draw, and the one reload each was given. */
export interface RoomsHints {
  /** False when nothing the tab keeps survives a reload: the one-reload guard cannot hold, so the page never reloads for the rooms */
  readonly durable?: boolean;
  readonly read: () => { readonly revisions: Readonly<Record<string, string>>; readonly reloaded: Readonly<Record<string, string>> };
  readonly write: (hints: { readonly revisions: Readonly<Record<string, string>>; readonly reloaded: Readonly<Record<string, string>> }) => void;
}
const NONE = { revisions: {}, reloaded: {} };
const flat = (value: unknown): Record<string, string> => typeof value === 'object' && value !== null
  ? Object.fromEntries(Object.entries(value).filter((pair): pair is [string, string] => typeof pair[1] === 'string' && HEX.test(pair[1]))) : {};
type TabStore = Pick<Storage, 'getItem' | 'setItem'>;
/** The tab's own session storage. v0.1.75 K4 (staging, Pine r12 baked, its rooms on r13): the online door hears the world word
 *  before (or without) the page installing its save environment, whose default keeps nothing, so the one-reload guard never held
 *  and every boot reloaded again, nine times in 90 s. The browser's own store is read when the save environment has none. */
function tabStore(): TabStore | null {
  const installed = saveEnvironment().storage('session');
  if (installed !== null) return installed;
  // oxlint-disable-next-line wildshard/no-raw-save -- online.js has no save store (OF4, as worldRestart.ts): one tab-scoped hint
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}
/** The tab's session storage, under this build's id: a new release starts with none. */
export function sessionHints(build: unknown = Reflect.get(globalThis, '__WS_BUILD_ID__'), store: () => TabStore | null = tabStore): RoomsHints {
  const key = `ws-rooms-revision:${typeof build === 'string' ? build : 'dev'}`;
  return {
    get durable() { return store() !== null; },
    read: () => {
      try {
        const text = store()?.getItem(key) ?? null;
        if (text === null) return NONE;
        const parsed = JSON.parse(text) as unknown;
        if (typeof parsed !== 'object' || parsed === null) return NONE;
        return { revisions: flat(Reflect.get(parsed, 'revisions')), reloaded: flat(Reflect.get(parsed, 'reloaded')) };
      } catch { return NONE; }
    },
    write: hints => { try { store()?.setItem(key, JSON.stringify(hints)); } catch { /* a tab that keeps nothing follows the file only */ } },
  };
}

/** What a page did with the door's world word: nothing to do, a reload onto the rooms' bytes, or none left to give (it stays behind,
 *  and `spawnDownload.ts` refuses entry with Reload). */
export type RoomsHeard = 'same' | 'reload' | 'behind';
/** QA 11-25 row 63: the end a rooms-ahead reload leaves with. It goes out through the shell's seat-elsewhere path, but it is no
 *  seat: v0.1.91's K2 read 'online seat elsewhere (driftwood-isle)' as a seat regression when Driftwood r13 went live after the cut. */
export function roomsAheadEnd(zone: string, hash: string): string { return `rooms ahead (${zone} runs ${hash.slice(0, 12)})`; }
/** On every world word: keep the rooms' revisions for this build, and reload once when the zone this page plays (`loaded`) runs other
 *  bytes than the rooms. A second word that still disagrees for the same hash never reloads again.
 *  QA 11-23-b rows 18 and 20 (Jake, staging, Signal Dunes r6 live at 16:28 UTC: thrown to the main menu, and ENTER THE MMO's Signal
 *  Dunes card dropping to the menu): `reload` leaves on purpose back into `zone` (the shell's seat-elsewhere path: a marked end and
 *  the tab's arrival). A bare `location.reload()` read as the player's own, and the QA 11-12 row 35 rule sent it to a quiet title. */
export function heardRooms(word: unknown, loaded: string | undefined, reload: (zone: string, hash: string) => void, hints: RoomsHints = sessionHints()): RoomsHeard {
  const revisions = roomsWord(word);
  if (revisions.size === 0) return 'same';
  const ahead = aheadOfPage(revisions), kept = hints.read();
  // the rooms' whole word, not a merge: a cell back on the build's own bytes drops its hint
  const next = { revisions: Object.fromEntries([...revisions].filter(([slug]) => pageRevision(slug) !== undefined)), reloaded: { ...kept.reloaded } };
  const zone = loaded === undefined ? undefined : bareSlug(loaded), want = zone === undefined ? undefined : ahead.get(zone);
  if (zone === undefined || want === undefined) { hints.write(next); return 'same'; }
  // a tab that keeps nothing cannot remember the reload it was given: it stays behind rather than reload forever
  if (kept.reloaded[zone] === want || hints.durable === false) { hints.write(next); return 'behind'; }
  hints.write({ ...next, reloaded: { ...next.reloaded, [zone]: want } });
  reload(zone, want);
  return 'reload';
}
