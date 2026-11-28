export interface Pin { slug: string; shardVersion: string; hash: string }
export interface Recipe { cookVersion: string; cookHash: string; sameOutputFrom?: string }
export const PREFILL_COMMAND: string;
export function indexKeys(pins: readonly Pin[], recipe: Recipe): { pin: Pin; key: string }[];
export function missingCooks(pins: readonly Pin[], recipe: Recipe, status: (key: string) => Promise<number>): Promise<Pin[]>;
export function prefillRefusal(missing: readonly Pin[], recipe: Recipe, env: NodeJS.ProcessEnv): string | undefined;
export function cookPrefill(root: string, options?: { check?: boolean; scratch?: string; log?: (line: string) => void; env?: NodeJS.ProcessEnv }): Promise<{ cooked: string[] }>;
