export const PAGE_DOCUMENTS: readonly string[];
export interface Answer { status: number; cors: string | null; text: () => Promise<string>; drop: () => Promise<void> }
export interface ReachInput {
  origin: string;
  readPage: (path: string) => Promise<string>;
  get: (url: string, origin: string) => Promise<Answer>;
  stagingBase?: string;
  width?: number;
  sleep?: (ms: number) => Promise<void>;
}
export interface Reach {
  build: string; base: string; named: number; indexed: number; misses: string[]; gaps: string[]; differ: string[]; unstaged: number;
  staging?: string;
}
export function namedPaths(text: string): Set<string>;
export function pageScripts(html: string, build: string): string[];
export function buildOf(html: string): string | undefined;
export function baseOf(html: string): string | undefined;
export function contentReach(input: ReachInput): Promise<Reach>;
export function reachProblems(reach: Reach): string[];
export function reachSummary(reach: Reach): string;
export function fetchAnswer(fetcher: typeof fetch): ReachInput['get'];
export function pageReader(options: { origin: string; page?: string; fetcher: typeof fetch }): ReachInput['readPage'];
