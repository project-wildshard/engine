import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The file Node loads for relative `source` (a URL resolve, query and hash dropped), without a trailing slash; null when it cannot. */
const nodePath = (filename, source) => {
  try {
    return fileURLToPath(new URL(source, pathToFileURL(resolve(filename)))).replaceAll('\\', '/').replace(/(?<=.)\/$/u, '');
  } catch { return null; }
};
/** Both readings of relative `source`: path.resolve's, and Node's URL resolve (`%2e%2e` is `..`, `\\` is `/`). */
const relativeTargets = (filename, source) => !source.startsWith('.') ? []
  : [resolve(dirname(filename), source).replaceAll('\\', '/'), nodePath(filename, source)].filter(path => path !== null);
/** Whether either reading of a relative `source` lands under `src/<side>/<folder>` (a hidden boundary is still one). */
const relativeReach = (filename, source, folder) => {
  const pattern = new RegExp(`/src/(?:client|cook|server|shared)/${folder}(?:/|$)`, 'u');
  return relativeTargets(filename, source).some(path => pattern.test(path));
};

/** Resolve source syntax to the game boundary; relative imports cannot bypass the author-package rule. */
export function shardGameImport(filename, source) {
  if (typeof source !== 'string') return false;
  if (/^@wildshard\/(?:engine\/)?game(?:[/?#]|$)/u.test(source)) return true;
  return relativeReach(filename, source, 'game');
}

/** G307: a game's exports map is its plugin surface, never a parallel SDK facade allowlist. */
export function gamePluginImportViolation(filename, source, exports) {
  const path = filename.replaceAll('\\', '/');
  const local = /(?:^|\/)src\/shards\/[^/]+\/(.+)$/u.exec(path)?.[1];
  if (local === undefined || !shardGameImport(filename, source)) return null;
  if (!local.startsWith('runtime/')) return 'game imports belong only in runtime/';
  if (!source.startsWith('@wildshard/game/')) return 'use the defining @wildshard/game package export';
  if (!source.startsWith('@wildshard/game/plugin/')) return 'runtime imports use only game/plugin/*';
  const key = `.${source.slice('@wildshard/game'.length)}`;
  return Object.hasOwn(exports, key) ? null : 'game plugin module is not published in package exports';
}

/** Identify an engine boundary without letting relative imports bypass the shrink-only migration count. */
export function shardEngineImport(filename, source) {
  if (typeof source !== 'string') return false;
  if (/^@wildshard\/engine(?:\/(?!host\/|game\/)|[?#]|$)/u.test(source)) return true;
  return relativeReach(filename, source, 'engine');
}

/** Whether either reading of relative `source` (path.resolve's or Node's) lands in the trusted SDK runtime. */
export function sharddevRuntimeImport(filename, source) {
  return typeof source === 'string' && relativeTargets(filename, source).some(path => /\/src\/sharddev\/runtime(?:\/|$)/u.test(path));
}

const PLAINLY = 'the import path names one file to Node (a URL) and another to path.resolve; '
  + 'no percent-escape, backslash, tab, newline or edge space in an import path, write the path plainly';

/** `rawSource` without its ?query or #hash, which are no part of the file. Node keeps a bare specifier's `?` in the
 * subpath, so for one the stripped path is only ever the stricter read. */
const pathPart = rawSource => {
  const postfix = rawSource.slice(1).search(/[?#]/u) + 1;
  return postfix > 0 ? rawSource.slice(0, postfix) : rawSource;
};

/** Why `rawSource` names one file to Node and another to path.resolve (or to Vite), or null when they agree. */
function encodedImportViolation(filename, rawSource) {
  const source = pathPart(rawSource);
  // Node resolves a relative path as a URL (`./%2e%2e/` is `..`, `\\` is `/`, tabs and newlines drop out, `%2f` is
  // refused) and Vite decodes nothing, while path.resolve keeps them all as folder names: the lint and build disagree.
  if (/%[0-9a-f]{2}|[\\\t\n\r]/iu.test(source)) return PLAINLY;
  // The catch-all for a rewrite not listed above: the path must name the same file as a URL (how Node loads it).
  if (source.startsWith('.') && nodePath(filename, source) !== resolve(dirname(filename), source).replaceAll('\\', '/')) return PLAINLY;
  return null;
}

/** DS0.3 author folders use three, the authoring SDK, commons, and their own shard files only. Every other shard file
 * (bake commands, Blender sources, declarations) imports by a plain relative path or a package name: an escaped,
 * absolute or file: path would slip past the layer rules, which read it with path.resolve. */
export function generatorImportViolation(filename, rawSource) {
  const path=resolve(filename).replaceAll('\\','/'), match=/(?:^|\/)src\/shards\/([^/]+)\/(.+)$/u.exec(path);
  if(match===null || typeof rawSource!=='string')return null;
  const encoded=encodedImportViolation(filename,rawSource);
  if(encoded!==null)return encoded;
  const source=pathPart(rawSource);
  if(!(/^(?:generators|data|quests)\//u.test(match[2]) || match[2]==='shard.config.ts'))
    return isAbsolute(source) || source.startsWith('file:') ? 'shard files import by relative path or package name, never an absolute path or file: URL' : null;
  // Test runners and Node fixture tools never become producer imports.
  if(path.endsWith('.test.ts') && source!=='<computed>' && !source.startsWith('.')
    && !isAbsolute(source) && !source.startsWith('@wildshard/')) return null;
  if(/^@wildshard\/sharddev\/runtime(?:\/|$)/u.test(source))return 'trusted SDK runtime code is not an authoring import';
  if(source==='three' || source.startsWith('three/') || /^@wildshard\/(?:engine\/host|sdk|sharddev|commons)(?:\/|$)/u.test(source))return null;
  const local=source.startsWith('.') ? resolve(dirname(filename),source).replaceAll('\\','/') : '';
  const boundary=path.slice(0,path.length-match[2].length);
  if(local.startsWith(boundary))return null;
  return 'author folders import only three, sdk, commons or their own shard files';
}
