/** SENTRY-ZERO SZ7: the weekly list of Sentry issues over the low-frequency line. */
export const SENTRY_API: string;
export const DEFAULT_DAYS: number;
export const DEFAULT_PER_DAY: number;
export interface Issue { shortId?: string; title?: string; count?: string | number; occurrences?: number }
export function overLine(issues: readonly Issue[], line: { days: number; perDay: number }):
  { id: string; title: string; events: number; perDay: number }[];
export function table(rows: ReturnType<typeof overLine>, line: { days: number; perDay: number }): string;
