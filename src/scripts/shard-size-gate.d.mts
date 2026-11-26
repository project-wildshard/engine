/** SHARD-SIZE row 1, judged by BUDGET-CAPS BC4: each web build judges each shard's phone download by the budget verdict. */
import type { BudgetBaselines, BudgetCaps } from './budgets/files.mjs';
import type { BudgetMeasures, BudgetRow } from './budgets/cli.mjs';

export const BASELINE_FILE: string;
export const PINS_FILE: string;
export function readPhoneDownloads(dist: string): Record<string, number> | null;
export function pinnedContentKeys(root?: string): Record<string, string>;
export function shardMeasures(downloads: Record<string, number>, contentKeys: Record<string, string>): BudgetMeasures;
export function checkShardSizes(budgets: { caps: BudgetCaps; baselines: BudgetBaselines }, downloads: Record<string, number>, options: { contentKeys: Record<string, string>; cooksAfter?: boolean; hardOnly?: boolean }): { errors: string[]; notes: string[]; rows: BudgetRow[] };
export function folderBuckets(folder: string): { totalBytes: number; files: number; buckets: Record<string, number> };
