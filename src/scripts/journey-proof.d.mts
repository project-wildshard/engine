import type { Page } from 'playwright';

/** What the player sees at one sample (src/scripts/journey-proof.mjs `screenNow`). */
export interface Screen {
  readonly doc: number | string; readonly origin?: number; readonly path: string;
  readonly shell: boolean; readonly title: boolean; readonly select: boolean;
  readonly loading: boolean; readonly bar: boolean; readonly hud: boolean; readonly modal: boolean;
  /** J399: the loading card shows its START, DOWNLOAD and LOAD tracks, and the zone it names */
  readonly detailed?: boolean; readonly zone?: string; readonly reveal?: boolean; readonly errorCard?: boolean;
}
/** MAIN-SCREEN MS5: ZONE SELECT and a card, ENTER THE MMO, or the one-zone deep link already open */
export type JourneyPath = 'select' | 'mmo' | 'deeplink';
export interface Sample { readonly t: number; readonly s: Screen | null }
export interface Problem { readonly at: number; readonly text: string }
/** iPhone 17 Pro portrait. */
export const PHONE: {
  readonly viewport: { width: number; height: number };
  readonly deviceScaleFactor: number; readonly hasTouch: boolean; readonly userAgent: string;
};
/** Runs in the page: requestAnimationFrame capped at 60 fps. */
export function capFrames(): void;
export function screenNow(): Screen;
export function readOnlyPhoneLoad(base: string, build: string): Promise<void>;
export function label(s: Screen | null): string;
export function judge(samples: readonly Sample[], options?: { blankMs?: number; budgetMs?: number }): Problem[];
export function judgeDeploy(samples: readonly Sample[], budgetMs?: number): Problem[];
export function deployFrameProblem(page: Pick<Page, 'waitForTimeout' | 'screenshot'>): Promise<string | null>;
/** SS-JP1: the index of `card`'s Shard Select card among the cards' names (title row, else the slug, else its words), or -1. */
export function titleCardIndex(rows: unknown, names: readonly string[], card: string): number;
export function tapJourney(page: Page, options: { card: string; path?: JourneyPath; budgetMs?: number; sampleMs?: number; frames?: (row: Sample) => Promise<void> }): Promise<Sample[]>;
export function acceptPhoneMemoryWarning(page: Page): Promise<void>;
export function stickMoves(page: Page): Promise<boolean>;
/** SB44: null when the stick moved the player, else why not (the page left play during the check included) */
export function stickProblem(page: Page): Promise<string | null>;
