// Traced input hashes shared by boot-table generation.
import { createHash } from 'node:crypto';
import { existsSync, globSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const hash = (/** @type {string | Uint8Array} */ data) => createHash('sha256').update(data).digest('hex');
const ALWAYS = ['F pnpm-lock.yaml', 'F package.json'];

/** The current value of one recorded input inside `tree` (paths are tree-relative). @param {string} tree @param {string} entry */
export function inputValue(tree, entry) {
  const kind = entry.slice(0, 1), rest = entry.slice(2);
  if (kind === 'G') {
    const [cwd = '.', pattern = ''] = rest.split('\t');
    try { return hash(globSync(pattern, { cwd: resolve(tree, cwd) }).map(String).sort().join('\n')); } catch { return 'error'; }
  }
  const path = resolve(tree, rest);
  if (!existsSync(path)) return 'absent';
  const stat = statSync(path);
  if (stat.isDirectory()) return `dir:${hash(readdirSync(path).sort().join('\n'))}`;
  return kind === 'D' ? 'not-a-dir' : hash(readFileSync(path));
}

/** Fold raw trace lines (absolute paths) into tree-relative entries; node_modules is represented by the lockfile. */
export function treeEntries(/** @type {string} */ tree, /** @type {string[]} */ lines) {
  const real = realpathSync(tree), entries = new Set(ALWAYS);
  /** @param {string} path */
  const inside = (path) => {
    let target = path;
    try { target = realpathSync(path); } catch { /* absent: keep the literal path */ }
    const rel = relative(real, target);
    if (rel === '' || rel.startsWith('..') || rel.startsWith(sep) || rel.split(sep).includes('node_modules')) return null;
    return rel.split(sep).join('/');
  };
  for (const line of lines) {
    const kind = line.slice(0, 1), rest = line.slice(2);
    if (kind === 'G') {
      const [cwd = '', pattern = ''] = rest.split('\t'), rel = inside(cwd);
      if (rel !== null) entries.add(`G ${rel}\t${pattern}`);
    } else if (kind === 'F' || kind === 'D') {
      const rel = inside(rest);
      if (rel !== null) entries.add(`${kind} ${rel}`);
    }
  }
  return [...entries].sort();
}
