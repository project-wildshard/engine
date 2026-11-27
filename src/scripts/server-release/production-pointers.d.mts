export const API: string;
export const RELEASES: string;
export interface ReleaseEntry { slug: string; revision?: number; hash?: string }
export interface PointerMove { slug: string; from: number | undefined; to: number; hash: string }
export interface PointerDeps { fetch?: typeof fetch; api?: string; releases?: string; token?: string; log?: (line: string) => void }
export function releaseEntries(signed: unknown): ReleaseEntry[];
export function pointerMoves(
  entries: readonly ReleaseEntry[],
  listed: readonly { hash: string; revisions: readonly { shard: string; revision: number }[] }[],
  catalogue: readonly { slug: string; live?: { revision: number; hash: string } }[],
): PointerMove[];
export function readMoves(deps?: PointerDeps): Promise<PointerMove[]>;
export function alignProductionPointers(deps?: PointerDeps): Promise<PointerMove[]>;
