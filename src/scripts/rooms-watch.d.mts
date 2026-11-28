export interface WatchState { fails: Record<string, number>; downSince: Record<string, number>; outages: string[]; sentry?: string }
export interface OutageIssue { id: string; shortId: string; title: string; status?: string }
export interface WatchRead { rooms: { url: string; status: number }[]; outages?: OutageIssue[]; sentry?: string }
export const ROOMS: readonly string[];
export const DOWN_AFTER: number;
export const SENTRY_OK: string;
export function emptyState(): WatchState;
export function step(state: WatchState, read: WatchRead, now: number): { state: WatchState; lines: string[] };
export function readOutages(token: string | undefined, options?: { query?: string; period?: string; fetcher?: typeof fetch }): Promise<{ outages?: OutageIssue[]; sentry: string }>;
export function watchPlist(root: string, home: string): string;
export function main(args: string[]): Promise<void>;
