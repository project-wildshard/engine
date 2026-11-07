import * as v from 'valibot';
import { saves } from '@wildshard/engine/saves/runtime';
import type { SaveSlot, SaveStorage } from '@wildshard/engine/saves/store';
import { inventoryKey, purseKey } from './localSaveKeys';

const finite = v.pipe(v.number(), v.finite());
const numbers = v.record(v.string(), finite);
const strings = v.array(v.string());
const define = <S extends v.GenericSchema>(key: string, schema: S, initial: () => v.InferOutput<S>): SaveSlot<v.InferOutput<S>> => saves.define({ key, scope: 'shard', version: 1, schema, initial });
export const progressSave: SaveSlot<{ counts: Record<string, number>; earned: string[]; title: string | null; playS: number; }> = define('progress', v.object({ counts: numbers, earned: strings, title: v.nullable(v.string()), playS: v.optional(finite, 0) }), () => ({ counts: {}, earned: [], title: null, playS: 0 }));
export const inventorySave: SaveSlot<{ counts: Record<string, number>; order: string[]; }> = saves.define(inventoryKey);
export const purseSave: SaveSlot<number> = saves.define(purseKey);
export const ownedSave: SaveSlot<{ owned: string[]; worn: string[]; }> = define('owned', v.object({ owned: strings, worn: strings }), () => ({ owned: [], worn: [] }));
export const bountySave: SaveSlot<Record<string, number>> = define('bounty', numbers, () => ({}));
export const compendiumSave: SaveSlot<Record<string, { s: number; n: number; t: number; b: number; }>> = define('compendium', v.record(v.string(), v.object({ s: finite, n: finite, t: finite, b: finite })), () => ({}));
export const bossesSave: SaveSlot<Record<string, { defeated: boolean; rewardTaken: boolean; kills: number; }>> = define('bosses', v.record(v.string(), v.object({ defeated: v.boolean(), rewardTaken: v.boolean(), kills: finite })), () => ({}));
export const elitesSave: SaveSlot<Record<string, { timer: number; discovered: boolean; skinTaken: boolean; kills: number; retired: boolean; }>> = define('elites', v.record(v.string(), v.object({ timer: finite, discovered: v.boolean(), skinTaken: v.boolean(), kills: finite, retired: v.boolean() })), () => ({}));
/** Legacy actor APIs accept strings until their shard phase; normalize the old identifier at this boundary. */
export function saveSlug(id: string): string { return id.replace(/^chunk:\/\/local\//u, ''); }

/** Weapon finishes retain their pre-flip save document and version. */
export const skinSave: SaveSlot<{ owned: string[]; worn: Record<string, string> }> = define('skins', v.object({ owned: strings, worn: v.record(v.string(), v.string()) }), () => ({ owned: [], worn: {} }));
/** Unclaimed authoritative finish drops survive a reload. */
export const finishPickupSave: SaveSlot<Record<string, { x: number; y: number; z: number }>> = define('finish-pickups', v.record(v.string(), v.object({ x: finite, y: finite, z: finite })), () => ({}));

/** Durable, player-owned creature progress; the dictionary key is a device identity, never a simulation seat. */
export interface CreatureRewardState {
  finishes: string[]; pending: Record<string, { x: number; y: number; z: number }>;
  journal: Record<string, { s: number; n: number; t: number; b: number }>;
}
export const CreatureRewardSchema: v.GenericSchema<unknown, CreatureRewardState> = v.strictObject({
  finishes: v.array(v.string()), pending: v.record(v.string(), v.strictObject({ x: finite, y: finite, z: finite })),
  journal: v.record(v.string(), v.strictObject({ s: finite, n: finite, t: finite, b: finite })),
});
/** The first local device alone may inherit old shard-wide saves. Other devices start with their own record. */
export const creatureRewardSave: SaveSlot<{ legacyOwner: string | null; players: Record<string, CreatureRewardState> }> = define('creature-rewards', v.strictObject({ legacyOwner: v.nullable(v.string()),
  players: v.record(v.string(), CreatureRewardSchema) }), () => ({ legacyOwner: null, players: {} }));

const ProgressDocument = v.object({ keys: v.record(v.string(), v.unknown()), reset: v.optional(finite) });
const SkinEntry = v.object({ v: v.literal(1), data: v.object({ owned: strings, worn: v.record(v.string(), v.string()) }) });
const JournalEntry = v.object({ v: v.literal(1), data: v.record(v.string(), v.object({ s: finite, n: finite, t: finite, b: finite })) });
/** Reconcile the page's current discovery and cosmetics before booting a worker. The stores are distinct in production;
 * the one-time import alone cannot carry a page's later progress. Continuations and other worker entries stay in place. */
export async function syncPageRewards(worker: { storage: SaveStorage; write: (key: string, value: string) => Promise<boolean> }, page: SaveStorage, prefix: string): Promise<void> {
  for (let index = 0; index < page.length; index++) {
    const key = page.key(index);
    if (key === null || !key.startsWith(prefix)) continue;
    const raw = page.getItem(key); if (raw === null) continue;
    try {
      const local = v.parse(ProgressDocument, JSON.parse(raw)), previous = worker.storage.getItem(key), saved = v.parse(ProgressDocument, JSON.parse(previous ?? '{"keys":{}}'));
      if (local.reset !== saved.reset && previous !== null) continue;
      const keys = { ...saved.keys }, skins = v.safeParse(SkinEntry, local.keys['skins']), journal = v.safeParse(JournalEntry, local.keys['compendium']);
      if (skins.success) {
        const old = v.safeParse(SkinEntry, keys['skins']);
        keys['skins'] = { v: 1, data: { owned: [...new Set([...(old.success ? old.output.data.owned : []), ...skins.output.data.owned])], worn: skins.output.data.worn } };
      }
      if (journal.success) {
        const old = v.safeParse(JournalEntry, keys['compendium']), entries = { ...old.success ? old.output.data : {} };
        for (const [id, stats] of Object.entries(journal.output.data)) {
          const held = entries[id]; entries[id] = held === undefined ? stats : { s: Math.max(held.s, stats.s), n: Math.max(held.n, stats.n), t: Math.max(held.t, stats.t), b: Math.max(held.b, stats.b) };
        }
        keys['compendium'] = { v: 1, data: entries };
      }
      if (skins.success || journal.success) { const next = JSON.stringify({ ...saved, keys }); if (next !== previous && !await worker.write(key, next)) throw new Error('Page rewards could not be saved'); }
    } catch (error) { if (error instanceof SyntaxError || error instanceof v.ValiError) continue; throw error; }
  }
}
