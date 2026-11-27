// Meta QA 11-25 row 135 (J505 guard): row 135 deleted ADMIN_TOKEN from the `production` environment while the v0.1.97
// train was mid-flight. Its release branch still read that secret in the production-pointers job, so the job would go
// red after the production publish. A GitHub Actions secret is read by the workflow files at the ref that runs, not by
// main's, so a secret can only go once nothing still to run reads it.
//
// This is the one way an engine secret leaves GitHub (meta's .agents/hooks/secret-delete-guard.mjs refuses a bare
// `gh secret delete` on engine). It lists every ref that can still run a workflow: main, and each release/vX.Y.Z
// branch or vX.Y.Z tag newer than the version production plays (production.json's engineBuild). It refuses,
// naming them, while any of those refs' .github/workflows reads `secrets.<NAME>`; otherwise it deletes the secret.
//
//   node src/scripts/server-release/secret-remove.mjs <NAME> [--env <environment>] [--check]
//
// --check lists the readers and deletes nothing. Every read of the packs host carries the agent marker.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { agentFetch } from '../agent-requests.mjs';

export const REPOSITORY = 'project-wildshard/engine';
const RELEASES = 'https://releases.wildshard.io';
const VERSION = /^v(\d+)\.(\d+)\.(\d+)$/u;
const NAME = /^[A-Z][A-Z0-9_]*$/u;

/** @typedef {{ref: string, version?: string, commit: string}} RunnableRef */
/** @typedef {{ref: string, file: string}} SecretReader */

/** -1, 0 or 1 by semver. @param {string} left @param {string} right */
export function compareVersions(left, right) {
  const [a, b] = [VERSION.exec(left), VERSION.exec(right)];
  if (a === null || b === null) throw new Error(`not a vX.Y.Z version: ${a === null ? left : right}`);
  for (const index of [1, 2, 3]) {
    const diff = Number(a[index]) - Number(b[index]);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

/** Remote refs from `git ls-remote` output: tags peeled to their commit. @param {string} text @returns {RunnableRef[]} */
export function parseRemoteRefs(text) {
  /** @type {Map<string, RunnableRef>} */
  const refs = new Map();
  for (const line of text.split('\n')) {
    const [commit, name] = line.trim().split(/\s+/u);
    if (commit === undefined || name === undefined) continue;
    const peeled = name.endsWith('^{}');
    const ref = peeled ? name.slice(0, -3) : name;
    const version = /^refs\/(?:tags|heads\/release)\/(v\d+\.\d+\.\d+)$/u.exec(ref)?.[1];
    if (ref !== 'refs/heads/main' && version === undefined) continue;
    if (peeled || !refs.has(ref)) refs.set(ref, { ref, commit, ...(version === undefined ? {} : { version }) });
  }
  return [...refs.values()];
}

/** The refs that can still run a workflow: main, and every version ref newer than the version production plays.
 * Production's version is the newest version ref at its build; none there fails closed, since nothing says which
 * trains are still in flight. @param {readonly RunnableRef[]} refs @param {string} productionBuild @returns {RunnableRef[]} */
export function runnableRefs(refs, productionBuild) {
  const live = refs.filter(one => one.version !== undefined && one.commit === productionBuild)
    .map(one => /** @type {string} */ (one.version)).sort(compareVersions).at(-1);
  if (live === undefined) throw new Error(`no release tag or branch is at production's build ${productionBuild.slice(0, 12)}: cannot tell which trains are in flight`);
  return refs.filter(one => one.version === undefined || compareVersions(one.version, live) > 0);
}

/** Every workflow that reads `secrets.<name>`. @param {string} name @param {readonly {ref: string, file: string, text: string}[]} workflows
 * @returns {SecretReader[]} */
export function secretReaders(name, workflows) {
  const reads = new RegExp(`secrets\\.${name}\\b`, 'u');
  return workflows.filter(one => reads.test(one.text)).map(({ ref, file }) => ({ ref, file }));
}

/** @typedef {{git?: (args: string[]) => string, productionBuild?: () => Promise<string>, gh?: (args: string[]) => void, log?: (line: string) => void}} RemoveDeps */

/** @param {string[]} args */
const runGit = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** production.json's engineBuild. */
async function liveBuild() {
  const answer = await agentFetch(`${RELEASES}/production.json`, { cache: 'no-store', signal: AbortSignal.timeout(60_000) });
  if (!answer.ok) throw new Error(`production.json: HTTP ${answer.status}`);
  const signed = /** @type {{body?: unknown}} */ (await answer.json());
  const body = typeof signed.body === 'string' ? JSON.parse(signed.body) : undefined;
  if (typeof body?.engineBuild !== 'string') throw new Error('production.json names no engineBuild');
  return body.engineBuild;
}

/** The workflows at each runnable ref, read from origin without moving a local ref. @param {(args: string[]) => string} git
 * @param {readonly RunnableRef[]} refs */
function workflowsAt(git, refs) {
  git(['fetch', '--quiet', '--no-tags', 'origin', ...refs.map(one => one.commit)]);
  return refs.flatMap(one => git(['ls-tree', '--name-only', `${one.commit}:.github/workflows`]).split('\n')
    .filter(file => /\.ya?ml$/u.test(file))
    .map(file => ({ ref: one.ref.replace(/^refs\/(?:heads|tags)\//u, ''), file, text: git(['show', `${one.commit}:.github/workflows/${file}`]) })));
}

/** Refuse while a runnable ref reads the secret; otherwise delete it. @param {string} name @param {{env?: string, check?: boolean}} options
 * @param {RemoveDeps} [deps] @returns {Promise<SecretReader[]>} the readers (empty when it was deleted or would be) */
export async function removeSecret(name, options, deps = {}) {
  if (!NAME.test(name)) throw new Error(`not a secret name: ${name}`);
  const git = deps.git ?? runGit, log = deps.log ?? console.log;
  const refs = runnableRefs(parseRemoteRefs(git(['ls-remote', 'origin', 'refs/heads/main', 'refs/heads/release/*', 'refs/tags/v*'])),
    await (deps.productionBuild ?? liveBuild)());
  const readers = secretReaders(name, workflowsAt(git, refs));
  const where = options.env === undefined ? 'the repository' : `environment ${options.env}`;
  if (readers.length > 0) {
    throw new Error(`${name} stays in ${where}: ${readers.map(one => `${one.ref} ${one.file}`).join(', ')} still read it. `
      + 'Land the workflow change, let every train listed promote (or retire its branch), then run this again.');
  }
  if (options.check === true) {
    log(`${name}: no runnable ref reads it (${refs.map(one => one.ref.replace(/^refs\/(?:heads|tags)\//u, '')).join(', ')}); free to remove from ${where}`);
    return readers;
  }
  const gh = deps.gh ?? (args => execFileSync('gh', args, { stdio: 'inherit' }));
  gh(['secret', 'delete', name, '-R', REPOSITORY, ...(options.env === undefined ? [] : ['--env', options.env])]);
  log(`${name} removed from ${where}; no runnable ref read it`);
  return readers;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { env: { type: 'string' }, check: { type: 'boolean', default: false } } });
  const [name] = positionals;
  if (name === undefined || positionals.length !== 1) throw new Error('usage: secret-remove.mjs <NAME> [--env <environment>] [--check]');
  await removeSecret(name, { ...(values.env === undefined ? {} : { env: values.env }), check: values.check });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); }
  catch (error) { console.error(error instanceof Error ? error.message : 'secret removal failed'); process.exitCode = 1; }
}
