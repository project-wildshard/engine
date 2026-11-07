import { ACCENTS, type AccentId } from '@wildshard/format/accent';

/**
 * The accent the big item cards wear right now (SHARD-PLATFORM SF28, G87 / G104): the booted shard's declared accent
 * (`ShardManifest.accent`, one of the platform's 20), and inside the grid the accent of the cell the traveller stands in;
 * null on the road and for a shard that declares none (the cards then wear the HUD's own cyan). The session sets it at boot
 * (`play.ts`), the grid HUD on each cell enter / leave (`grid/gridHud.ts`); the platform panels read it when they draw
 * (`loot/ui/ShopPanel.ts`, the HUD's pickup card through `hud.cardAccent`).
 */
let current: string | null = null;
const listeners = new Set<(hex: string | null) => void>();

/** the cards' accent hex now (null: the HUD cyan) */
export function hudAccent(): string | null { return current; }

/** set the cards' accent (a hex, or null for the HUD cyan); listeners hear only a change */
export function setHudAccent(hex: string | null): void {
  if (hex === current) return;
  current = hex;
  for (const fn of listeners) fn(hex);
}

/** a declared accent id as its hex (undefined: none declared) */
export function accentHex(id: AccentId | undefined): string | null { return id === undefined ? null : ACCENTS[id]; }

/** hear every change; returns the unsubscribe */
export function onHudAccent(fn: (hex: string | null) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
