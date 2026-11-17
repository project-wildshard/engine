import type { Page } from 'playwright';

/** What the player sees at one sample (scripts/journey-proof.mjs `screenNow`). */
export interface Screen {
  readonly doc: number | string; readonly origin?: number; readonly path: string;
  readonly shell: boolean; readonly title: boolean; readonly select: boolean;
  readonly loading: boolean; readonly bar: boolean; readonly hud: boolean; readonly modal: boolean;
}
export interface Sample { readonly t: number; readonly s: Screen | null }
export interface Problem { readonly at: number; readonly text: string }
/** iPhone 17 Pro portrait. */
export const PHONE: {
  readonly viewport: { width: number; height: number };
  readonly deviceScaleFactor: number; readonly hasTouch: boolean; readonly userAgent: string;
};
export function screenNow(): Screen;
export function label(s: Screen | null): string;
export function judge(samples: readonly Sample[], options?: { blankMs?: number; budgetMs?: number }): Problem[];
export function tapJourney(page: Page, options: { card: string; budgetMs?: number; sampleMs?: number; frames?: (row: Sample) => Promise<void> }): Promise<Sample[]>;
export function stickMoves(page: Page): Promise<boolean>;
