#!/usr/bin/env node
// What a killed run leaves behind. Every scratch owner already cleans up in a `finally`, on `exit` or in `addCleanup`, and
// SIGKILL or a lane timeout skips all of them, so a later run clears the remains (project/disk-audit-2026-10-15.md).
// scripts/vitest-tmp.ts starts this detached. `--dry-run` reports and removes nothing.
import { lstatSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const HOUR = 3_600_000, GIB = 1024 ** 3;
/** tmp/ children only a test or check makes (`mkdtemp`), so nothing resumes one. Lane folders are not listed on purpose. */
const SCRATCH = /^(?:author-module|browser-admission-test|headless-reader|nalati-chapter-one|nalati-place-blob|nine-declaration(?:-cache)?|nine-program-fixture|nine-source-output|push-config|push-loop-test|push-tools|ratchet-paths|sim-readiness-test|sim-transport-test|sunscar-program-fixture)-[A-Za-z0-9_]{6,8}$/u;

/** @param {string} path @returns {import('node:fs').Dirent[]} */
function entries(path) {
  try { return readdirSync(path, { withFileTypes: true }); } catch { return []; }
}
/** A live lane's own cleanup can remove a folder mid-sweep; a folder that is gone counts as new.
 * @param {string} path @param {number} now */
export function age(path, now) {
  try { return now - lstatSync(path).mtimeMs; } catch { return 0; }
}
/** @param {number} pid */
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error instanceof Error && 'code' in error && error.code === 'EPERM'; }
}
/** @param {string} path @param {boolean} dryRun */
function remove(path, dryRun) {
  if (dryRun) return true;
  try { rmSync(path, { recursive: true, force: true }); return true; } catch { return false; }
}

/** tmp/vitest/<pid> of a dead process, idle for an hour. A reused pid only delays the sweep.
 * @param {string} root @param {{now?:number,dryRun?:boolean}} [options] */
export function sweepVitestRuns(root, { now = Date.now(), dryRun = false } = {}) {
  const parent = join(root, 'tmp/vitest');
  return entries(parent).filter(row => {
    if (!row.isDirectory() || !/^[1-9][0-9]*$/u.test(row.name) || alive(Number(row.name))) return false;
    const path = join(parent, row.name);
    return age(path, now) > HOUR && remove(path, dryRun);
  }).length;
}

/** Test scratch older than a day; a real run lives for minutes.
 * @param {string} root @param {{now?:number,dryRun?:boolean}} [options] */
export function sweepTestScratch(root, { now = Date.now(), dryRun = false } = {}) {
  const parent = join(root, 'tmp');
  return entries(parent).filter(row => {
    if (!row.isDirectory() || !SCRATCH.test(row.name)) return false;
    const path = join(parent, row.name);
    return age(path, now) > 24 * HOUR && remove(path, dryRun);
  }).length;
}

/** Node's compile cache has no eviction, and it files each script under its absolute path, so every fresh tree adds a full
 * set of entries. Keep a day, then cap it oldest first, K4's policy for the other local caches. A deleted entry is only a
 * recompile, and a live process keeps what it has loaded.
 * @param {string} directory @param {{capBytes?:number,maxAgeMs?:number,now?:number,dryRun?:boolean}} [options] */
export function pruneCompileCache(directory, { capBytes = 4 * GIB, maxAgeMs = 24 * HOUR, now = Date.now(), dryRun = false } = {}) {
  const files = entries(directory).filter(row => row.isDirectory()).flatMap(version => {
    const parent = join(directory, version.name);
    return entries(parent).filter(row => row.isFile()).flatMap(row => {
      try {
        const path = join(parent, row.name), { mtimeMs, blocks } = lstatSync(path);
        return [{ path, mtimeMs, bytes: blocks * 512 }];
      } catch { return []; }
    });
  }).sort((a, b) => a.mtimeMs - b.mtimeMs);
  const beforeBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  let bytes = beforeBytes, removed = 0;
  for (const file of files) {
    if (now - file.mtimeMs <= maxAgeMs && bytes <= capBytes) break;
    if (remove(file.path, dryRun)) { bytes -= file.bytes; removed++; }
  }
  return { files: files.length, beforeBytes, removed, keptBytes: bytes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '..'), dryRun = process.argv.includes('--dry-run'), cache = process.env.NODE_COMPILE_CACHE;
  console.info(JSON.stringify({ dryRun, vitestRuns: sweepVitestRuns(root, { dryRun }), testScratch: sweepTestScratch(root, { dryRun }),
    compileCache: cache === undefined ? null : pruneCompileCache(cache, { dryRun }) }));
}
