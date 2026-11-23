/** SHARD-COMPAT SP1b3: the canary gate. Before the box's cook records sidecars for every stale shard, it records one
 * canary whose author preparation it can compare: the recorder on the box must give what the author's recorder gave
 * (the same fence, packs and program rows). The build label, renderer, inputHash and mounts are the recording's own and
 * may differ (the Dunes canary of 11-23 differed only there). A canary that differs stops the record job; nothing else
 * records until a person accepts it. */
import type {CookData} from '@wildshard/format/cookData';

/** What a canary recording held against its author preparation: `equal`, or the parts that differ. */
export type CanaryVerdict = {readonly equal: true} | {readonly equal: false; readonly differs: readonly string[]};

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const sorted = (rows: readonly string[] | undefined): readonly string[] => [...rows ?? []].sort();

/** The canary `recorded` on the box against the author's `author` preparation of the same shard. */
export function canaryVerdict(author: CookData, recorded: CookData): CanaryVerdict {
  if (author.version !== 3 || recorded.version !== 3) return {equal: false, differs: ['spec']};
  const differs = [
    ...same(author.packs, recorded.packs) ? [] : ['packs'],
    ...same(sorted(author.fence), sorted(recorded.fence)) ? [] : ['fence'],
    ...same(author.programs.lines, recorded.programs.lines) ? [] : ['program lines'],
    ...same(author.programs.shaders, recorded.programs.shaders) && same(author.programs.programs, recorded.programs.programs) ? [] : ['program rows'],
  ];
  return differs.length === 0 ? {equal: true} : {equal: false, differs};
}

/** The record job's line for its canary: `grep 'canary'` finds whether the box may record the rest. */
export function canaryLine(slug: string, verdict: CanaryVerdict): string {
  return verdict.equal ? `canary equal: ${slug}` : `canary differs: ${slug}: ${verdict.differs.join(', ')}; no other shard records until it is accepted`;
}

/** Whether the record job may record past its canary: an equal canary, or one a person accepted by its recorded hash. */
export function canaryOpens(verdict: CanaryVerdict, accepted: ReadonlySet<string>, recordedHash: string): boolean {
  return verdict.equal || accepted.has(recordedHash);
}
