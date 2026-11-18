/** One Zone select card as the player sees it (scripts/zone-sweep.mjs `cardsNow`). */
export interface SweepCard { readonly i: number; readonly name: string; readonly sub: string; readonly enters: boolean; readonly thumb: string }
/** The pass rule: in the world within the budget, no error card or fault, nothing thrown by the driver. */
export function zoneVerdict(row: { readonly enterMs: number | null; readonly errors: readonly string[]; readonly modal: boolean; readonly thrown: string; readonly name?: string; readonly zones?: readonly string[] }, budgetMs: number): boolean;
/** The zone the loading card named when it is not the card tapped, else undefined. */
export function wrongZone(row: { readonly name?: string; readonly zones?: readonly string[] }): string | undefined;
export function cardsNow(): SweepCard[];
export function slugsByName(): Record<string, string>;
/** The cold `?chunk=<slug>&skipintro=1` link (--chunk). */
export function chunkLink(url: string, slug: string): string;
/** The cards to open and the --only slugs that have no card. */
export function sweepTargets(cards: readonly { readonly name: string }[], slugs: Readonly<Record<string, string>>, only: readonly string[] | undefined): { targets: { slug: string; name: string }[]; missing: string[] };
