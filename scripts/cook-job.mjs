#!/usr/bin/env node
// C4 (J28): one cook, in a child of the cook worker: `cook-job <shardfile.tar> <out>`. The worker starts it under its
// limits with no credentials; this file only composes the job with the SDK's simulation proof (F3 (b)), which sits above
// the game layer. Exit 3 is a refusal, and its reason is the last line of stdout.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

const { runCookJob, ShardfileRefusedError } = await import('../src/cook/game/cookJob.ts');
const { servedAsIs } = await import('../src/cook/game/shardCook.ts');
const { validateSimulation } = await import('../src/server/host/headless.ts');
const [tarball, out, expectedSlug] = process.argv.slice(2);
if (tarball === undefined || out === undefined) throw new Error('usage: cook-job <shardfile.tar> <out>');
try {
  const report = await runCookJob(readFileSync(tarball), resolve(out), {
    ...(expectedSlug === undefined ? {} : {expectedSlug}),
    prove: (shard, assets, sections) => validateSimulation(shard, assets, sections),
    now: () => performance.now(),
    ...(process.env.COOK_MAX_SHARDFILE_BYTES === undefined ? {} : { maxBytes: Number(process.env.COOK_MAX_SHARDFILE_BYTES) }),
    // The host brotli's a loose file itself; q5 is near enough for the report and costs no cache.
    wireBytes: (url, bytes) => servedAsIs(url, bytes) ? bytes.length : brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length,
    warn: line => { console.warn(`warning: ${line}`); },
    // J262: the worker computed its renderer fingerprint; this child may not run git.
    ...(process.env.COOK_RENDERER === undefined || process.env.COOK_RENDERER === '' ? {} : { renderer: process.env.COOK_RENDERER }),
  });
  console.log(JSON.stringify(report));
  process.exit(0);
} catch (error) {
  if (!(error instanceof ShardfileRefusedError)) throw error;
  console.log(JSON.stringify({ refused: error.message.slice(0, 500) }));
  process.exit(3);
}
