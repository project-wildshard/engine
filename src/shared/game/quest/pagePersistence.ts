import type { Shardfile } from '@wildshard/format/shardSchema';
import type { ShardContext } from '../../../client/game/plugin/context';
import type { Flags } from '@wildshard/engine/world/interact/flags';
import type { SaveSlot, SaveStore } from '@wildshard/engine/saves/store';
import type { Progress } from '../../../client/game/Progress';
import * as v from 'valibot';
import { bossesSave } from '../saves';
import { bossFlagRecord, parseBossRecord, type BossRecordRow, type BossRowFlags } from '../plugin/bossRecord';
import { installRuntimeState } from '../shardfile/runtimeState';
import { projectRuntimeFacts, type RuntimeFacts } from '../plugin/runtimeRows';
import { createQuestLedger } from './ledger';

/** Bind the existing declared state owner, including its original legacy read.
 * Native page admission owns this call; no runtime declaration is synthesized. */
function pageState(ctx: Pick<ShardContext, 'app' | 'scope'>, source: Shardfile, key: string,
  legacy: () => boolean | string | number | null, instance: string) {
  return installRuntimeState(ctx.app.saves, ctx.scope, source, instance, key, legacy);
}

/** Bind a boss's original legacy seed once, retaining its admitted state or flag
 * owner as the only writer. Both declared browser encounter patterns use this path. */
export function bindPageBossRecord(ctx: Pick<ShardContext, 'app' | 'scope'> & Partial<Pick<ShardContext, 'manifest'>>, source: Shardfile, row: BossRecordRow,
  flags?: BossRowFlags, instance: string = source.identity.slug): {
  readonly read: () => ReturnType<typeof parseBossRecord>; readonly write: (saved: ReturnType<typeof parseBossRecord>) => void; readonly flush: () => boolean;
} {
  if (row.kind === 'flags') {
    if (flags === undefined) throw new Error('Boss flag record requires its actual flag owner');
    const legacy = bossesSave.read(ctx.manifest?.slug ?? source.identity.slug)[row.actor];
    if (legacy?.defeated === true) flags.set(row.names.defeated);
    if (legacy?.rewardTaken === true) flags.set(row.names.paid);
    const record = bossFlagRecord(flags, row.names);
    return { read: () => bossFlagRecord(flags, row.names).saved, write: record.persist, flush: () => true };
  }
  const state = pageState(ctx, source, row.key, () => JSON.stringify(bossesSave.read(source.identity.slug)[row.actor]
    ?? { defeated: false, rewardTaken: false, kills: 0 }), instance);
  return { read: () => {
    const saved = state.read(); if (typeof saved !== 'string') throw new Error(row.jsonError);
    const parsed: unknown = JSON.parse(saved); return parseBossRecord(parsed);
  }, write: saved => { if (!state.write(JSON.stringify(parseBossRecord(saved)))) throw new Error(row.writeError); },
  flush: () => state.write(state.read()) };
}

/** Authored persistence sources; legacy booleans are read only, never a second writer. */
export interface PagePersistenceRows {
  readonly reward: { readonly kind: 'state' | 'flag'; readonly key: string; readonly legacy: string };
  readonly boss?: { readonly record: BossRecordRow; readonly defeated: { readonly fact: string; readonly entity: string } };
}
/** One read-only legacy reward slot per save store and key. Re-entering a
 * retired region reuses the definition; the save store refuses duplicate ids. */
const legacyRewardSlots = new WeakMap<SaveStore, Map<string, SaveSlot<boolean>>>();
function legacyRewardSlot(saves: SaveStore, key: string): SaveSlot<boolean> {
  let slots = legacyRewardSlots.get(saves);
  if (slots === undefined) { slots = new Map(); legacyRewardSlots.set(saves, slots); }
  let slot = slots.get(key);
  if (slot === undefined) { slot = saves.define({ key, scope: 'shard', version: 1, schema: v.boolean(), initial: () => false }); slots.set(key, slot); }
  return slot;
}
/** One reward owner and one projected ledger for browser continuation. */
export interface PagePersistence {
  readonly facts: RuntimeFacts;
  readonly rewarded: { read: () => boolean; write: (value: boolean) => void };
  readonly boss: ReturnType<typeof bindPageBossRecord> | null;
  readonly legacyPaid: boolean;
  readonly bindProgress: (progress: Pick<Progress, 'bindLedger' | 'refreshLedger'> | undefined) => void;
}
export function bindPagePersistence(ctx: Pick<ShardContext, 'app' | 'scope'>, source: Shardfile,
  rows: PagePersistenceRows & { readonly boss: NonNullable<PagePersistenceRows['boss']> },
  flags?: Pick<Flags, 'has' | 'set'>, instance?: string): PagePersistence & { readonly boss: ReturnType<typeof bindPageBossRecord> };
export function bindPagePersistence(ctx: Pick<ShardContext, 'app' | 'scope'>, source: Shardfile,
  rows: PagePersistenceRows, flags?: Pick<Flags, 'has' | 'set'>, instance?: string): PagePersistence;
/** Bind declared reward/encounter persistence and drain every durable owner before checkpointing. */
export function bindPagePersistence(ctx: Pick<ShardContext, 'app' | 'scope'>, source: Shardfile,
  rows: PagePersistenceRows, flags?: Pick<Flags, 'has' | 'set'>, instance = source.identity.slug): PagePersistence {
  const row = rows.reward;
  const legacy = legacyRewardSlot(ctx.app.saves, row.legacy);
  const state = row.kind === 'state' ? pageState(ctx, source, row.key, () => legacy.read(source.identity.slug), instance) : null;
  if (row.kind === 'flag' && flags === undefined) throw new Error('Declared reward needs its flag owner');
  const rewarded = { read: (): boolean => {
    const value = state === null ? flags?.has(row.key) : state.read();
    if (typeof value !== 'boolean') throw new Error('Reward state must be boolean'); return value;
  }, write: (value: boolean): void => {
    if (state !== null) { if (!state.write(value)) throw new Error('Reward checkpoint is not durable'); }
    else { if (flags === undefined) throw new Error('Missing reward flag owner'); flags.set(row.key, value); }
  } };
  const boss = rows.boss === undefined ? null : bindPageBossRecord(ctx, source, rows.boss.record, flags, instance);
  const facts = projectRuntimeFacts(createQuestLedger(ctx.app.saves, source, instance), undefined);
  if (boss?.read().defeated === true && rows.boss !== undefined) facts(rows.boss.defeated.fact, rows.boss.defeated.entity);
  return { facts, rewarded, boss, legacyPaid: legacy.read(instance), bindProgress: progress => {
    facts.bindProgress(progress, () => { const reward = state === null || state.write(state.read()), encounter = boss?.flush() ?? true, ledger = facts.flush(); return reward && encounter && ledger; });
  } };
}
