// Paths written as data rather than as imports: no compiler or resolver reads them, so a retag or a move leaves them
// behind silently and CI finds out minutes later, or never (a map input that vanishes just stops staling the map).
// The push gate runs this over the committed tree; `sort-sides --move` keeps the same spellings current.
import { posix } from 'node:path';

const LAYER_ROOT = /^src\/(engine|game|sdk|sharddev|commons)(?:\/|$)/u;
const EXTENDED = ['', '.ts', '.tsx', '.mts', '.mjs', '.js', '.json', '/index.ts'];
const ROOTED = /(?<![\w/.@-])(?:\.\/)?((?:client|cook|server|shared)\/[\w./-]+?)(?=["'\\])/gu;
const EMITTED = /(?<![\w./-])((?:\.\.?\/)+)(engine|game)\/((?:client|cook|server|shared)\/[\w./-]+)/gu;
const MAP_FILE = /^src\/shards\/[^/]+\/(?:data|look)\/map\.json$/u;

/** @param {ReadonlySet<string>} folders @param {ReadonlySet<string> | ReadonlyMap<string, unknown>} files @param {string} path */
const exists = (files, folders, path) => folders.has(path) || EXTENDED.some(ext => files.has(`${path}${ext}`));

/** Every failure as `file: …`, the shape the gate attributes.
 * @param {ReadonlySet<string> | ReadonlyMap<string, unknown>} files every committed path
 * @param {(path: string) => string} read
 * @returns {string[]} */
export function spelledPathFailures(files, read) {
  const failures = [], paths = [...files.keys()], folders = new Set(['src']);
  for (const path of paths) for (let at = path.indexOf('/'); at !== -1; at = path.indexOf('/', at + 1)) folders.add(path.slice(0, at));
  for (const file of paths) {
    const isolated = /^src\/(engine|game)\/isolated-[^/]+\.test\.ts$/u.exec(file)?.[1];
    if (isolated !== undefined) for (const [, rel] of read(file).matchAll(ROOTED))
      if (!exists(files, folders, `src/${isolated}/${rel}`)) failures.push(`${file}: no module at src/${isolated}/${rel}: the isolated test spells a side the file left`);
    if (/^scripts\/.*\.[cm]?[jt]s$/u.test(file) && !file.includes('.test.')) for (const match of read(file).matchAll(EMITTED))
      if (!exists(files, folders, `src/${match[2]}/${match[3]}`.replace(/[./]+$/u, ''))) failures.push(`${file}: no module at src/${match[2]}/${match[3]}: an emitted import spells a side the file left`);
    if (MAP_FILE.test(file)) for (const input of JSON.parse(read(file)).inputs ?? []) {
      const target = posix.normalize(posix.join(posix.dirname(file), '..', input));
      if (LAYER_ROOT.test(target) && !exists(files, folders, target)) failures.push(`${file}: input ${input} is gone: the map no longer stales on it`);
    }
  }
  return failures;
}
