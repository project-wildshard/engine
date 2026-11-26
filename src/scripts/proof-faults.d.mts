import type { Page } from 'playwright';

/** The error card and the glitch chip, by the ids ErrorModal.ts gives them. */
export const ERROR_CARD: string;
/** One console line → the problem it shows (a faulted system, a stopped loop, a logged card), or null. */
export function faultProblem(line: string): string | null;
/** In the page (an init script): logs each card and chip once, when it mounts. */
export function recordCards(): void;
/** In the page: the cards on screen now, as `<kind>: <line>`. */
export function cardNow(): string[];
/** Push every page error, faulted system and card on `page` into `errors`; settle() adds a card still on screen. */
export function watchFaults(page: Page, errors: string[], who?: string): Promise<{ settle: () => Promise<void> }>;
