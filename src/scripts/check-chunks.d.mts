import type { BudgetBaselines, BudgetCaps } from './budgets/files.mjs';
import type { BudgetMeasures } from './budgets/cli.mjs';

export interface ChunkModuleReport { readonly name: string; readonly moduleIds: readonly string[]; readonly rawBytes?: number; readonly gzBytes: number; readonly imports?: readonly string[] }
export interface ManifestChunk { readonly file: string; readonly name?: string; readonly src?: string; readonly isEntry?: boolean; readonly isDynamicEntry?: boolean; readonly imports?: readonly string[]; readonly dynamicImports?: readonly string[] }

/** BUDGET-CAPS BC5: the two budget files, and whether only the hard caps fail. */
export interface ChunkBudgets { readonly caps: BudgetCaps; readonly baselines: BudgetBaselines; readonly hardOnly?: boolean }
type Measure = (unit: 'raw' | 'gzip', bytes: number, line: number | null) => void;
export function chunkBudgets(options?: { hardOnly?: boolean }): ChunkBudgets;
export function codeMeasures(modules: Readonly<Record<string, ChunkModuleReport>>, budgets: ChunkBudgets): BudgetMeasures;
export function gridSessionBudgetErrors(modules: Readonly<Record<string, ChunkModuleReport>>, budgets: ChunkBudgets, measure?: Measure): string[];
export function titleClosureBudgetErrors(modules: Readonly<Record<string, ChunkModuleReport>>, budgets: ChunkBudgets, measure?: Measure): string[];
export function sessionClosureBudgetErrors(
  modules: Readonly<Record<string, ChunkModuleReport>>,
  budgets: ChunkBudgets,
  measure?: Measure,
): string[];
export function checkChunks(manifest: Readonly<Record<string, ManifestChunk>>, modules: Readonly<Record<string, ChunkModuleReport>>, closures: Readonly<Record<string, readonly string[]>>, budgets: ChunkBudgets): {
  errors: string[]; table: { file: string; name: string; gzBytes: number; modules: number }[];
};
