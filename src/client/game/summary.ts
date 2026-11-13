import * as v from 'valibot';
import { saves } from '@wildshard/engine/saves/runtime';
import type { SaveStore } from '@wildshard/engine/saves/store';
import { progressSave } from '../../shared/game/saves';
import { titleManifests } from './shard/titleList';
import { playerHidden } from '../../shared/game/grid/catalogueSlot';
import type { ShardSlug } from '../../shared/game/shard/slug';

const count = v.pipe(v.number(), v.finite(), v.integer(), v.minValue(0));
const finite = v.pipe(v.number(), v.finite(), v.minValue(0));
const schema: v.GenericSchema<BoundedSummaryInput, BoundedSummary> = v.object({ v: v.literal(1), shards: v.record(v.string(), v.object({ earned: count, total: v.nullable(count), playS: finite, at: finite })) });
export type WildshardSummary = v.InferOutput<typeof schema>;
export interface SummaryProgress { earned: readonly string[]; playS: number }
export interface SummaryLine { slug: string; name: string; earned: number; total: number | null; playS: number; visited: boolean }
export interface SummaryView { lines: readonly SummaryLine[]; earned: number; visited: boolean }

/** Rebuild from validated save documents only: no world builder or plugin is loaded. */
export function buildSummary(shards: readonly { slug: string; status?: string }[], read: (slug: string) => SummaryProgress | null, at: number = Date.now()): WildshardSummary {
  const result: WildshardSummary = { v: 1, shards: {} };
  for (const row of shards) {
    const { slug } = row;
    if (playerHidden(row)) continue;
    const progress = read(slug);
    if (progress !== null) result.shards[slug] = { earned: new Set(progress.earned).size, total: null, playS: progress.playS, at };
  }
  return result;
}
export function summaryView(summary: WildshardSummary, shards: readonly { slug: string; name: string; status?: string }[]): SummaryView {
  const lines = shards.filter((shard) => !playerHidden(shard)).map(({ slug, name }): SummaryLine => {
    const line = summary.shards[slug];
    return { slug, name, earned: line?.earned ?? 0, total: line?.total ?? null, playS: line?.playS ?? 0, visited: line !== undefined };
  });
  return { lines, earned: lines.reduce((sum, line) => sum + line.earned, 0), visited: lines.some((line) => line.visited) };
}
/** An injectable store keeps first-boot/import reconstruction and shard updates node-testable. */
export function summaryStore(store: SaveStore, read: (slug: string) => SummaryProgress | null): { read: () => WildshardSummary; update: (slug: string, progress: SummaryProgress, total: number) => void } {
  const slot = store.define({ key: 'summary', scope: 'global', version: 1, schema, initial: (): WildshardSummary => ({ v: 1, shards: {} }) });
  const current = (): WildshardSummary => {
    const saved = slot.peek();
    if (saved !== null) return saved;
    const rebuilt = buildSummary(titleManifests().filter((shard) => !playerHidden(shard)), read); slot.write(rebuilt); return rebuilt;
  };
  return {
    read: current,
    update: (slug: string, progress: SummaryProgress, total: number): void => {
      const summary = current();
      summary.shards[slug] = { earned: new Set(progress.earned).size, total, playS: progress.playS, at: Date.now() };
      slot.write(summary);
    },
  };
}
const summaries = summaryStore(saves, (slug) => progressSave.peek(slug));
export function readSummary(): WildshardSummary { return summaries.read(); }
export function updateSummary(slug: ShardSlug, progress: SummaryProgress, total: number): void { summaries.update(slug, progress, total); }

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedSummaryInput = BoundedSummary;
interface BoundedSummaryFields {
    v: 1;
    shards: Record<string, {
            earned: number;
            total: number | null;
            playS: number;
            at: number;
        }>;
}
type BoundedSummary = { [Key in keyof BoundedSummaryFields]: BoundedSummaryFields[Key] };
