export interface ChunkModuleReport { readonly name: string; readonly moduleIds: readonly string[]; readonly rawBytes?: number; readonly gzBytes: number; readonly imports?: readonly string[] }
export interface ManifestChunk { readonly file: string; readonly name?: string; readonly src?: string; readonly isEntry?: boolean; readonly isDynamicEntry?: boolean; readonly imports?: readonly string[]; readonly dynamicImports?: readonly string[] }
export function gridSessionBudgetErrors(modules: Readonly<Record<string, ChunkModuleReport>>, budgets: Readonly<Record<string, number>>): string[];
export function titleClosureBudgetErrors(modules: Readonly<Record<string, ChunkModuleReport>>, budgets: Readonly<Record<string, number>>): string[];
export function sessionClosureBudgetErrors(modules: Readonly<Record<string, ChunkModuleReport>>, budgets: Readonly<Record<string, number>>): string[];
export function checkChunks(manifest: Readonly<Record<string, ManifestChunk>>, modules: Readonly<Record<string, ChunkModuleReport>>, closures: Readonly<Record<string, readonly string[]>>, budgets?: Readonly<Record<string, number>>): {
  errors: string[]; table: { file: string; name: string; gzBytes: number; modules: number }[];
};
