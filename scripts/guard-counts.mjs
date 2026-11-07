// E362 AG16/17: shared full-tree and staged-path ratchet policy.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unsortedPath } from '../lint/layer-exports.mjs';
import { guardIndexTree } from './guard-index-tree.mjs';
import { parseSync } from 'vite';

/** Read JSONC as data, never as executable configuration. */
export function readLintConfig(file) {
  const parsed = parseSync('config.js', `const config = ${readFileSync(file, 'utf8')};`);
  if (parsed.errors.length > 0) throw new Error(`Cannot parse lint config: ${file}`);
  const read = (node) => {
    if (node?.type === 'Literal') return node.value;
    if (node?.type === 'ArrayExpression') return node.elements.map(read);
    if (node?.type === 'ObjectExpression') return Object.fromEntries(node.properties.map((p) => [p.key?.value ?? p.key?.name, read(p.value)]));
    throw new Error(`Lint config must contain only JSON data: ${file}`);
  };
  return read(parsed.program.body[0]?.declarations?.[0]?.init);
}

/** Hard custom rules in the src override. */
export function hardRules(file) {
  const config = readLintConfig(file);
  const result = new Set();
  for (const override of config.overrides ?? []) {
    if (!override.files?.includes('src/**')) continue;
    for (const [name, severity] of Object.entries(override.rules ?? {})) {
      if (name.startsWith('wildshard/') && (severity === 'error' || (Array.isArray(severity) && severity[0] === 'error'))) result.add(name);
    }
  }
  return result;
}

/** Only the supplied paths participate in a staged check; omitted paths mean the whole tree. */
export function compareCounts(baseline, current, hard, paths, update = false, defer = false, strictIncreases = false) {
  const failures = [], warnings = [];
  const selected = paths ? new Set(paths.map(unsortedPath)) : null;
  const rows = table => { // a row follows its file across a side move (J122)
    const out = {};
    for (const [file, count] of Object.entries(table)) out[unsortedPath(file)] = (out[unsortedPath(file)] ?? 0) + count;
    return out;
  };
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(current)])) {
    if (!key.startsWith('wildshard/')) continue;
    const previous = rows(baseline[key] ?? {}), now = rows(current[key] ?? {});
    for (const file of new Set([...Object.keys(previous), ...Object.keys(now)])) {
      if (selected && !selected.has(file)) continue;
      const was = previous[file] ?? 0, count = now[file] ?? 0;
      if (count > was) (defer && !strictIncreases && !hard.has(key) ? warnings : failures).push(`${file}: ${key} was ${was}, now ${count}${defer && !strictIncreases && !hard.has(key) ? ' (requires coordinator approval in the pusher regeneration commit)' : ''}`);
      else if (was > 0 && count === 0 && !update && !defer) failures.push(`${file}: ${key} is clean; run pnpm lint:ratchet --update in this commit`);
      else if (count < was) warnings.push(`${file}: ${key} was ${was}, now ${count} (${defer ? 'central regeneration will lower the debt' : 'partial slack; lower the ratchet'})`);
    }
    if (!selected && Object.hasOwn(baseline, key) && Object.values(now).every((n) => n === 0) && !hard.has(key)) {
      failures.push(`${key} reached zero: move it to .oxlintrc.json's src override before removing its ratchet section`);
    }
  }
  return { failures, warnings };
}

// A commit-only obligation, published by the actual guard process. The runner
// waits for that process AND verifies its success against the final index.
const GUARD_DEFINITIONS = ['.githooks/pre-commit', '.oxlintrc.json', '.oxlintrc.ratchet.json',
  'scripts/precommit-guards.mjs', 'scripts/guard-counts.mjs','scripts/guard-index-tree.mjs'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (root, args) => execFileSync('git', args, {cwd:root,encoding:'utf8'}).trim();
const sourcePath = path => /^src\/.*\.[cm]?[jt]sx?$/u.test(path) && !path.endsWith('.generated.ts');
const stagedBytes = (root, tree, path) => {
  try { return execFileSync('git', ['show', `${tree}:${path}`], {cwd:root,stdio:['ignore','pipe','ignore']}); }
  catch { return null; }
};
const seal = value => ({...value, digest:sha(JSON.stringify(value))});
const readRequirement = file => {
  const saved = JSON.parse(readFileSync(file,'utf8'));
  const {digest, ...value} = saved;
  if (digest !== sha(JSON.stringify(value)) || value.version !== 1
    || !Number.isSafeInteger(value.pid) || value.pid <= 0
    || !/^[a-f0-9]{40}$/u.test(value.tree) || !/^[a-f0-9]{40}$/u.test(value.parent)) throw new Error('Invalid required guard receipt');
  return value;
};
/** Publish exact staged coverage before the mandatory architecture guard starts. */
export function beginGuardRequirement(root, file) {
  if (process.env.SKIP_ARCH_GUARDS) throw new Error('Required architecture guard cannot be skipped');
  const tree=guardIndexTree(root);
  const files=git(root,['diff','--cached','--name-only','--diff-filter=ACMRD','-z']).split('\0').filter(sourcePath);
  const hashes = paths => Object.fromEntries(paths.map(path => {
    const bytes=stagedBytes(root,tree,path); return [path,bytes===null ? null : sha(bytes)];
  }));
  const definitions=hashes(GUARD_DEFINITIONS);
  for (const [path,hash] of Object.entries(definitions)) {
    if (hash===null || sha(readFileSync(resolve(root,path)))!==hash) throw new Error(`Required guard is not the staged implementation: ${path}`);
  }
  writeFileSync(file,JSON.stringify(seal({version:1,pid:process.pid,tree,parent:git(root,['rev-parse','HEAD']),
    files:hashes(files),definitions})),{flag:'wx'});
  return tree;
}
/** Refuse absent/stale coverage; only a live exact-source guard permits debt-only measurement. */
export function requiredGuardRules(root, file, paths) {
  if (process.env.SKIP_ARCH_GUARDS) throw new Error('Required architecture guard cannot be skipped');
  const value=readRequirement(file);
  process.kill(value.pid,0);
  if (JSON.stringify(Object.keys(value.definitions)) !== JSON.stringify(GUARD_DEFINITIONS)) throw new Error('Incomplete required guard definitions');
  for (const [path,hash] of Object.entries(value.definitions)) {
    if (hash===null || sha(readFileSync(resolve(root,path)))!==hash) throw new Error(`Required guard definition changed: ${path}`);
  }
  for (const path of paths) {
    if (!sourcePath(path)) continue;
    if (!Object.hasOwn(value.files,path)) throw new Error(`Required guard does not cover ${path}`);
    let actual=null;
    try { actual=sha(readFileSync(resolve(root,path))); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code==='ENOENT')) throw error; }
    if (actual!==value.files[path]) throw new Error(`Required guard source changed: ${path}`);
  }
  return hardRules(resolve(root,'.oxlintrc.json'));
}
/** Publish only after all final-tree architecture checks actually passed. */
export function completeGuardRequirement(root,file) {
  const value=readRequirement(file);
  if (value.pid!==process.pid || value.parent!==git(root,['rev-parse','HEAD'])) throw new Error('Required guard owner changed');
  writeFileSync(`${file}.passed`,JSON.stringify(seal({version:1,requirement:sha(readFileSync(file)),
    tree:guardIndexTree(root),parent:value.parent})),{flag:'wx'});
}
/** The runner refuses missing/error/skipped guards or any later index/parent change. */
export function verifyGuardRequirement(root,file) {
  if (process.env.SKIP_ARCH_GUARDS) throw new Error('Required architecture guard cannot be skipped');
  const {digest,...value}=JSON.parse(readFileSync(`${file}.passed`,'utf8'));
  if (digest!==sha(JSON.stringify(value)) || value.version!==1
    || value.requirement!==sha(readFileSync(file)) || value.tree!==guardIndexTree(root)
    || value.parent!==git(root,['rev-parse','HEAD'])) throw new Error('Final architecture guard did not pass this tree');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href && process.argv[2]==='--verify-guard') {
  try { verifyGuardRequirement(process.cwd(),process.argv[3]); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode=1; }
}
