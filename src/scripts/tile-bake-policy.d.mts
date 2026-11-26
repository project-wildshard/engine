export const TILE_BAKE_POLICY: string;
export interface TileBakePolicy { version: 1; products: Record<string, Record<string, number>> }
export function parseTileBakePolicy(input: unknown): TileBakePolicy;
export function tileBakeApprovalFailures(before: unknown, after: unknown, message: string): string[];
