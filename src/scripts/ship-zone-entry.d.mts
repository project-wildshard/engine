export function tableZones(input: unknown): {origin: string; zones: string[]};
export function zoneArtFromPage(path: string, known: {engine: ReadonlySet<string>; zones: readonly string[]}): boolean;
export function tierReads(reads: readonly {url: string; status: number}[], where: {page: string; cook: string; zone: string; engine: ReadonlySet<string>; zones: readonly string[]}): {
  requests: number; fromCook: number; zoneFromCook: number; fromPage: number; zoneFromPage: string[]; missing: string[];
};
export function tierFailure(verdict: {gameplayMs: number | null; zoneFromCook: number; zoneFromPage: readonly string[]; placed?: boolean}): string | undefined;
