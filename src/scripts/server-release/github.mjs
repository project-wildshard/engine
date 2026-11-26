// Privileged workflow entry: release-branch CI and reachable version tags only.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import * as v from 'valibot';
import { COMMIT } from './sign.mjs';

const REPOSITORY = 'project-wildshard/engine', VERSION = /^v\d+\.\d+\.\d+$/u, RELEASE_BRANCH = /^release\/v\d+\.\d+\.\d+$/u;
const Run = v.object({ id: v.number(), head_sha: v.string(), head_branch: v.nullable(v.string()), event: v.string(), status: v.string(), conclusion: v.nullable(v.string()) });
const Release = v.object({ id: v.number(), upload_url: v.string(), assets: v.array(v.object({ name: v.string(), browser_download_url: v.string() })) });
class GitHubError extends Error {
  /** @param {number} status @param {string} operation */
  constructor(status, operation) { super(`GitHub ${operation} failed (${String(status)})`); this.name = 'GitHubError'; this.status = status; }
}
/** @param {string} path @param {RequestInit} [options] @returns {Promise<unknown>} */
async function api(path, options = {}) {
  const token = process.env.GH_TOKEN; if (token === undefined || token === '') throw new Error('Missing GH_TOKEN');
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/vnd.github+json'); headers.set('Authorization', `Bearer ${token}`); headers.set('X-GitHub-Api-Version', '2022-11-28');
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/${path}`, { ...options, headers });
  if (!response.ok) throw new GitHubError(response.status, `${options.method ?? 'GET'} ${path}`);
  return response.json();
}
/** @param {string[]} args @returns {string} */
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();

/** No fork or PR event is allowed to reach a signing job. @returns {{sha: string, channel: string, tag: string, branches: string[], align?: true, legacy?: true} | null} */
function candidate() {
  if (process.env.GITHUB_REPOSITORY !== REPOSITORY) return null;
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (eventName === 'workflow_dispatch') {
    // A staging alignment: a person names an exact green main build whose packs are published, newer than staging's (J234).
    const sha = process.env.ALIGN_BUILD ?? '';
    if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Staging alignment runs from main only');
    if (!COMMIT.test(sha)) throw new Error('Staging alignment needs a full 40-character build SHA');
    const branches = git(['for-each-ref', '--format=%(refname:short)', '--contains', sha, 'refs/remotes/origin/release/']).split('\n')
      .map(ref => ref.replace(/^origin\//u, '')).filter(ref => RELEASE_BRANCH.test(ref) && git(['rev-parse', `refs/remotes/origin/${ref}^{commit}`]) === sha);
    if (branches.length === 0) {
      const prepared = publishedMainRelease(sha);
      if (prepared === null) throw new Error('Staging alignment needs a published release-branch build');
      return { sha, channel: 'staging', tag: `server-staging-${sha}`, branches: [`release/${prepared}`, 'main'], align: true, legacy: true };
    }
    return { sha, channel: 'staging', tag: `server-staging-${sha}`, branches, align: true };
  }
  if (eventName === 'workflow_run') {
    const event = v.parse(v.object({ workflow_run: v.object({ ...Run.entries, head_repository: v.object({ full_name: v.string() }) }) }), JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8'))).workflow_run;
    if (event.event !== 'push' || !RELEASE_BRANCH.test(event.head_branch ?? '') || event.head_repository.full_name !== REPOSITORY || event.conclusion !== 'success') return null;
    if (!COMMIT.test(event.head_sha)) throw new Error('Invalid green source SHA');
    return { sha: event.head_sha, channel: 'staging', tag: `server-staging-${event.head_sha}`, branches: [event.head_branch ?? ''] };
  }
  if (eventName === 'push') {
    const tag = process.env.GITHUB_REF_NAME ?? '';
    if (process.env.GITHUB_REF_TYPE !== 'tag' || !VERSION.test(tag)) return null;
    const sha = git(['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
    if (!COMMIT.test(sha)) throw new Error('Invalid tagged source SHA');
    return { sha, channel: 'production', tag, branches: [`release/${tag}`, 'main'] };
  }
  return null;
}

/** Whether this published ref contains the source. Missing release refs are expected after merge-back.
 * @param {string} sha @param {string} branch */
function reachable(sha, branch) {
  try { git(['merge-base', '--is-ancestor', sha, `refs/remotes/origin/${branch}`]); return true; }
  catch { return false; }
}

/** Let a release already prepared on main finish through explicit alignment.
 * Ordinary main CI events never enter this path. @param {string} sha @returns {string | null} */
function publishedMainRelease(sha) {
  if (!reachable(sha, 'main')) return null;
  try {
    const tag = /^chore\(release\): (v\d+\.\d+\.\d+)$/u.exec(git(['log', '-1', '--format=%s', sha]))?.[1];
    return tag !== undefined && JSON.parse(git(['show', `${sha}:package.json`])).version === tag.slice(1) ? tag : null;
  } catch { return null; }
}

/** Exact-SHA push CI on an admitted branch; PRs and plan branches cannot authorize a release.
 * @param {string} sha @param {string[]} branches @returns {Promise<'green' | 'pending' | 'red'>} */
async function checks(sha, branches) {
  const value = await api(`actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=100`);
  const rows = v.parse(v.object({ workflow_runs: v.array(Run) }), value).workflow_runs
    .filter(run => run.head_sha === sha && branches.includes(run.head_branch ?? '') && run.event === 'push').sort((a, b) => b.id - a.id);
  const latest = branches.flatMap(branch => { const row = rows.find(run => run.head_branch === branch); return row === undefined ? [] : [row]; });
  if (latest.some(run => run.status === 'completed' && run.conclusion === 'success')) return 'green';
  if (latest.length === 0 || latest.some(run => run.status !== 'completed')) return 'pending';
  return 'red';
}

/** @returns {Promise<void>} */
async function select() {
  const source = candidate(); if (source === null) return;
  if (source.channel === 'staging' && source.legacy !== true && !source.branches.some(branch => {
    try { return git(['rev-parse', '--verify', `refs/remotes/origin/${branch}^{commit}`]) === source.sha; } catch { return false; }
  })) {
    if (source.align === true) throw new Error('Staging alignment needs the current release-branch head');
    return; // A delayed CI event must not publish an older release-branch head.
  }
  const published = source.branches.some(branch => reachable(source.sha, branch));
  if (!published) throw new Error('Release source is unreachable from its published release branch or main');
  // A completed release keeps its exact-SHA branch proof after merge-back deletes the branch.
  const proofBranches = source.channel === 'production' || source.legacy === true ? source.branches : source.branches.filter(branch => reachable(source.sha, branch));
  // A late workflow_run from before this producer existed is not a release candidate.
  if (execFileSync('git', ['ls-tree', '--name-only', source.sha, 'src/scripts/server-release/publish.mjs'], { encoding: 'utf8' }).trim() === '') return;
  const deadline = Date.now() + 40 * 60_000;
  for (;;) {
    const state = await checks(source.sha, proofBranches);
    if (state === 'green') break;
    if (source.align === true) throw new Error(`Build ${source.sha} is not green on release-branch CI and Ring 1`);
    if (state === 'red') { if (source.channel === 'staging') return; throw new Error('Tagged commit has a failed release CI workflow'); }
    if (source.channel === 'staging') return; // The other workflow's completion will trigger again.
    if (Date.now() >= deadline) throw new Error('Timed out waiting for tagged release CI');
    await sleep(20_000);
  }
  const output = process.env.GITHUB_OUTPUT; if (output === undefined) throw new Error('Missing GITHUB_OUTPUT');
  appendFileSync(output, `ready=true\nsha=${source.sha}\nchannel=${source.channel}\ntag=${source.tag}\nalign=${String(source.align === true)}\n`);
}

const TagReference = v.object({ object: v.object({ type: v.string(), sha: v.string() }) });
/** @param {string} tag @param {string} sha */
async function verifyReleaseTag(tag, sha) {
  let object = v.parse(TagReference, await api(`git/ref/tags/${encodeURIComponent(tag)}`)).object;
  for (let depth = 0; object.type === 'tag' && depth < 5; depth++) object = v.parse(TagReference, await api(`git/tags/${object.sha}`)).object;
  if (object.type !== 'commit' || object.sha !== sha) throw new Error('GitHub release tag names another commit');
}

/** C25: bind an immutable asset to the exact tag. Existing bytes must match; never clobber.
 * @param {string} tag @param {string} sha @param {string} archive @param {string} channel @returns {Promise<void>} */
async function asset(tag, sha, archive, channel) {
  if (!COMMIT.test(sha) || !(VERSION.test(tag) && channel === 'production' || tag === `server-staging-${sha}` && channel === 'staging')) throw new Error('Invalid server release tag');
  if (git(['rev-parse', 'HEAD']) !== sha) throw new Error('Bundle checkout differs from release source');
  const releaseBranches = channel === 'production' ? [`release/${tag}`] : git(['for-each-ref', '--format=%(refname:short)', '--contains', sha, 'refs/remotes/origin/release/']).split('\n').map(ref => ref.replace(/^origin\//u, '')).filter(ref => RELEASE_BRANCH.test(ref));
  const legacy = channel === 'staging' && publishedMainRelease(sha) !== null;
  if ((channel === 'production' || legacy ? [...releaseBranches, 'main'] : releaseBranches).every(branch => !reachable(sha, branch))) throw new Error('Server asset source is unreachable from release history');
  if (channel === 'staging' && !legacy && !releaseBranches.some(branch => git(['rev-parse', `refs/remotes/origin/${branch}^{commit}`]) === sha)) throw new Error('Staging asset must name the current release-branch head');
  /** @type {v.InferOutput<typeof Release>} */
  let release;
  try { release = v.parse(Release, await api(`releases/tags/${encodeURIComponent(tag)}`)); }
  catch (error) {
    if (!(error instanceof GitHubError && error.status === 404)) throw error;
    // Production already has an exact, checked version tag. Supplying the
    // older SHA as target_commitish asks GitHub to check workflow-write scope
    // when main's workflow files have moved. Staging still creates its own tag.
    if (channel === 'production') await verifyReleaseTag(tag, sha);
    release = v.parse(Release, await api('releases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      tag_name: tag, ...(channel === 'staging' ? { target_commitish: sha } : {}),
      name: `Dedicated server ${tag}`, draft: false, prerelease: channel === 'staging', make_latest: 'false',
    }) }));
  }
  await verifyReleaseTag(tag, sha);
  const name = basename(archive), bytes = readFileSync(archive), digest = createHash('sha256').update(bytes).digest('hex'), existing = release.assets.find(row => row.name === name);
  if (existing !== undefined) {
    const response = await fetch(existing.browser_download_url); if (!response.ok) throw new Error('Cannot verify existing server asset');
    if (createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex') !== digest) throw new Error('Existing server asset differs; refusing overwrite');
    return;
  }
  const token = process.env.GH_TOKEN; if (token === undefined || token === '') throw new Error('Missing GH_TOKEN');
  const upload = new URL(release.upload_url.replace(/\{.*$/u, '')); upload.searchParams.set('name', name);
  if (upload.origin !== 'https://uploads.github.com') throw new Error('Unexpected GitHub asset upload origin');
  const response = await fetch(upload, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/gzip' }, body: bytes });
  if (!response.ok) throw new GitHubError(response.status, 'release asset upload');
  console.log(JSON.stringify({ tag, asset: name, sha256: digest }));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, tag = '', sha = '', archive = '', channel = ''] = process.argv.slice(2);
    if (command === 'select') await select();
    else if (command === 'asset') await asset(tag, sha, archive, channel);
    else throw new Error('Expected select or asset');
  } catch (error) { console.error(error instanceof Error ? error.message : 'GitHub server release failed'); process.exitCode = 1; }
}
