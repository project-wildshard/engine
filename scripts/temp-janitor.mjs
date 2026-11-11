#!/usr/bin/env node
// What a killed run leaves behind. Every scratch owner already cleans up in a `finally`, on `exit` or in `addCleanup`, and
// SIGKILL or a lane timeout skips all of them, so a later run clears the remains (project/disk-audit-2026-10-15.md).
// scripts/vitest-tmp.ts starts this detached. `--dry-run` reports and removes nothing. The generic sweeps (dead runs'
// tmp/vitest/<pid>, idle Vitest folders in the system temp dir, the compile cache) are repo-kit's, in scripts/vite-tmp.mjs;
// engine's own test scratch is swept here.
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { age, pruneCompileCache, sweepSystemTemp, sweepVitestRuns } from './vite-tmp.mjs';

export { age, pruneCompileCache, sweepSystemTemp, sweepVitestRuns } from './vite-tmp.mjs';

const HOUR = 3_600_000;
/** tmp/ children only a test or check makes (`mkdtemp`), so nothing resumes one. Lane folders are not listed on purpose. */
const SCRATCH = /^(?:author-module|browser-admission-test|headless-reader|nalati-chapter-one|nalati-place-blob|nine-declaration(?:-cache)?|nine-program-fixture|nine-source-output|push-config|push-loop-test|push-tools|ratchet-paths|sim-readiness-test|sim-transport-test|sunscar-program-fixture)-[A-Za-z0-9_]{6,8}$/u;

/** Test scratch older than a day; a real run lives for minutes.
 * @param {string} root @param {{now?:number,dryRun?:boolean}} [options] */
export function sweepTestScratch(root, { now = Date.now(), dryRun = false } = {}) {
  const parent = join(root, 'tmp');
  /** @type {import('node:fs').Dirent[]} */
  let rows = [];
  try { rows = readdirSync(parent, { withFileTypes: true }); } catch { /* No tmp/ yet. */ }
  return rows.filter(row => {
    if (!row.isDirectory() || !SCRATCH.test(row.name)) return false;
    const path = join(parent, row.name);
    if (age(path, now) <= 24 * HOUR) return false;
    if (dryRun) return true;
    try { rmSync(path, { recursive: true, force: true }); return true; } catch { return false; }
  }).length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '..'), dryRun = process.argv.includes('--dry-run'), cache = process.env.NODE_COMPILE_CACHE;
  console.info(JSON.stringify({ dryRun, vitestRuns: sweepVitestRuns(root, { dryRun }), testScratch: sweepTestScratch(root, { dryRun }),
    systemTemp: sweepSystemTemp(process.env.WS_SYSTEM_TMPDIR ?? tmpdir(), { dryRun }),
    compileCache: cache === undefined ? null : pruneCompileCache(cache, { dryRun }) }));
}
