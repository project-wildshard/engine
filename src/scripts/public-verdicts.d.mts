/** STANDALONE-SHARDFILES SF1: every file under public/ is engine, delete or a zone's. */
export interface Verdict { path: string; bytes: number; verdict: 'engine' | 'delete' | 'zone' | 'unlisted'; zones: string[]; source: string }
export function isArt(path: string): boolean;
export function setId(path: string): string | undefined;
export function verdicts(input: {
  files: readonly {path: string; bytes: number}[];
  tracked: ReadonlySet<string>;
  published: ReadonlyMap<string, string>;
  fetched: ReadonlyMap<string, string>;
  named: ReadonlyMap<string, ReadonlySet<string>>;
  slugs: readonly string[];
  engine: ReadonlySet<string>;
  remove: ReadonlySet<string>;
}): Verdict[];
export function totals(rows: readonly Verdict[]): Record<'engine' | 'zone' | 'delete' | 'unlisted', {files: number; mb: number}>;
export function readList(file: string): Set<string>;
export function publicVerdicts(root: string): Verdict[];
