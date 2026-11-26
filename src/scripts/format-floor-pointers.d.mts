export const FLOOR_API: string;
export const CHANNELS: readonly ['production', 'staging', 'preview'];
export interface Pointer { channel: string; slug: string; hash: string; revision?: number }
export interface BelowFloor extends Pointer { format: string }
export function compareFormat(left: string, right: string): number;
export function declaredFormat(index: unknown): string;
export function channelPointers(catalogue: unknown, shardfiles: unknown): Pointer[];
export function pointersBelowFloor(pointers: readonly Pointer[], floor: string, formatOf: (hash: string) => Promise<string>): Promise<BelowFloor[]>;
export function belowLines(below: readonly BelowFloor[]): string[];
export const FORMAT_CACHE: string;
export function originalFormat(options: {
  api?: string;
  read?: typeof fetch;
  cache?: string;
  readTar: (bytes: Uint8Array) => ReadonlyMap<string, Uint8Array>;
}): (hash: string) => Promise<string>;
export function installedFormat(root: string, pin: string | undefined): Promise<{
  version: string;
  floor: string;
  readTar: (bytes: Uint8Array) => ReadonlyMap<string, Uint8Array>;
}>;
export function floorPointers(pin: string | undefined, options?: { root?: string; api?: string; read?: typeof fetch }): Promise<{
  floor: string;
  pointers: number;
  below: BelowFloor[];
}>;
