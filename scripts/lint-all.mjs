#!/usr/bin/env node
// One type program per invocation, including an unpartitioned full-repository run.
import { spawnSync } from 'node:child_process';
import {lintEnvironment} from './lint-tools.mjs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { availableParallelism } from 'node:os';

const root = resolve(import.meta.dirname, '..');
// Invoke the installed CLI with this Node runtime, without starting pnpm twice.
// The package and complete file selection remain the repository's pinned ones.
const oxlint = resolve(root, 'node_modules/oxlint/bin/oxlint');
const nativeEnvironment=lintEnvironment(root);
const args = process.argv.slice(2);
const match = args.length === 1 ? /^--threads=([1-8])$/u.exec(args[0]) : null;
if (args.length > 0 && match === null) {
  console.error('lint-all: expected no arguments or --threads=1..8');
  process.exit(2);
}
const threads = Math.min(match === null ? 8 : Number(match[1]), availableParallelism());
const listed = spawnSync(process.execPath, [oxlint, '-c', '.oxlintrc.json', '--debug', 'files'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,env:nativeEnvironment });
if (listed.error !== undefined || listed.status !== 0) {
  console.error(listed.error?.message ?? listed.stderr);
  process.exit(listed.status ?? 1);
}
const files = listed.stdout.trim().split(/\r?\n/u);
if (files.length === 0 || files.some(file => !file || !existsSync(resolve(root, file)))) {
  console.error('lint-all: could not enumerate the complete oxlint file selection');
  process.exit(1);
}
console.info(`lint-all: complete typed check, ${files.length} files, ${threads} threads`);
// --threads controls Oxlint's native pool; its Go helper has a separate runtime.
// Preserve an explicit caller setting, including a smaller existing allowance.
const lintEnv = {
  ...nativeEnvironment,
  // The Mac profile shows substantial allocation/reclaim contention. Keep its
  // Go worker width at the original four-way
  // compiler baseline while Oxlint's independent native pool remains eight.
  GOMAXPROCS: process.env.GOMAXPROCS ?? String(process.platform === 'darwin' ? Math.min(4, threads) : threads),
  // The Darwin profile is dominated by reclaim/recommit churn. Keep more
  // short-lived checker storage between collections within a bounded Go budget.
  // This is below the 8 GB whole-check acceptance ceiling, not a new gate.
  ...(process.platform === 'darwin' ? {
    GOGC: process.env.GOGC ?? '200',
    GOMEMLIMIT: process.env.GOMEMLIMIT ?? '5GiB',
  } : {}),
};
const result = spawnSync(process.execPath, [oxlint, '-c', '.oxlintrc.json', '--type-aware', '--threads', String(threads), ...files], { cwd: root, stdio: 'inherit', env: lintEnv });
if (result.error !== undefined) console.error(result.error.message);
process.exitCode = result.status ?? 1;
