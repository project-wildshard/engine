// @ts-check
import { spawnSync } from 'node:child_process';
import { globSync, realpathSync, statSync } from 'node:fs';
import { matchesGlob, resolve } from 'node:path';
import { committedSourceFiles } from '../scripts/source-input-proof.mjs';

const roots = ['src', 'scripts', 'test', 'vite', 'api', 'admin', 'drafts', 'lint'];
const code = /\.[cm]?[jt]sx?$/u;

/** Enumerate inside the requested tree, never through a parent's ignored directory.
 * Git checkouts retain tracked files plus nonignored new sources. Exported
 * mirrors use their existing exact inventory; isolated fixtures walk locally.
 * @param {string} root @param {readonly string[]} ignored
 * @param {Readonly<Record<string,string|undefined>>} [env] @returns {string[]} */
export function fullRatchetFiles(root, ignored, env = process.env) {
  const base = realpathSync(root);
  /** @type {string[]} */
  let files;
  if (env.WS_GENERATION_TREE_FILES !== undefined || env.WS_GENERATION_TREE_ROOT !== undefined) {
    files = committedSourceFiles(base, env);
  } else {
    const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: base, encoding: 'utf8' });
    if (top.status === 0 && realpathSync(top.stdout.trim()) === base) {
      const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        cwd: base, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
      });
      if (listed.error !== undefined) throw listed.error;
      if (listed.status !== 0) throw new Error(`Cannot enumerate ratchet sources: ${listed.stderr}`);
      files = listed.stdout.split('\0').filter(file => file !== '');
    } else {
      files = [...globSync('*', { cwd: base }), ...roots.flatMap(folder =>
        globSync(`${folder}/**/*`, { cwd: base, exclude: ['**/node_modules/**'] }))];
      files = files.filter(file => statSync(resolve(base, file), { throwIfNoEntry: false })?.isFile());
    }
  }
  const selected = [...new Set(files)].filter(file => code.test(file)
    && (!file.includes('/') || roots.includes(file.split('/')[0] ?? ''))
    && !ignored.some(pattern => matchesGlob(file, pattern))).sort();
  for (const file of selected) {
    if (!statSync(resolve(base, file), { throwIfNoEntry: false })?.isFile())
      throw new Error(`Missing ratchet census input: ${file}`);
  }
  if (!selected.some(file => file.startsWith('src/'))) throw new Error('Ratchet census has no source inputs');
  return selected;
}
