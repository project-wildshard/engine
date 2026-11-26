/** Maximum decimal-byte payload per SF64 infographic brick. */
export const MEMORY_BLOCK_BYTES: 50000000;
export interface MemoryAllocation {
  readonly id: string;
  readonly domain: 'ram' | 'gpu';
  readonly bytes: number;
  readonly owner: string;
  readonly asset: string;
  readonly kind: string;
  readonly precision: 'exact' | 'estimate';
}
export interface MemoryOwnerSubtotal {
  owner: string;
  domain: 'ram' | 'gpu';
  bytes: number;
  exactBytes: number;
  estimatedBytes: number;
  allocations: number;
}
/** Agreeing shared identities count once; disagreement refuses instead of inventing ownership. */
export function memoryOwnerInventory(allocations: readonly MemoryAllocation[]): MemoryOwnerSubtotal[];
/** Preserve every byte and owner while splitting each subtotal into <=50 MB bricks. */
export function memoryBlocks(owners: readonly Pick<MemoryOwnerSubtotal, 'owner' | 'domain' | 'bytes'>[]): {
  owner: string;
  domain: 'ram' | 'gpu';
  bytes: number;
  part: number;
}[];
