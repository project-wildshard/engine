/**
 * The shards' compendiums: each shard that has one registers it once (install.ts registers shards/pine-hollow.ts's).
 * A shard without one has no journal, no hooks and no trophy wall.
 *
 *   registerCompendium(def);   compendiumFor('chunk://local/pine-hollow') → ShardCompendium | undefined
 */
import type { ShardCompendium } from './types';

const TABLE = new Map<string, ShardCompendium>();

export function registerCompendium(def: ShardCompendium): () => void {
  const ids = new Set<string>();
  for (const e of def.entries) {
    if (ids.has(e.id)) throw new Error(`compendium ${def.chunkId}: duplicate entry '${e.id}'`);
    if (!def.skin.tabs.some((t) => t.id === e.tab)) throw new Error(`compendium ${def.chunkId}: entry '${e.id}' sits under an unknown tab '${e.tab}'`);
    ids.add(e.id);
  }
  for (const t of def.trophies ?? []) if (!ids.has(t.entry)) throw new Error(`compendium ${def.chunkId}: trophy slot for an unknown entry '${t.entry}'`);
  const id = def.chunkId.replace(/^chunk:\/\/local\//u, '');
  const previous = TABLE.get(id);
  TABLE.set(id, def);
  return () => { if (TABLE.get(id) === def) { if (previous) TABLE.set(id, previous); else TABLE.delete(id); } };
}

export function compendiumFor(chunkId: string): ShardCompendium | undefined {
  const id = chunkId.replace(/^chunk:\/\/local\//u, '');
  return TABLE.get(id);
}
