/** G649: JSON holds text/rows, never encoded binary. Existing debt is exact-path, shrinking-only policy. */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, posix, resolve } from 'node:path';
import process from 'node:process';
import { checkGeneratedSourceRevision, checkGeneratedSourceTree, grownRows, publishedPolicyRestoration, sidelessPath } from './generated-source.mjs';

export const BINARY_JSON_POLICY = 'lint/no-binary-json.json';
const ROOTS = ['src', 'public', 'scripts', 'test', 'lint'];
/** @typedef {{base64Chars:number,dataUris:number}} BinaryCounts */
/** @typedef {{schema:'no-binary-json/1',source:string,files:Record<string,BinaryCounts>}} BinaryPolicy */

/** Decode JSON before inspecting strings: escaped slashes/Unicode cannot hide payloads.
 * Object keys count too; traversal is iterative for deeply nested authored rows.
 * @param {unknown} value @returns {BinaryCounts} */
export function binaryJsonCounts(value) {
  let base64Chars = 0, dataUris = 0;
  const pending = [value];
  while (pending.length > 0) {
    const next = pending.pop();
    if (typeof next === 'string') {
      for (const match of next.matchAll(/[A-Za-z0-9+/]{1024,}={0,2}/gu)) base64Chars += match[0].length;
      for (const _match of next.matchAll(/\bdata:[^,\s]*,/giu)) dataUris++;
    } else if (Array.isArray(next)) { for (const row of next) pending.push(row); }
    else if (next !== null && typeof next === 'object') {
      for (const [key, row] of Object.entries(next)) { pending.push(key); pending.push(row); }
    }
  }
  return { base64Chars, dataUris };
}

/** @param {string} path */
function safePath(path) { return !isAbsolute(path) && path === posix.normalize(path) && !path.startsWith('../') && !path.includes('\\') && path.endsWith('.json'); }
/** @param {unknown} value @returns {BinaryPolicy} */
export function binaryJsonPolicy(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('BINARY-JSON invalid policy');
  const schema = Reflect.get(value, 'schema'), source = Reflect.get(value, 'source'), files = Reflect.get(value, 'files');
  if (schema !== 'no-binary-json/1' || typeof source !== 'string' || !/^[a-f0-9]{40}$/u.test(source)
    || files === null || typeof files !== 'object' || Array.isArray(files)) throw new Error('BINARY-JSON invalid policy');
  /** @type {Record<string,BinaryCounts>} */
  const checked = {};
  for (const [path, row] of Object.entries(files)) {
    if (!safePath(path) || row === null || typeof row !== 'object' || Array.isArray(row)
      || Object.keys(row).sort().join(',') !== 'base64Chars,dataUris') throw new Error(`BINARY-JSON invalid allowance ${path}`);
    const chars = Reflect.get(row, 'base64Chars'), uris = Reflect.get(row, 'dataUris');
    if (typeof chars !== 'number' || typeof uris !== 'number' || !Number.isSafeInteger(chars) || !Number.isSafeInteger(uris)
      || chars < 0 || uris < 0 || chars + uris === 0) throw new Error(`BINARY-JSON invalid allowance ${path}`);
    Object.defineProperty(checked, path, { value: { base64Chars: chars, dataUris: uris }, enumerable: true });
  }
  return { schema, source, files: checked };
}

/** Exact reviewed corrections are the only exception to shrinking debt.
 * @param {BinaryPolicy} before @param {BinaryPolicy} after @param {string} [message] @returns {string[]} */
export function binaryPolicyIncreases(before, after, message = '') {
  const expected = new Map(), failures = [], approved = new Set();
  for (const [path, row] of Object.entries(after.files)) {
    const previous = Object.hasOwn(before.files, path) ? before.files[path] : undefined;
    if (previous === undefined || row.base64Chars > previous.base64Chars || row.dataUris > previous.dataUris)
      expected.set(`Binary-JSON-Approved: wildshard-new ${path} ${row.base64Chars} ${row.dataUris}`, path);
  }
  const content = message.trimEnd().replace(/\n\nAssisted-by:[^\n]+$/u, '').replaceAll(/\n[ \t]+/gu, ' ');
  const footer = content.split(/\n\s*\n/u).at(-1) ?? '';
  for (const line of content.split('\n').filter(item => item.startsWith('Binary-JSON-Approved:'))) {
    if (!footer.split('\n').includes(line) || !expected.has(line) || approved.has(line)) failures.push(`BINARY-JSON ${BINARY_JSON_POLICY}: invalid or unmatched approval ${line}`);
    approved.add(line);
  }
  for (const [line, path] of expected) if (!approved.has(line)) failures.push(`BINARY-JSON ${BINARY_JSON_POLICY}: allowance grew for ${path}; missing ${line}`);
  return failures;
}

/** Preserve JSON strings while accepting comments/trailing commas in repository config JSON.
 * @param {string} text @returns {unknown} */
export function binaryJsonValue(text) {
  try { return JSON.parse(text); } catch { /* Config JSON may use comments and trailing commas. */ }
  const comments = text.replaceAll(/"(?:\\[\s\S]|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//gu, token => token.startsWith('"') ? token : ' ');
  const commas = comments.replaceAll(/"(?:\\[\s\S]|[^"\\])*"|,\s*(?=[}\]])/gu, token => token.startsWith('"') ? token : '');
  // Historical Python measurement reports contain non-finite numeric tokens.
  return JSON.parse(commas.replaceAll(/"(?:\\[\s\S]|[^"\\])*"|(?<![\w])(?:-?Infinity|NaN)(?![\w])/gu, token => token.startsWith('"') ? token : 'null'));
}

/** @param {string} path @param {string} text @param {BinaryPolicy} policy @returns {string[]} */
export function binaryJsonFailures(path, text, policy) {
  let value;
  try { value = binaryJsonValue(text); }
  catch (error) { throw new Error(`BINARY-JSON ${path}: invalid JSON`, { cause: error }); }
  return binaryJsonValueFailures(path, value, policy);
}

/** @param {string} path @param {unknown} value @param {BinaryPolicy} policy @returns {string[]} */
export function binaryJsonValueFailures(path, value, policy) {
  const counts = binaryJsonCounts(value);
  const allowed = (Object.hasOwn(policy.files, path) ? policy.files[path] : undefined) ?? { base64Chars: 0, dataUris: 0 };
  return counts.base64Chars <= allowed.base64Chars && counts.dataUris <= allowed.dataUris ? []
    : [`BINARY-JSON ${path}: base64Chars=${counts.base64Chars} dataUris=${counts.dataUris}; allowed ${allowed.base64Chars}/${allowed.dataUris}. Emit a binary file beside the JSON.`];
}

/** @param {string} root @param {string[]} args @param {Buffer} [input] */
function git(root, args, input) { return execFileSync('git', args, { cwd: root, input, maxBuffer: 256 * 1024 * 1024 }); }
/** @param {string} root @param {string} revision */
function entries(root, revision) {
  const output = revision === ':' ? git(root, ['ls-files', '--stage', '-z']) : git(root, ['ls-tree', '-rz', revision]);
  /** @type {Map<string,{mode:string,oid:string}>} */
  const found = new Map();
  for (const record of output.toString().split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    if (tab === -1) throw new Error('BINARY-JSON malformed Git path');
    const path = record.slice(tab + 1), fields = record.slice(0, tab).split(' ');
    const mode = fields.at(0), middle = fields.at(1), last = fields.at(2);
    if (mode === undefined || middle === undefined || last === undefined) throw new Error('BINARY-JSON malformed Git entry');
    if (revision === ':' && last !== '0') throw new Error('BINARY-JSON unmerged index');
    found.set(path, { mode, oid: revision === ':' ? middle : last });
  }
  return found;
}
/** @param {string} root @param {Map<string,{mode:string,oid:string}>} tree @param {string[]} paths */
function blobs(root, tree, paths) {
  const selected = paths.filter(path => tree.has(path));
  if (selected.length > 32) {
    const found = new Map();
    for (let at = 0; at < selected.length; at += 32) for (const [path, text] of blobs(root, tree, selected.slice(at, at + 32))) found.set(path, text);
    return found;
  }
  const raw = git(root, ['cat-file', '--batch'], Buffer.from(selected.map(path => `${tree.get(path)?.oid}\n`).join('')));
  /** @type {Map<string,string>} */
  const found = new Map(); let at = 0;
  for (const path of selected) {
    const mode = tree.get(path)?.mode;
    if (mode !== '100644' && mode !== '100755') throw new Error(`BINARY-JSON non-regular input ${path}`);
    const end = raw.indexOf(10, at), size = Number(raw.subarray(at, end).toString().split(' ')[2]);
    if (end === -1 || !Number.isSafeInteger(size) || size < 0) throw new Error('BINARY-JSON malformed Git blob');
    found.set(path, raw.subarray(end + 1, end + 1 + size).toString()); at = end + size + 2;
  }
  return found;
}

/** A separate source/tooling census cannot be erased by src-only central debt regeneration.
 * @param {string} root @param {Map<string,{mode:string,oid:string}>} tree @param {Map<string,{mode:string,oid:string}>} parent @param {string} file @param {string} schema @param {RegExp} roots @param {string} message @param {string} previous */
function sourceDebtChanges(root, tree, parent, file, schema, roots, message, previous) {
  if (!tree.has(file)) return parent.has(file) ? [`BINARY-JSON ${file}: source debt policy deleted`] : [];
  /** @param {Map<string,{mode:string,oid:string}>} records @returns {{files:Record<string,number>,sources:string[]}} */
  const read = records => {
    const value = JSON.parse(blobs(root, records, [file]).get(file) ?? 'null');
    if (value === null || typeof value !== 'object' || value.schema !== schema || !/^[a-f0-9]{40}$/u.test(value.source)
      || value.files === null || typeof value.files !== 'object' || Array.isArray(value.files)) throw new Error(`BINARY-JSON ${file}: invalid source debt policy`);
    for (const [path, count] of Object.entries(value.files)) if (!roots.test(path) || path !== posix.normalize(path) || path.includes('\\') || !/\.[cm]?[jt]sx?$/u.test(path)
      || typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) throw new Error(`BINARY-JSON ${file}: invalid source debt allowance ${path}`);
    const sources=value.sources??[];
    if(!Array.isArray(sources)||sources.some(path=>typeof path!=='string'||!path.startsWith('src/')||path!==posix.normalize(path)||path.includes('\\')||!path.endsWith('.ts'))
      ||new Set(sources).size!==sources.length)throw new Error(`BINARY-JSON ${file}: invalid app source exemptions`);
    return {files:value.files,sources};
  };
  const after = read(tree);
  if (!parent.has(file)) return [];
  const before = read(parent), failures = [];
  // A same-revision authored-manifest conversion changes source identity, not permission to import arbitrary generated code.
  const discoveryMigration = path => {
    const match = /^src\/shards\/([a-z_][a-z0-9_-]*)\/discovery\.generated\.ts$/u.exec(path), folder = match?.[1];
    if (file !== 'lint/generated-import-debt.json' || folder === undefined) return false;
    const base = `src/shards/${folder}/manifest`, catalogue = 'scripts/source-generation-outputs.json';
    if (!parent.has(`${base}.ts`) || tree.has(`${base}.ts`) || parent.has(`${base}.json`) || !tree.has(`${base}.json`) || !tree.has(catalogue)) return false;
    const outputs = JSON.parse(blobs(root, tree, [catalogue]).get(catalogue) ?? 'null');
    return outputs?.schema === 'source-generation-outputs/1' && Array.isArray(outputs.producers?.['scripts/gen-shards.mjs'])
      && outputs.producers['scripts/gen-shards.mjs'].includes(path);
  };
  for(const path of grownRows(before.sources,after.sources))if(!discoveryMigration(path))failures.push(`BINARY-JSON ${file}: app source exemption grew for ${path}`);
  // A count follows its file across a side move (J122): rows compare under the side-free path, summed, so a move at an
  // equal or lower count is no growth, a raised count still is, and a second row beside the first cannot add to it.
  /** @param {Record<string,number>} files */
  const totals = files => {
    /** @type {Map<string,number>} */
    const out = new Map();
    for (const [path,count] of Object.entries(files)) out.set(sidelessPath(path),(out.get(sidelessPath(path)) ?? 0)+count);
    return out;
  };
  const allowed = totals(before.files), held = totals(after.files);
  const grown = Object.entries(after.files).filter(([path]) => {
    const limit = allowed.get(sidelessPath(path));
    return limit === undefined || (held.get(sidelessPath(path)) ?? 0) > limit;
  });
  const increases = grown.filter(([path,count]) => !publishedPolicyRestoration(root, previous, file, schema, path, count));
  // Each debt file takes exact coordinator approval lines for its own increases, one per path at its new count. A line for a
  // grown row that a published-policy restoration already allows still matches, so its verdict cannot depend on `previous`.
  const prefix = file === 'lint/base64-debt.json' ? 'Base64-Approved:' : 'Generated-Import-Approved:';
  const expected = new Map(grown.map(([path,count]) => [`${prefix} wildshard-new ${path} ${count}`,path]));
  const content = message.trimEnd().replace(/\n\nAssisted-by:[^\n]+$/u,'').replaceAll(/\n[ \t]+/gu,' ');
  const footer = content.split(/\n\s*\n/u).at(-1) ?? '', approved = new Set();
  for (const line of content.split('\n').filter(row => row.startsWith(prefix))) {
    if (!footer.split('\n').includes(line) || !expected.has(line) || approved.has(line)) failures.push(`BINARY-JSON ${file}: invalid or unmatched approval ${line}`);
    else approved.add(line);
  }
  for (const [path,count] of increases) if (!approved.has(`${prefix} wildshard-new ${path} ${count}`)) failures.push(`BINARY-JSON ${file}: source debt allowance grew for ${path}`);
  return failures;
}

/** Check exact immutable/index blobs, never a neighbour's working file.
 * @param {string} root @param {string} revision @param {string} previous @param {readonly string[]} changed
 * @param {string} [rangeMessage] the approvals of every commit in previous..revision, for a multi-commit range */
export function checkBinaryRevision(root, revision, previous, changed, rangeMessage) {
  const tree = entries(root, revision), parent = entries(root, previous);
  const message = rangeMessage ?? (revision === ':' ? process.env.WS_COMMIT_MESSAGE ?? '' : git(root, ['show', '-s', '--format=%B', revision]).toString());
  const base64 = [
    ...sourceDebtChanges(root,tree,parent,'lint/base64-debt.json','no-base64/1',/^(?:src|scripts)\//u,message,previous),
    ...sourceDebtChanges(root,tree,parent,'lint/generated-import-debt.json','no-generated-import/1',/^(?:src|test)\//u,message,previous),
    ...checkGeneratedSourceRevision(root, revision, previous, changed),
  ];
  if (!tree.has(BINARY_JSON_POLICY)) return [...base64, ...(parent.has(BINARY_JSON_POLICY) ? [`BINARY-JSON ${BINARY_JSON_POLICY}: policy deleted`] : [])];
  const policy = binaryJsonPolicy(JSON.parse(blobs(root, tree, [BINARY_JSON_POLICY]).get(BINARY_JSON_POLICY) ?? 'null'));
  const before = parent.has(BINARY_JSON_POLICY) ? binaryJsonPolicy(JSON.parse(blobs(root, parent, [BINARY_JSON_POLICY]).get(BINARY_JSON_POLICY) ?? 'null')) : undefined;
  if (before !== undefined) for (const [path, counts] of Object.entries(policy.files)) {
    const prior = before.files[path];
    if ((prior === undefined || counts.base64Chars > prior.base64Chars || counts.dataUris > prior.dataUris)
      && publishedPolicyRestoration(root, previous, BINARY_JSON_POLICY, policy.schema, path, counts)) before.files[path] = counts;
  }
  const failures = [...base64, ...(before === undefined ? [] : binaryPolicyIncreases(before, policy, message))];
  const selected = changed.includes(BINARY_JSON_POLICY) ? [...tree.keys()].filter(path => path.endsWith('.json')) : changed.filter(path => path.endsWith('.json'));
  for (const [path, text] of blobs(root, tree, selected)) failures.push(...binaryJsonFailures(path, text, policy));
  return failures;
}

/** Scan tracked and declared outputs plus unexpected JSON outputs in the runtime/source roots.
 * @param {string} root @returns {string[]} */
export function binaryJsonFiles(root) {
  const listing = resolve(root, '.push-tracked.json');
  /** @type {string[]} */
  const tracked = existsSync(listing) ? JSON.parse(readFileSync(listing, 'utf8')) : git(root, ['ls-files', '-z']).toString().split('\0');
  const files = new Set(tracked.filter(path => path.endsWith('.json')));
  for (const folder of ROOTS) {
    const base = resolve(root, folder); if (!existsSync(base)) continue;
    for (const path of readdirSync(base, { recursive: true, encoding: 'utf8' })) if (path.endsWith('.json') && !path.split('/').includes('node_modules')) files.add(`${folder}/${path}`);
  }
  return [...files].sort();
}

/** @param {string} directory @param {BinaryPolicy} [baseline] @returns {string[]} */
export function checkBinaryTree(directory, baseline) {
  const root = resolve(directory);
  const policy = baseline ?? binaryJsonPolicy(JSON.parse(readFileSync(resolve(root, BINARY_JSON_POLICY), 'utf8'))), failures = checkGeneratedSourceTree(root);
  for (const path of binaryJsonFiles(root)) {
    const target = resolve(root, path); if (!existsSync(target)) continue;
    if (!safePath(path)) throw new Error(`BINARY-JSON escaping path ${path}`);
    for (let parent = target; parent !== root; parent = resolve(parent, '..')) if (lstatSync(parent).isSymbolicLink()) throw new Error(`BINARY-JSON symlink ${path}`);
    if (lstatSync(target).isFile()) failures.push(...binaryJsonFailures(path, readFileSync(target, 'utf8'), policy));
  }
  return failures;
}

if (import.meta.main) {
  const root = process.cwd(), args = process.argv.slice(2);
  const mode = args.at(0), base = args.at(1), tip = args.at(2);
  /** @type {string[]} */
  const failures = [];
  if (mode === '--staged') {
    const paths = git(root, ['diff', '--cached', '--name-only', '--no-renames', '-z']).toString().split('\0').filter(Boolean);
    failures.push(...checkBinaryRevision(root, ':', 'HEAD', paths));
  } else if (mode === '--range' && base !== undefined && tip !== undefined) {
    const paths = git(root, ['diff', '--name-only', '--no-renames', '-z', base, tip]).toString().split('\0').filter(Boolean);
    // A range is one base..tip diff, so an approval in any of its commits counts, not only the tip's: each commit's
    // final-footer approval lines join one synthetic footer (deduplicated, in commit order).
    const approvals = [];
    for (const commit of git(root, ['rev-list', '--reverse', `${base}..${tip}`]).toString().split('\n').filter(Boolean)) {
      const content = git(root, ['show', '-s', '--format=%B', commit]).toString().trimEnd().replace(/\n\nAssisted-by:[^\n]+$/u,'').replaceAll(/\n[ \t]+/gu,' ');
      for (const line of (content.split(/\n\s*\n/u).at(-1) ?? '').split('\n')) if (/^[A-Za-z0-9-]+-Approved: /u.test(line) && !approvals.includes(line)) approvals.push(line);
    }
    failures.push(...checkBinaryRevision(root, tip, base, paths, `range ${base}..${tip}\n\n${approvals.join('\n')}`));
  } else if (mode === '--all') failures.push(...checkBinaryTree(root));
  else throw new Error('usage: no-binary-json.mjs --staged | --range <base> <tip> | --all');
  if (failures.length > 0) { for (const failure of failures) console.error(failure); process.exitCode = 1; }
  else console.info('no-binary-json: pass');
}
