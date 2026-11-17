/** LL4: local provenance is never an input to hosted CI or to the tracked pin book. */
import {existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import * as v from 'valibot';
import {insideTree} from './pins-reuse.mjs';

export const LOCAL_CANDIDATES = 'out/.local-candidates.json';
const candidate = v.object({slug: v.string(), path: v.string(), indexHash: v.string()});
export type LocalCandidate = v.InferOutput<typeof candidate>;

export function localCandidates(root: string, env: NodeJS.ProcessEnv = process.env): LocalCandidate[] {
  const {CI: continuousIntegration} = env;
  if (continuousIntegration === 'true' || continuousIntegration === '1') return [];
  const file = join(root, LOCAL_CANDIDATES);
  if (!existsSync(file)) return [];
  insideTree(root, LOCAL_CANDIDATES);
  return v.parse(v.array(candidate), JSON.parse(readFileSync(file, 'utf8')));
}

export function recordLocalCandidate(root: string, value: LocalCandidate): void {
  const rows = localCandidates(root).filter(row => row.slug !== value.slug);
  insideTree(root, LOCAL_CANDIDATES);
  writeFileSync(join(root, LOCAL_CANDIDATES), `${JSON.stringify([...rows, value], null, 2)}\n`);
}

/** Called only after a complete successful pinned install. */
export function clearLocalCandidates(root: string): void {
  insideTree(root, LOCAL_CANDIDATES);
  rmSync(join(root, LOCAL_CANDIDATES), {force: true});
}
