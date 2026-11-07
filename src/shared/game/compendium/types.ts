/**
 * The Compendium engine's data contract (PINE-HOLLOW-REMASTER PH-C5). A shard registers ONE `ShardCompendium` — its
 * entries, its trophy wall and a skin — and the engine does the rest: the per-entry state machine and its save
 * (state.ts), the game hooks that feed it (tracker.ts), the book (Journal.ts) and the wall (trophyWall.ts).
 *
 *   registerCompendium({ chunkId, skin, entries, trophies })   // registry.ts; Pine Hollow's is shards/pine-hollow.ts
 *
 * Nothing here is Pine Hollow's: Driftwood / Nalati adopt it by registering their own table and skin.
 */
import type { Rarity } from '@wildshard/engine/entities/species/registry';
import type { IconId } from '@wildshard/engine/ui/icons';

/** what an entry is: a species page, a named variant, an elite, the boss, a place */
export type EntryKind = 'species' | 'variant' | 'elite' | 'boss' | 'place';

/**
 * An entry's state, in order — it only ever moves forward:
 *   unknown    → the page reads "???" over a silhouette
 *   discovered → the name is known (heard it, came near it), the plate is still a silhouette
 *   seen       → in view within the spotting range (a place: stood in it) — the full plate and notes
 *   taken      → killed (the TAKEN stamp; a place never gets here)
 */
export type EntryState = 'unknown' | 'discovered' | 'seen' | 'taken';
export const STATE_ORDER: readonly EntryState[] = ['unknown', 'discovered', 'seen', 'taken'];

/** the plate: a sketch image (public path), and optionally the Explore creature viewer's model (catalog id + variant) */
export interface Plate {
  sketch: string;
  /** Explicit immutable silhouette; older URL plates retain their adjacent-file convention. */
  silhouette?: string;
  /** the Explore 3D viewer's creature — `Journal.onViewModel` opens it when the host wires one */
  model?: { id: string; variant?: string };
}

/** which kills / sightings an entry answers to: a species (`kind`), narrowed to some of its variants */
export interface AnimalMatch { kind: string; variants?: readonly string[] }

export interface EntryDef {
  /** unique within the shard, persisted */
  id: string;
  kind: EntryKind;
  /** the skin's tab this entry sits under */
  tab: string;
  name: string;
  /** one line under the name ("Cervus elaphus", "Terror of the Hollow") */
  subtitle?: string;
  /** the journal's hand-written note — shown from `seen` on */
  notes: string;
  /** the hint shown while only `discovered` ("Tracks by the still pond.") */
  hint?: string;
  rarity?: Rarity;
  plate: Plate;
  /** animals: the species / variants this entry records (spotted → seen, killed → taken) */
  match?: AnimalMatch;
  /** animals: body mass at scale 1 (kg) — the BEST stat is massKg × scale³ of the heaviest taken */
  massKg?: number;
  /** places: the spot (world x / z) and its radius — inside `r` = visited, inside `r` × the tracker's reach = discovered */
  place?: { x: number; z: number; r: number };
}

/** one mount slot on the trophy wall: taken → the animal's head on a shield; not yet → a chalk outline + the name */
export interface TrophySlot {
  /** the entry this slot mounts (its `taken` state decides the mount) */
  entry: string;
  /** the chalk outline's cell in the skin's atlas */
  outline: string;
  /** the mount's model: a species + variant from the registry; none (the King, before the boss lands) = chalk only */
  mount?: { kind: string; variant: string };
  /** the joke title under the name once it is taken */
  title: string;
}

export interface TabDef { id: string; label: string }

/** a skin: how a shard's book looks and reads. The DOM is the engine's; the skin adds its class, words and art. */
interface CompendiumSkin {
  /** modifier class on the book root (`ws-cmp journal`) — its look lives in compendium.css */
  className: string;
  /** the book's title (the menu button, the aria label) */
  title: string;
  tabs: readonly TabDef[];
  /** the tab listing the trophy wall (a grid page, not entry pages) — omit for a shard without a wall */
  trophyTab?: string;
  /** the stamp on a taken / visited page */
  stamp: (e: EntryDef) => string;
  /** the stats row: 3–4 label / value pairs */
  stats: (e: EntryDef, s: EntryStats) => { label: string; value: string }[];
  /** the FINDS sticker's glyph for an entry (the content's icons); a pin for a place, a dot otherwise when absent */
  icon?: (e: EntryDef) => IconId | undefined;
  /** the chalk outline atlas (public path) and its cells, for the trophy wall */
  chalk?: { atlas: string; cells: Record<string, { x: number; y: number; w: number; h: number }> };
}

/** where the trophy wall hangs: in cabin `cabin`'s local frame (src/engine/world/Cabin.ts: door on +X, ridge along Z), the wall
 *  face's centre at floor level `at`, turned by `yaw` so the wall's +z points into the room; the slots per row (top
 *  first), the width they spread over and each row's centre height above `at` */
export interface WallPlacement { cabin: number; at: [number, number, number]; yaw: number; width: number; rows: readonly number[]; rowY: readonly number[] }

export interface ShardCompendium {
  chunkId: string;
  skin: CompendiumSkin;
  entries: readonly EntryDef[];
  trophies?: readonly TrophySlot[];
  wall?: WallPlacement;
}

/** what the book shows per entry */
export interface EntryStats {
  state: EntryState;
  /** individuals spotted (a place: visits) */
  seen: number;
  taken: number;
  /** kg of the heaviest taken (0 = none) */
  best: number;
}
