#!/usr/bin/env node
// Ring 1: cook its three products with this commit's cook, each as the worker would: the tarball, the format's validator, the
// simulation proof, then the parts. Run `pins.ts install --ring 1` first.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const CACHE = process.env.WILDSHARD_PIN_CACHE ?? resolve(homedir(), '.cache/wildshard/pins');
const { products } = JSON.parse(readFileSync('test/pins/rings.json', 'utf8'))['1'];
/** @type {{ shards: readonly { slug: string, hash: string }[] }} */
const { shards } = JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8'));
const out = 'tmp/ring-cook';
rmSync(out, { recursive: true, force: true });
for (const slug of products) {
  const pin = shards.find((row) => row.slug === slug);
  if (pin === undefined) throw new Error(`Not pinned: ${slug}`);
  const target = join(out, slug), started = performance.now();
  mkdirSync(target, { recursive: true });
  const stdout = execFileSync(process.execPath, ['--experimental-transform-types', '--no-warnings', '--import', './scripts/bake-loader.mjs', 'scripts/cook-job.mjs', join(CACHE, `${pin.hash}.tar`), target], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const report = JSON.parse(stdout.trim().split('\n').at(-1) ?? 'null');
  console.log(`${slug}: proof ${JSON.stringify(report.proof)}, ${report.server.files} server files, ${((performance.now() - started) / 1000).toFixed(1)}s`);
}
