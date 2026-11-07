/**
 * Feature playgrounds (E307, Jake: "unique gameplay features need their own arenas … standalone, not slammed into the dummy
 * arena"): the Explore hub lists the shared entries (Model explorer, World explorer, Practice arena), then the current
 * shard's own playgrounds. Plugins register pure card data and lazy scene constructors, loaded on the tap.
 *
 * Driftwood Isle (melee) and Pine Hollow (crossbow) have no feature of their own that needs one (Jake): none listed.
 */

import type { PlaygroundSpec } from '../../../../server/engine/level/context';

export type PlaygroundId = string;

export interface PlaygroundCard {
  id: PlaygroundId;
  /** the shard whose feature it is: listed on that shard only */
  levelId: string;
  title: string;
  /** the card's one line */
  blurb: string;
  /** the placeholder art's glyph (an inline SVG on the card's dev-grid tile) until real card art exists */
  icon: string;
  art?: string;
}

export const PLAYGROUND_CARDS: readonly PlaygroundCard[] = [];
const registered = new Map<string, { card: PlaygroundCard; spec: PlaygroundSpec }>();
export function registerPlayground(levelId: string, spec: PlaygroundSpec): () => void {
  if (registered.has(spec.id)) throw new Error(`Duplicate playground: ${spec.id}`);
  registered.set(spec.id, { card: { ...spec, levelId }, spec });
  return () => { registered.delete(spec.id); };
}
export function registeredPlayground(id: string): PlaygroundSpec | undefined { return registered.get(id)?.spec; }
function cards(): readonly PlaygroundCard[] { return [...PLAYGROUND_CARDS, ...[...registered.values()].map((entry) => entry.card)]; }

/** the playgrounds the hub lists on `slug` (none on Driftwood Isle and Pine Hollow) */
export function playgroundsFor(levelId: string): PlaygroundCard[] {
  return cards().filter((c) => c.levelId === levelId);
}


/** a card's `data-pg` read back as an id (anything else: null) */
export function asPlaygroundId(s: string | undefined): PlaygroundId | null {
  return cards().find((c) => c.id === s)?.id ?? null;
}
