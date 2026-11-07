export interface SizeReading { readonly flow: string; readonly title: number; readonly entry: number; readonly book: number | undefined; readonly stoppedOn: string | null }
interface BookRow { readonly wireBytes?: number }
export const TITLE_LIMIT_BYTES: number;
export const BOOK_SLACK: number;
export const WATCHED: readonly string[];
export function bookBytes(book: { client: Record<string, Record<string, BookRow>>; grid: Record<string, Record<string, Record<string, BookRow>>> }, shard: string, tier: string, home?: string): number | undefined;
export function sizeFindings(readings: readonly SizeReading[]): string[];
