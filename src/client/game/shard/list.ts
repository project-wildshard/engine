import type { ShardManifest } from './manifest';

// The shard list is the composition root's (read from each product's discovery by src/client/app/shardSelection.ts; Node tools install
// src/client/app/shards.generated.ts through scripts/bake-loader.mjs; E362 AG4): the game knows that shards exist, never which. One slot per page, so a test that
// resets its modules still sees it. No runtime imports: a Node tool installs it without loading the engine.
const SLOT = Symbol.for('game.shards');
const isList = (v: unknown): v is readonly ShardManifest[] => Array.isArray(v);
/** Install the original prepared manifests. Save/instance slugs never change. */
export function installShards(list: readonly ShardManifest[]): void {
  Reflect.set(globalThis, SLOT, list);
}
/** Original manifests prepared for this page; titleList retains complete data-only catalogue metadata. */
export function shards(): readonly ShardManifest[] {
  const list: unknown = Reflect.get(globalThis, SLOT);
  if (!isList(list)) throw new Error('No shard list installed: the composition root installs it (src/client/app/shardSelection.ts)');
  return list;
}
const ART = Symbol.for('game.shardArt');
/** The byte sizes of the art of the discovery documents this page read, for the boot's "art" source. */
export function shardArt(): Readonly<Record<string, number>> {
  const held: unknown = Reflect.get(globalThis, ART);
  return typeof held === 'object' && held !== null ? Object.fromEntries(Object.entries(held).filter((row): row is [string, number] => typeof row[1] === 'number')) : {};
}
export function addShardArt(rows: Readonly<Record<string, unknown>>): void {
  Reflect.set(globalThis, ART, {...shardArt(), ...rows});
}
