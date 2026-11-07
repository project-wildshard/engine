// oxlint-disable-next-line import/no-nodejs-modules -- Execute the original compiler in its native Node realm.
import { execFile } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Copy only verified native cache output while holding its read lease.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- All compiler inputs remain repository-relative.
import { resolve } from 'node:path';
import { bakeInputHashes, InputHashMemo } from '../../scripts/bake-input-hashes.mjs';
import type { RecorderTask } from '../../scripts/native-recorder-cache.mjs';
import { runNativeRecorder } from '../../scripts/native-recorder-cache.mjs';

const memos = new Map<string, InputHashMemo>();
const MAX_BYTES = 1 << 26;
const LOADER = 'scripts/bake-loader.mjs';

/** Share completed construction, never a test result. The existing native cache
 * binds exact input bytes, tool/host identity and every output hash, coalesces
 * cold producers and fences source changes before publishing. Callers still
 * admit the full compiler envelope and run every original oracle themselves. */
export interface NativeProgramSpec {
  readonly id: string; readonly script: string; readonly inputs: readonly string[];
  readonly root?: string; readonly cacheDir?: string; readonly transformTypes?: boolean;
  readonly loader?: 'bake' | 'simulation';
}

/** Describe exactly the source/tool/host-fenced construction used by every loan. */
export function nativeProgramJob(spec: NativeProgramSpec): {
  root: string; memo: InputHashMemo; paths: string[]; inventory: () => string[]; job: RecorderTask;
} {
  const root = resolve(spec.root ?? '.'), memo = memos.get(root) ?? new InputHashMemo(root);
  memos.set(root, memo);
  // Data-only proof constructors need no app identity or discovery-table preload.
  // The stricter simulation loader still fences its renderer admission rules.
  const loader = spec.loader === 'simulation' ? 'scripts/sim-node-loader.mjs' : LOADER;
  const loaderInputs = spec.loader === 'simulation' ? ['lint/sim-schema-leaves.json'] : [];
  const inventory = (): string[] => [...new Set([spec.script, LOADER, loader, ...loaderInputs, ...spec.inputs.flatMap(path => memo.paths(path, true))])].sort();
  const paths = inventory(), inputs = bakeInputHashes(root, paths, memo);
  const command = [process.execPath, ...(spec.transformTypes === true ? ['--experimental-transform-types'] : []), '--import', `./${loader}`, '--', spec.script];
  return { root, memo, paths, inventory, job: {
    id: `fixture-${spec.id}`, inputs, command, outputs: ['fixture.json'], platform: 'native',
    tools: { cwd: memo.root, nodeOptions: process.env['NODE_OPTIONS'] ?? '' },
  } };
}

/** Loan only complete output after the original source and output validation. */
export async function nativeProgramFixture(spec: NativeProgramSpec): Promise<string> {
  const {root, memo, paths, inventory, job} = nativeProgramJob(spec);
  const command = job.command;
  const output = 'fixture.json';
  const result = await runNativeRecorder(root, job, {
    inputHashes: memo, ...(spec.cacheDir === undefined ? {} : { cacheDir: spec.cacheDir }),
    generate: async directory => {
      const text = await new Promise<string>((done, fail) => {
        execFile(process.execPath, command.slice(1), { cwd: root, encoding: 'utf8', maxBuffer: MAX_BYTES }, (error, stdout) => {
          if (error !== null) fail(error);
          else done(stdout);
        });
      });
      const value: unknown = JSON.parse(text);
      if (value === null || typeof value !== 'object') throw new Error('Missing native compiler envelope');
      if (JSON.stringify(inventory()) !== JSON.stringify(paths)) throw new Error('Native compiler input inventory changed');
      writeFileSync(resolve(directory, output), text);
    },
  });
  try {
    const file = resolve(result.directory, output);
    if (statSync(file).size > MAX_BYTES) throw new Error('Native compiler envelope exceeds limit');
    return readFileSync(file, 'utf8');
  } finally { result.release(); }
}
