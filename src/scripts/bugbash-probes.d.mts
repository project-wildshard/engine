import type { Page } from 'playwright';

/** One Shard Select card in one frame (src/scripts/bugbash-probes.mjs `recordDeck`). */
export interface DeckCard { readonly i: number; readonly left: number; readonly right: number; readonly opacity: number }
/** One frame of Shard Select: how many cards are lit, and every card on screen. */
export interface DeckFrame { readonly t: number; readonly lit: number; readonly cards: readonly DeckCard[] }
export function recordDeck(count: number): void;
export function deckFrames(): DeckFrame[];
export function mountMark(mark: { css: string; words: string }): void;
export function markCovers(): string[];
export function touchSwipe(page: Page, y: number): Promise<number>;
export function swipeProblems(frames: readonly DeckFrame[], released: number): string[];
export function markSource(root: string): { css: string; words: string };
