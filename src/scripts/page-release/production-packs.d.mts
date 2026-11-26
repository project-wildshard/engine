export const PRODUCTION_CATALOGUE: string;
export const PACK_WAIT_MS: number;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export function missingPacks(build: string, channel: 'production' | 'staging', read?: Fetch): Promise<string[]>;
export function missingProductionPacks(build: string, read?: Fetch): Promise<string[]>;
export function waitForPacks(build: string, channel: 'production' | 'staging', opts: { log: (line: string) => void; read?: Fetch; sleep?: (ms: number) => Promise<void>; now?: () => number; limitMs?: number; everyMs?: number }): Promise<void>;
