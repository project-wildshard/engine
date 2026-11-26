#!/usr/bin/env node
// C4 (J28): one cook, in a child of the cook worker: `cook-job <shardfile.tar> <out>`. The worker starts it under its
// limits with no credentials; this file only composes the job with the SDK's simulation proof (F3 (b)), which sits above
// the game layer. Exit 3 is a refusal, and its reason is the last line of stdout.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

const { runCookJob, ShardfileRefusedError } = await import('../cook/game/cookJob.ts');
const { servedAsIs } = await import('../cook/game/shardCook.ts');
const { readSidecarTar } = await import('../cook/game/cookSidecar.ts');
const { checkShardfile } = await import('../server/host/checkShardfile.ts');
const [tarball, out, expectedSlug] = process.argv.slice(2);
if (tarball === undefined || out === undefined) throw new Error('usage: cook-job <shardfile.tar> <out>');
try {
  const report = await runCookJob(readFileSync(tarball), resolve(out), {
    ...(expectedSlug === undefined ? {} : {expectedSlug}),
    // SHARD-COMPAT CP10: the API judged this file at upload; the cook only measures what runs on its build.
    check: (shard, assets, sections) => checkShardfile(shard, assets, {sections, judged: 'stored'}),
    now: () => performance.now(),
    onPhase: (phase, elapsedMs) => { console.log(`phase ${phase} ${elapsedMs}ms`); },
    ...(process.env.COOK_MAX_SHARDFILE_BYTES === undefined ? {} : { maxBytes: Number(process.env.COOK_MAX_SHARDFILE_BYTES) }),
    // The host brotli's a loose file itself; q5 is near enough for the report and costs no cache.
    wireBytes: (url, bytes) => servedAsIs(url, bytes) ? bytes.length : brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length,
    warn: line => { console.warn(`warning: ${line}`); },
    // J262: the worker computed its renderer fingerprint; this child may not run git.
    ...(process.env.COOK_RENDERER === undefined || process.env.COOK_RENDERER === '' ? {} : { renderer: process.env.COOK_RENDERER }),
    // FORMAT-PRUNE FP27c: the catalogue's armed word, from the upload feed.
    ...(process.env.COOK_ARMED === 'true' || process.env.COOK_ARMED === 'false' ? { armed: process.env.COOK_ARMED === 'true' } : {}),
    // SHARD-COMPAT SP1b4: the worker's cook preparation sidecar for this shard on its renderer, when it holds one.
    ...(process.env.COOK_SIDECAR === undefined || process.env.COOK_SIDECAR === '' ? {} : { sidecar: readSidecarTar(readFileSync(process.env.COOK_SIDECAR)) }),
  });
  // Reports are not constrained by the bounded diagnostic stdout ring.
  writeFileSync(`${resolve(out)}.result.json`, JSON.stringify(report));
  console.log(JSON.stringify({ok: true}));
  process.exit(0);
} catch (error) {
  if (!(error instanceof ShardfileRefusedError)) throw error;
  writeFileSync(`${resolve(out)}.result.json`, JSON.stringify({refused: error.message, ...(error.report === undefined ? {} : {check: error.report})}));
  console.log(JSON.stringify({refused: true}));
  process.exit(3);
}
