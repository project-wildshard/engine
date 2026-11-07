/** scripts/check-models.mjs: the model contract's static check (E306 / E315 M8). */
export function areaOf(file: string): string;
/** the files already on the model contract: rule 6 fails a hand registration in one */
export const ON_CONTRACT: readonly string[];
/** every area's declared world (rule 7): file → why, and how many of what */
export const DONE: Readonly<Record<string, Readonly<Record<string, { readonly why: string; readonly counts: Readonly<Record<string, number>> }>>>>;
/** each shard's lists of named places (M12: every named place is a set) */
export const NAMED_PLACES: Readonly<Record<string, readonly { file: string; list: string; labels?: boolean; optional?: boolean }[]>>;
/** the shards whose every named place must have its set */
export const PLACES_ENFORCED: readonly string[];
/** registry `.add({ … })` calls giving the piece an `object` (a balanced scan of each literal) */
export function addsWithObject(code: string): number;
/** registry `.add({ … })` calls with this top-level key (M6: `model` is place / listModel's alone) */
export function addsWithKey(code: string, key: string): number;
export function checkModels(files?: Readonly<Record<string, string>>): {
  violations: string[];
  report: Record<string, Record<string, number>>;
  /** per shard: its named places, how many have a set, which have none */
  places: Record<string, { named: number; sets: number; missing: string[] }>;
  /** rule 9's findings on every shard, enforced or not */
  placeProblems: string[];
};
