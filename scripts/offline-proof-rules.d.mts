export interface RequestRow {
  n: number; t: number; url: string; type: string; origin: 'page' | 'sw'; phase: string; step: string;
  servedBy: 'service-worker' | 'network' | 'failed' | 'pending'; status: number; fail: string;
}
export interface ScreenSample { t: number; phase: string; step: string; card: boolean; title: boolean; player: boolean; failCard: string; text: string; inside?: string | null }
export interface Failure { shard: string; rule: string; url?: string; detail?: string }
export type Outcome = 'play' | 'seat-wait' | 'title' | 'stalled' | 'error' | 'no-resume' | 'outside-world';
export const DECK_SHARDS: readonly { slug: string; card: string }[];
export const OPEN_PLOTS: readonly string[];
export const ALL_SHARDS: readonly string[];
export function gridPlaces(slug: string, catalogue: { grid?: { cells?: readonly { slug?: unknown }[] } }): boolean;
export function screenKey(screen: { phase: string; step: string; error: string; failCard: string; title: boolean; player: boolean; progress: string }): string;
export const SOLO_ONLY: RegExp;
export const CLIENT_MANIFEST: RegExp;
export const GRID_LAYOUT: RegExp;
export const RAW_STRINGS: readonly string[];
export const CRITICAL_PHASES: readonly string[];
export function mayFail(url: string): boolean;
export function pathOf(url: string): string;
export function textureForm(path: string): { name: string; form: 'img' | 'ktx2' } | undefined;
export function judge(run: {
  shard: string; channel: 'staging' | 'preview'; mode: string; entry: string; rows: readonly RequestRow[];
  samples: readonly ScreenSample[]; outcome: Outcome; warm?: ReadonlySet<string>; layout?: boolean; walkthrough?: boolean;
  requireWorld?: boolean; proofError?: string; leaks?: number; placed?: boolean; linked?: boolean;
}): Failure[];
export function servedCounts(rows: readonly RequestRow[]): Record<string, number>;
