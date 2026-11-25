// Meta QA 11-25 row 61: a shard publish records its tag and gets its engine pin with no hand step.
//
// A shard repo's publish.yml cannot do either alone. Its record job pushes the tag with GITHUB_TOKEN, which GitHub
// refuses when the built commit's workflows differ from main's (Pine r18: a kit sync changed publish.yml during the
// run). Its pin request needs the nightly app's key, which by design lives only on engine (meta SHARD-PUBLISH-ACTIONS,
// context 5), so the request was skipped without a word. Engine holds that key, so engine sweeps: each shard repo's
// published.json names what it published (slug, revision, hash, channel, built commit); this tags the built commit
// where the tag is missing and starts shard-pin.yml for a revision engine has not pinned and no pin run has tried.
// .github/workflows/shard-sweep.yml runs it on a schedule; it is safe to run any time, because each step checks first.
//
//   node scripts/shard-sweep.mjs [--dry-run]     (GH_TOKEN: the nightly app's token; GITHUB_TOKEN dispatches shard-pin)
import {execFileSync} from 'node:child_process';
import {appendFileSync, readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const ORG = 'project-wildshard';
const CHANNELS = new Set(['staging', 'prod']);

/** @typedef {{slug: string, revision: number, hash: string, channel: string, commit?: string}} Published */
/** @typedef {{repo: string, rows: Published[], tags: Map<string, string>}} ShardRepo tags: tag name -> commit sha */
/** @typedef {{kind: 'pin', slug: string, revision: number, hash: string, channel: string}
 *   | {kind: 'tag', repo: string, tag: string, commit: string}} Action */

/** published.json's rows, each with its slug. @param {unknown} json @returns {Published[]} */
export function publishedRows(json) {
  if (json === null || typeof json !== 'object') return [];
  /** @type {Published[]} */ const rows = [];
  for (const [slug, row] of Object.entries(json)) {
    if (row === null || typeof row !== 'object') continue;
    const {revision, hash, channel, commit} = /** @type {Record<string, unknown>} */ (row);
    if (typeof revision !== 'number' || typeof hash !== 'string' || typeof channel !== 'string') continue;
    rows.push({slug, revision, hash, channel, ...(typeof commit === 'string' && /^[0-9a-f]{40}$/u.test(commit) ? {commit} : {})});
  }
  return rows;
}

/** The tag a published revision gets, as publish-shard.mjs's record names it: r<N>, or <slug>-r<N> when r<N> already
 * names another commit. Undefined when the right one exists. @param {Published} row @param {Map<string, string>} tags */
export function missingTag(row, tags) {
  if (row.commit === undefined) return undefined;
  const plain = `r${String(row.revision)}`, named = `${row.slug}-${plain}`;
  if (tags.get(plain) === row.commit || tags.has(named)) return undefined;
  return tags.has(plain) ? named : plain;
}

/**
 * What the sweep does, and why it leaves the rest. Pure: every read is passed in.
 * @param {{repos: ShardRepo[], pins: Map<string, number>, branches: Set<string>, runs: Map<string, string>}} state
 *   pins: slug -> engine main's pinned revision; branches: engine branch names; runs: shard-pin run title -> conclusion
 * @returns {{actions: Action[], notes: string[]}}
 */
export function sweepPlan({repos, pins, branches, runs}) {
  /** @type {Action[]} */ const actions = [];
  /** @type {string[]} */ const notes = [];
  for (const {repo, rows, tags} of repos) {
    for (const row of rows) {
      const name = `${row.slug} r${String(row.revision)}`;
      const tag = missingTag(row, tags);
      if (tag !== undefined && row.commit !== undefined) actions.push({kind: 'tag', repo, tag, commit: row.commit});
      if (!CHANNELS.has(row.channel)) { notes.push(`${name}: channel ${row.channel} is not pinned (J453 test shards stay off the grid)`); continue; }
      const pinned = pins.get(row.slug);
      if (pinned === undefined) { notes.push(`${name}: engine pins no ${row.slug} yet; a first pin is a choice (shard-pin.yml first=true, meta MZ26)`); continue; }
      if (pinned >= row.revision) continue;
      if (branches.has(`plan/pin-${row.slug}-r${String(row.revision)}`)) { notes.push(`${name}: plan/pin-${row.slug}-r${String(row.revision)} waits to land`); continue; }
      const tried = runs.get(`shard-pin ${name}`);
      if (tried !== undefined) { notes.push(`${name}: shard-pin already ran (${tried || 'running'}); not started again`); continue; }
      actions.push({kind: 'pin', slug: row.slug, revision: row.revision, hash: row.hash, channel: row.channel});
    }
  }
  return {actions, notes};
}

/** @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
function gh(args, env = process.env) {
  return execFileSync('gh', args, {encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe']});
}

/** @param {string} repo @returns {unknown} published.json at the default branch, or undefined when it has none */
function readPublished(repo) {
  try {
    return JSON.parse(gh(['api', '-H', 'Accept: application/vnd.github.raw+json', `repos/${ORG}/${repo}/contents/published.json`]));
  } catch {
    return undefined;
  }
}

/** @param {string} repo @param {Published[]} rows @returns {Map<string, string>} */
function readTags(repo, rows) {
  /** @type {Map<string, string>} */ const tags = new Map();
  for (const row of rows) {
    for (const name of [`r${String(row.revision)}`, `${row.slug}-r${String(row.revision)}`]) {
      const out = gh(['api', `repos/${ORG}/${repo}/git/matching-refs/tags/${name}`, '--jq', '.[] | [.ref, .object.sha, .object.type] | @tsv']);
      for (const line of out.split('\n').filter(Boolean)) {
        const [ref = '', sha = '', type = ''] = line.split('\t');
        if (ref !== `refs/tags/${name}`) continue;
        // An annotated tag points at a tag object; its commit is one more read.
        tags.set(name, type === 'tag' ? gh(['api', `repos/${ORG}/${repo}/git/tags/${sha}`, '--jq', '.object.sha']).trim() : sha);
      }
    }
  }
  return tags;
}

/** @returns {{repos: ShardRepo[], pins: Map<string, number>, branches: Set<string>, runs: Map<string, string>}} */
function readState() {
  const names = gh(['api', '--paginate', `orgs/${ORG}/repos`, '--jq', '.[] | select(.archived | not) | .name']).split('\n')
    .filter(name => name.startsWith('shard-') && name !== 'shard-format');
  /** @type {ShardRepo[]} */ const repos = [];
  for (const repo of names) {
    const rows = publishedRows(readPublished(repo));
    if (rows.length > 0) repos.push({repo, rows, tags: readTags(repo, rows)});
  }
  const shardfiles = /** @type {{shards: {slug: string, revision: number}[]}} */ (JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')));
  const pins = new Map(shardfiles.shards.map(pin => [pin.slug, pin.revision]));
  const branches = new Set(execFileSync('git', ['ls-remote', '--heads', 'origin', 'plan/pin-*'], {encoding: 'utf8'}).split('\n')
    .map(line => line.split('\t')[1]?.replace(/^refs\/heads\//u, '') ?? '').filter(Boolean));
  const dispatch = {...process.env, GH_TOKEN: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN};
  const listed = /** @type {{displayTitle: string, conclusion: string}[]} */ (JSON.parse(gh(['run', 'list', '--workflow', 'shard-pin.yml',
    '--limit', '200', '--json', 'displayTitle,conclusion'], dispatch)));
  const runs = new Map(listed.map(run => [run.displayTitle, run.conclusion]));
  return {repos, pins, branches, runs};
}

/** @param {Action} action */
function apply(action) {
  if (action.kind === 'tag') {
    gh(['api', '--method', 'POST', `repos/${ORG}/${action.repo}/git/refs`, '-f', `ref=refs/tags/${action.tag}`, '-f', `sha=${action.commit}`]);
    return `${action.repo}: tagged ${action.commit.slice(0, 10)} ${action.tag}`;
  }
  gh(['workflow', 'run', 'shard-pin.yml', '-f', `slug=${action.slug}`, '-f', `revision=${String(action.revision)}`,
    '-f', `hash=${action.hash}`, '-f', `channel=${action.channel}`], {...process.env, GH_TOKEN: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN});
  return `${action.slug} r${String(action.revision)}: shard-pin started (${action.channel})`;
}

function main() {
  const dry = process.argv.includes('--dry-run');
  const {actions, notes} = sweepPlan(readState());
  const lines = [...actions.map(action => dry ? `would: ${JSON.stringify(action)}` : apply(action)), ...notes];
  if (lines.length === 0) lines.push('every published revision is tagged and pinned, or waits on its pin run');
  for (const line of lines) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.map(line => `- ${line}`).join('\n')}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
