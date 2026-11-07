import type { SaveStore } from '@wildshard/engine/saves/store';
import { instanceSaveIdentity, type LocalSaveInstance } from './instanceSaves';

/** Optional quest identities let an unloaded shard's card count completion from its legacy flags without executing its runtime. */
export interface NewGameQuest { id: string; completeFlag: string }
/** Detached before/after progress for the Settings confirmation. Null quest counts mean legacy flags exist without a declared quest catalogue. */
export interface NewGameProgress {
  quests: { saved: boolean; started: number | null; completed: number | null };
  inventory: { items: readonly { id: string; quantity: number }[]; quantity: number; coins: number };
  flags: readonly string[];
}
/** A reset affects one stable instance. The kept categories include legacy shard feat progress as well as the profile ledger. */
export interface NewGameSummary {
  instance: LocalSaveInstance; before: NewGameProgress; after: NewGameProgress;
  kept: readonly ['profile', 'feats', 'other-shards']; removedKeys: readonly string[];
}
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const record = (value: unknown): Record<string, unknown> => isRecord(value) ? value : {};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((row: unknown): row is string => typeof row === 'string') : [];
const natural = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const empty = (): NewGameProgress => ({ quests: { saved: false, started: 0, completed: 0 }, inventory: { items: [], quantity: 0, coins: 0 }, flags: [] });
const kept = (key: string): boolean => key === 'progress' || key.startsWith('progress.corrupt.');
function progress(entries: Readonly<Record<string, unknown>>, quests: readonly NewGameQuest[]): NewGameProgress {
  const data = (key: string): unknown => record(entries[key])['data'];
  const continuation = record(data('platform.continuation')), region = record(data('platform.region'));
  const logical = record(region['logical']);
  const packed: unknown = Object.keys(logical).length === 0 && typeof region['snapshot'] === 'string' ? JSON.parse(region['snapshot']) : null;
  const regional = Object.keys(logical).length > 0 ? logical : record(record(packed)['snapshot']);
  const flags = [...new Set([...strings(data('flags')), ...strings(continuation['flags']), ...strings(regional['flags'])])].sort();
  const rows: unknown[] = Array.isArray(continuation['quests']) ? continuation['quests'] : Array.isArray(regional['quests']) ? regional['quests'] : [];
  const states = rows.map(record), hasProgress = flags.length > 0 || states.some((row) => row['started'] === true);
  const counts = new Map<string, number>();
  for (const [id, quantity] of Object.entries(record(record(data('inventory'))['counts']))) if (natural(quantity) > 0) counts.set(id, natural(quantity));
  for (const id of strings(record(data('owned'))['owned'])) counts.set(id, Math.max(1, counts.get(id) ?? 0));
  const items = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([id, quantity]) => ({ id, quantity }));
  return {
    quests: { saved: hasProgress,
      started: states.length > 0 ? states.filter((row) => row['started'] === true).length : hasProgress ? null : 0,
      completed: quests.length > 0 ? quests.filter((quest) => flags.includes(quest.completeFlag)).length
        : states.length > 0 ? states.filter((row) => row['started'] === true && row['currentId'] === null).length : hasProgress ? null : 0 },
    inventory: { items, quantity: items.reduce((sum, row) => sum + row.quantity, 0), coins: natural(data('purse')) }, flags,
  };
}
/** Preview without mutating saves or loading a shard runtime. Cards must pass an explicit copy id, never a grid cell. */
export function previewNewGame(store: SaveStore, instance: LocalSaveInstance, quests: readonly NewGameQuest[] = []): NewGameSummary {
  const entries = store.inspectShard(instanceSaveIdentity(instance));
  return { instance: { ...instance }, before: progress(entries, quests), after: empty(), kept: ['profile', 'feats', 'other-shards'],
    removedKeys: Object.keys(entries).filter((key) => !kept(key)).sort() };
}
/** Confirm a fresh preview and reset durably; old live checkpoints cannot revive it. Reload the page or evict/rebind this instance including frozen grid residents only when applied is true; a refusal keeps playing intact. */
export function resetNewGame(store: SaveStore, instance: LocalSaveInstance, quests: readonly NewGameQuest[] = []): { applied: boolean; summary: NewGameSummary } {
  const summary = previewNewGame(store, instance, quests);
  const identity = instanceSaveIdentity(instance), entries = store.inspectShard(identity);
  const applied = store.resetShard(identity, Object.keys(entries).filter(kept));
  return { applied, summary: applied ? summary : { ...summary, after: structuredClone(summary.before) } };
}
