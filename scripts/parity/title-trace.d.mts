import type { Page } from 'playwright';

export interface TitleTracePort {
  start: (page: Page, options: { categories: string[]; screenshots: false }) => Promise<void>;
  stop: () => Promise<Uint8Array>;
}
export type OpenTitleTrace = (page: Page) => TitleTracePort | null;
export type TitleTraceWriter = (path: string, bytes: string | Uint8Array) => void;
export const TITLE_TRACE_MAX_RAW_BYTES: number;
export const TITLE_TRACE_MAX_COMPRESSED_BYTES: number;
export const TITLE_TRACE_CATEGORIES: readonly string[];
/** Retain a bounded native Chromium trace around one existing title capture, without changing its verdict. */
export function observeTitleCapture<T>(page: Page, prefix: string, capture: () => Promise<T>, open?: OpenTitleTrace, write?: TitleTraceWriter): Promise<T>;
