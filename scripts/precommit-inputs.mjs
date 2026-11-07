// G636: parallel exact-source checks within one five-second wall budget.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { matchesGlob, posix, resolve } from 'node:path';
import * as v from 'valibot';
import { parseSync } from 'vite';
import { runCommitJobs } from './precommit-jobs.mjs';
import { readLintConfig } from './guard-counts.mjs';

/** Read Git's complete inventory without Node's implicit 1 MiB capture limit.
 * This helper never writes the index or materializes a source snapshot.
 * @param {string} root @param {string[]} args @returns {string} */
export function precommitGit(root,args) {
  return execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});
}

/** Only exact declared generated imports may be absent from a cold sealed
 * snapshot. Ordinary missing modules remain failures of the selected guard.
 * @param {string} root @param {string} guard @returns {string[]} */
export function missingInventoryGeneration(root, guard) {
  if(!existsSync(resolve(root,'scripts/source-generation-outputs.json')))return [];
  const source=v.parse(v.object({producers:v.record(v.string(),v.array(v.string()))}),JSON.parse(readFileSync(resolve(root,'scripts/source-generation-outputs.json'),'utf8')));
  const generated=new Set(Object.values(source.producers).flat());
  const parsed=parseSync(guard,readFileSync(resolve(root,guard),'utf8'));
  if(parsed.errors.length>0)throw new Error(`Invalid inventory guard: ${guard}`);
  const missing=[];
  for(const row of parsed.program.body)if(row.type==='ImportDeclaration'&&row.source.value.startsWith('.')) {
    const target=posix.normalize(posix.join(posix.dirname(guard),row.source.value));
    const file=[target,`${target}.ts`,`${target}.json`,`${target}.js`].find(name=>generated.has(name));
    if(file!==undefined&&!existsSync(resolve(root,file)))missing.push(file);
  }
  return [...new Set(missing)];
}

/** Oxlint reads ignore patterns as gitignore does: a folder with no inner slash matches at any depth (`scripts/docs/x`).
 * @param {string} file @param {string} pattern */
export function ignoredBy(file, pattern) {
  if (!pattern.endsWith('/')) return matchesGlob(file, pattern);
  const folder = pattern.slice(0, -1);
  return folder.includes('/') ? file.startsWith(pattern) : file.split('/').slice(0, -1).includes(folder);
}

/** G769/Q4: storage and staged-file typed lint only, within five seconds.
 * @param {string} [root] @param {string} [executable] */
export async function precommitInputs(root = resolve(import.meta.dirname, '..'), executable = resolve(root, 'node_modules/.bin/oxlint')) {
  const deadline = performance.now() + 5_000;
  const git = (/** @type {string[]} */ args) => precommitGit(root,args);
  const files = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']).split('\0')
    .filter(file => /\.[cm]?[jt]sx?$/u.test(file));
  const config = resolve(root, '.oxlintrc.json');
  /** @type {string[]} */
  const ignored = files.length > 0 && existsSync(config) ? readLintConfig(config).ignorePatterns ?? [] : [];
  const eligible = files.filter(file => !ignored.some(pattern => ignoredBy(file, pattern)));
  /** @type {import('./precommit-jobs.mjs').CommitJob[]} */
  const jobs = [];
  if (existsSync(resolve(root, 'scripts/repo-size.mjs'))) jobs.push({ name: 'storage', command: [process.execPath, 'scripts/repo-size.mjs', '--index'] });
  if (eligible.length > 0 && git(['diff', '--name-only', '--', ...eligible]).trim() === '')
    jobs.push({ name: 'typed lint', command: [executable, '--type-aware', '-c', '.oxlintrc.json', ...eligible] });
  else if (files.length > 0 && eligible.length === 0) console.info('pre-commit: no staged paths eligible for typed lint under the existing ignore policy');
  const results = await runCommitJobs(root, jobs, deadline);
  for (const result of results) {
    if (result.output !== '') console.error(result.output.trimEnd());
    if (result.timedOut || result.code === 124) console.warn(`pre-commit: ${result.name} unfinished; CI owns it`);
    else if (result.code !== 0) throw new Error(`${result.name}: refused`);
  }
}

if (import.meta.main) {
  try { await precommitInputs(); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
