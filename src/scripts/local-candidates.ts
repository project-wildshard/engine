/** LL4: local provenance is never an input to hosted CI or to the tracked pin book. */
import {existsSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
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

/** Publication checks the operator's tree before a clean gate copy can hide its local state. */
export function assertNoLocalCandidates(root: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!existsSync(join(root, LOCAL_CANDIDATES))) return;
  const {CI: continuousIntegration} = env;
  // Hosted checks never read the local file's contents, even if one was planted there.
  const names = continuousIntegration === 'true' || continuousIntegration === '1'
    ? 'local provenance in CI' : localCandidates(root, env).map(row => row.slug).join(', ') || 'empty local provenance';
  throw new Error(`Local shard installed: ${names}; clear with node src/scripts/pins.ts install`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  assertNoLocalCandidates(process.cwd());
}
