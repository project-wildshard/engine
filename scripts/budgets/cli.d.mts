/** BUDGET-CAPS BC3: check, record and declare. */
import type { BudgetBaselines, BudgetCaps } from './files.mjs';
import type { BudgetStatus } from './verdict.mjs';

export interface BudgetMeasure { value?: number; reads?: readonly number[]; contentKey: string; detail?: Record<string, number> }
export interface BudgetMeasures { commit?: string; measures: Record<string, BudgetMeasure> }
export interface BudgetRow { key: string; status: BudgetStatus | 'unknown'; value: number | null; baseline: number | null; line: number | null; hard: number | null; target: number | null; ratio: number | null; unit: string; contentKey: string; previousKey?: string | null; detail?: Record<string, number> }
export function judgeAll(caps: BudgetCaps, baselines: BudgetBaselines, measures: BudgetMeasures): BudgetRow[];
export function budgetTable(rows: readonly BudgetRow[]): string;
export function failed(rows: readonly BudgetRow[], options?: { hardOnly?: boolean }): boolean;
export function recordAll(caps: BudgetCaps, baselines: BudgetBaselines, measures: BudgetMeasures, options?: { why?: string; commit?: string }): { errors: string[]; baselines: BudgetBaselines };
export function declareRaise(caps: BudgetCaps, baselines: BudgetBaselines, key: string, why: string | undefined): { errors: string[]; baselines: BudgetBaselines; note?: string };
export function downloadRun(run: string, directory: string): void;
export function runCli(argv: string[], io?: { root?: string; env?: NodeJS.ProcessEnv; out?: (line: string) => void; err?: (line: string) => void; download?: (run: string, directory: string) => void }): number;
export function mergeMeasures(files: readonly BudgetMeasures[]): BudgetMeasures;
