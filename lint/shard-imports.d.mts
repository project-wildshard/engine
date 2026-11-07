/** Package-boundary predicates shared by author lint and source regressions. */
export function shardGameImport(filename: string, source: string | undefined): boolean;
export function gamePluginImportViolation(filename: string, source: string | undefined, exports: Readonly<Record<string, unknown>>): string | null;
export function shardEngineImport(filename: string, source: string | undefined): boolean;
export function generatorImportViolation(filename: string, source: string | undefined): string | null;
