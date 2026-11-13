export interface SideParityRow { readonly owner: string | null; readonly material: string | null; readonly sensor: boolean; readonly dynamic: boolean; readonly box: readonly number[]; readonly shape: number }
export const SIDE_PARITY_SHARDS: readonly string[];
export function colliderInventory(physics: unknown): SideParityRow[];
export function ownerGroup(owner: string | null): string;
export function groupInventory(rows: readonly SideParityRow[]): Map<string, { count: number; materials: Set<string>; box: number[] }>;
export const PAGE_DISC: number;
export const MEASURED_SHAPES: readonly number[];
export function sideParityDiff(page: readonly SideParityRow[], server: readonly SideParityRow[], at: readonly number[] | null, allow?: Readonly<Record<string, string>>, options?: { readonly slack?: number; readonly same?: Readonly<Record<string, string>>; readonly sameMaterial?: Readonly<Record<string, { readonly server: string; readonly page: string }>>; readonly chunked?: readonly string[] }): string[];
export function chunkCopyKey(row: SideParityRow): string;
