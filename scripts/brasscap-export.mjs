#!/usr/bin/env node
// J506 (Jake, 2026-11-23 ~20:55 Cancún: "export a copy of Brascap Messe into the corpus of both short format and of the
// engine"): engine's pinned copy of Brasscap Mesa, run by hand. It mirrors shard-format's src/tools/brasscap-export.ts
// (SS4, J342): Brasscap's source lives in `shard-brasscap`; engine keeps the shard file folder one pinned commit of it
// builds, in test/fixtures/corpus/brasscap-mesa/, and test/brasscap-corpus.test.ts reads it. This script:
//   1. resolves the commit in a local shard-brasscap checkout;
//   2. extracts that commit with `git archive` into tmp/brasscap-export/ (never the checkout's working tree);
//   3. installs its own lockfile there (`pnpm install --frozen-lockfile --ignore-scripts`);
//   4. runs `wildshard build .` there, from the sdk that commit pins;
//   5. replaces test/fixtures/corpus/brasscap-mesa/ with the built folder, less blobs/glb/, and writes the pin beside it.
// blobs/glb/ stays out: at 4a6ff4e it is 19 MB in 40-odd files, five of them over engine's 1 MB blob cap and the whole
// export over its 10 MB push cap (scripts/storage-policy.json). The pin keeps the full folder's tree hash and file count,
// the same numbers shard-format's pin carries, so the two copies are provably one build; `kept` hashes what engine holds.
// Nothing runs in CI (no cross-repo CI, J342); the test checks the committed folder against the pin.
//   node scripts/brasscap-export.mjs [--commit <rev>] [--repo <shard-brasscap checkout>] [--check] [--keep]
// --commit defaults to the pin's commit; --check builds and compares, writing nothing, and exits 1 on a difference.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = 'brasscap-mesa';
const FOLDER = `test/fixtures/corpus/${SLUG}`;
const EXPORT = path.join(ROOT, FOLDER);
const PIN = path.join(ROOT, `${FOLDER}.pin.json`);
const REPO_URL = 'https://github.com/project-wildshard/shard-brasscap';
/** The first shard-brasscap commit that says status earlyAccess (QA-FEEDBACK-2026-11-23-b row 3); an export bakes it or later. */
const FLOOR = '4a6ff4ee9cc3081c7d5c3c71f9b5c65f1698427d';
const OMIT = 'blobs/glb/';

/**
 * @typedef {{ about: string, repo: string, commit: string, folder: string, files: number, tree: string,
 *   omitted: { prefix: string, files: number, bytes: number }, kept: { files: number, tree: string } }} Pin
 */

/** Every regular file under `folder`, as sorted `/`-joined relative paths. @param {string} folder @returns {string[]} */
export function listFiles(folder) {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(folder, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort();
}

/** One hash for a set of files: sha256 over each file's `path NUL sha256 LF`, in path order (shard-format's treeHash).
 * @param {string} folder @param {readonly string[]} [files] @returns {string} */
export function treeHash(folder, files = listFiles(folder)) {
  const tree = createHash('sha256');
  for (const file of files) {
    tree.update(`${file}\0${createHash('sha256').update(readFileSync(path.join(folder, file))).digest('hex')}\n`);
  }
  return tree.digest('hex');
}

/** @returns {Pin | undefined} */
function readPin() { return existsSync(PIN) ? JSON.parse(readFileSync(PIN, 'utf8')) : undefined; }

/** @param {string} command @param {readonly string[]} args @param {string} cwd */
function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

function main() {
  const args = process.argv.slice(2);
  /** @param {string} name */
  const flag = (name) => { const at = args.indexOf(name); return at === -1 ? undefined : args[at + 1]; };
  const check = args.includes('--check'), keep = args.includes('--keep');
  const repo = path.resolve(ROOT, flag('--repo') ?? '../shard-brasscap');
  const pinned = readPin();
  const rev = flag('--commit') ?? pinned?.commit;
  if (rev === undefined) throw new Error('no pin yet: pass --commit <shard-brasscap commit>');
  if (!existsSync(path.join(repo, '.git'))) throw new Error(`no shard-brasscap checkout at ${repo} (pass --repo <path>)`);
  const commit = run('git', ['rev-parse', '--verify', `${rev}^{commit}`], repo).trim();
  try { run('git', ['merge-base', '--is-ancestor', FLOOR, commit], repo); } catch {
    throw new Error(`${commit} does not contain ${FLOOR.slice(0, 7)} (Brasscap's player status): pin that commit or a later one`);
  }

  const work = path.join(ROOT, 'tmp/brasscap-export');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  try {
    const archive = path.join(work, 'source.tar'), source = path.join(work, 'source');
    mkdirSync(source);
    run('git', ['archive', '--format=tar', '-o', archive, commit], repo);
    run('tar', ['-xf', archive, '-C', source], work);
    run('pnpm', ['install', '--frozen-lockfile', '--prefer-offline', '--ignore-scripts'], source);
    run('pnpm', ['exec', 'wildshard', 'build', '.'], source);
    const built = path.join(source, 'public/shardfiles', SLUG);
    const index = JSON.parse(readFileSync(path.join(built, 'shard.json'), 'utf8'));
    if (index.identity?.slug !== SLUG) throw new Error(`the build at ${commit} is not ${SLUG}`);
    const all = listFiles(built), kept = all.filter((file) => !file.startsWith(OMIT)), omitted = all.filter((file) => file.startsWith(OMIT));
    /** @type {Pin} */
    const pin = {
      about: `J506: ${FOLDER}/ is \`wildshard build\` of this shard-brasscap commit less ${OMIT} (engine's blob and push caps), written by node scripts/brasscap-export.mjs. files and tree are the whole build's, as shard-format's corpus/exports/${SLUG}.pin.json gives them; kept is what engine holds. Do not edit it by hand: change shard-brasscap, then re-export.`,
      repo: REPO_URL,
      commit,
      folder: FOLDER,
      files: all.length,
      tree: treeHash(built, all),
      omitted: { prefix: OMIT, files: omitted.length, bytes: omitted.reduce((sum, file) => sum + readFileSync(path.join(built, file)).length, 0) },
      kept: { files: kept.length, tree: treeHash(built, kept) },
    };
    const short = commit.slice(0, 7);
    if (check) {
      const same = existsSync(EXPORT) && treeHash(EXPORT) === pin.kept.tree && pinned?.commit === commit && pinned.tree === pin.tree;
      process.stdout.write(same
        ? `ok: ${FOLDER} is shard-brasscap ${short} (${pin.kept.files} of ${pin.files} files, tree ${pin.tree})\n`
        : `stale: shard-brasscap ${short} builds tree ${pin.tree}; committed is ${pinned?.tree ?? 'none'} at ${pinned?.commit.slice(0, 7) ?? 'none'}\n`);
      if (!same) process.exitCode = 1;
      return;
    }
    rmSync(EXPORT, { recursive: true, force: true });
    mkdirSync(EXPORT, { recursive: true });
    for (const file of kept) { mkdirSync(path.dirname(path.join(EXPORT, file)), { recursive: true }); cpSync(path.join(built, file), path.join(EXPORT, file)); }
    writeFileSync(PIN, `${JSON.stringify(pin, undefined, 2)}\n`);
    process.stdout.write(`exported shard-brasscap ${short} to ${FOLDER}: ${pin.kept.files} of ${pin.files} files (less ${omitted.length} in ${OMIT}), tree ${pin.tree}\n`);
  } finally {
    if (!keep) rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
