// Meta QA 11-25 row 64: the types of pin-packs.mjs.
type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;
export function headPackGaps(hash: string, builds: readonly string[], origin: string, read?: Fetch): Promise<string[]>;
export function servedBuilds(channel: 'staging' | 'prod', read?: Fetch): Promise<string[]>;
export function waitForHeadPacks(options: {
  slug: string; hash: string; channel: 'staging' | 'prod'; log: (line: string) => void; read?: Fetch;
  builds?: () => Promise<string[]>; sleep?: (ms: number) => Promise<void>; now?: () => number; limitMs?: number; everyMs?: number;
}): Promise<void>;
