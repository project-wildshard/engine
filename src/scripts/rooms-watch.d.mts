export interface WatchState { fails: Record<string, number>; downSince: Record<string, number>; outages: string[] }
export interface WatchRead { rooms: { url: string; status: number }[]; outages?: { id: string; shortId: string; title: string }[] }
export const ROOMS: readonly string[];
export const DOWN_AFTER: number;
export function emptyState(): WatchState;
export function step(state: WatchState, read: WatchRead, now: number): { state: WatchState; lines: string[] };
export function watchPlist(root: string, home: string): string;
export function main(args: string[]): Promise<void>;
