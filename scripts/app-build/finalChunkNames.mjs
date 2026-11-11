import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';

/**
 * A chunk's file name names its final bytes (main ci 43076662972). Vite writes `__vite__mapDeps`, a dynamic import's
 * preload list, into the importer after rolldown has taken the importer's content hash. The list names import-map keys
 * (J217), so it changes whenever the shared-chunk layout under that import moves, and the same file name then held
 * different bytes in two builds: the live preview's `late-TrainingArena-trainingDummyFigure-Ci9ql7Om.js` was 2022 bytes
 * and main's 2029, and an open tab lazy-loading it would have read the wrong list. After the bundle is written, every
 * chunk that carries such a list is renamed to its stem plus the hash of its final bytes, and every file that names it
 * (the documents' import maps and preloads, Vite's manifests, its source map, other chunks) is rewritten. Its importers
 * name it by its import-map key, which never changes, so a rename touches no other chunk's bytes.
 */

const HASHED = /^(.+)-[A-Za-z0-9_-]{8}\.js$/u;
const PRELOAD_LIST = '__vite__mapDeps';

/** rolldown's hash shape: 8 base64url characters, here of the file's final bytes
 * @param {Uint8Array | string} bytes */
export function finalHash(bytes) {
  return createHash('sha256').update(bytes).digest('base64url').slice(0, 8);
}

/** @param {string} dir @param {(name: string) => boolean} keep @returns {string[]} */
function files(dir, keep) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */ const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name), info = statSync(path);
    if (info.isDirectory()) out.push(...files(path, keep));
    else if (keep(name)) out.push(path);
  }
  return out;
}

/** The text files of a build that may name a chunk: its code tree's scripts and tables, Vite's manifests and the
 * documents at the top and one folder down.
 * @param {string} outDir */
function namingFiles(outDir) {
  const documents = readdirSync(outDir).flatMap(name => {
    const path = join(outDir, name);
    if (name.endsWith('.html')) return [path];
    const nested = join(path, 'index.html');
    return statSync(path).isDirectory() && existsSync(nested) ? [nested] : [];
  });
  const roots = readdirSync(outDir).filter(name => name === 'importmap.json').map(name => join(outDir, name));
  return [...documents, ...roots, ...files(join(outDir, '.vite'), name => name.endsWith('.json')),
    ...files(join(outDir, 'b'), name => name.endsWith('.js') || name.endsWith('.json'))];
}

/**
 * Rename each preload-carrying chunk under `outDir/b` to the hash of its final bytes and rewrite every file that names
 * it. Repeats until nothing moves (a rewrite inside another carrier changes that carrier's bytes).
 * @param {string} outDir
 * @returns {{ from: string, to: string }[]} the renames, as paths relative to `outDir`
 */
export function nameChunksByFinalBytes(outDir) {
  /** @type {{ from: string, to: string }[]} */ const renames = [];
  // A rename rewrites only names, and importers name a carrier by its key: the second round normally finds nothing.
  // A chain of carriers naming each other by value settles one link a round; the bound is one round per carrier.
  const bound = files(join(outDir, 'b'), name => name.endsWith('.js')).length + 2;
  for (let round = 0; round < bound; round++) {
    /** @type {Map<string, string>} old basename -> new basename */ const moved = new Map();
    for (const path of files(join(outDir, 'b'), name => name.endsWith('.js'))) {
      const code = readFileSync(path);
      if (!code.includes(PRELOAD_LIST)) continue;
      const name = basename(path), stem = HASHED.exec(name)?.[1];
      if (stem === undefined) continue;
      const next = `${stem}-${finalHash(code)}.js`;
      if (next === name) continue;
      const target = join(dirname(path), next);
      if (existsSync(target) && !readFileSync(target).equals(code)) throw new Error(`Final chunk name ${next} already holds other bytes`);
      renameSync(path, target);
      const map = `${path}.map`;
      if (existsSync(map)) {
        const json = JSON.parse(readFileSync(map, 'utf8'));
        if (typeof json.file === 'string') json.file = json.file.replace(name, next);
        writeFileSync(`${target}.map`, JSON.stringify(json)); rmSync(map);
      }
      moved.set(name, next);
      renames.push({ from: relative(outDir, path).split(sep).join('/'), to: relative(outDir, target).split(sep).join('/') });
    }
    if (moved.size === 0) return renames;
    for (const file of namingFiles(outDir)) {
      const text = readFileSync(file, 'utf8');
      let next = text;
      // a whole path segment only: `/name` (a path or `./name`), never the tail of a longer name
      for (const [from, to] of moved) if (next.includes(`/${from}`)) next = next.replaceAll(`/${from}`, `/${to}`);
      if (next !== text) writeFileSync(file, next);
    }
  }
  throw new Error(`Chunk names did not settle after ${String(bound)} rounds (carriers naming each other in a cycle)`);
}
