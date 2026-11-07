#!/usr/bin/env node
// E357 F3.2 / 03 §11.3: only compare/bootstrap runs publish commit statuses.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = process.env.GITHUB_REPOSITORY ?? 'project-wildshard/engine';
const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}` : '';
/** @typedef {{ state: string, description: string }} Result */
/** @typedef {{ verdict?: string, exitCode?: number, field?: string, rows?: Report[], fields?: Report[], pending?: string[], flaked?: string[] }} Report */
/** @typedef {{ id?: number, name: string, conclusion: string | null, infrastructure?: boolean }} ActionJob */
/** @typedef {{ context: string, state: string, description: string }} Status */

/** @param {string[]} args */
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
/** @param {string} sha @param {string} context @param {Result} result @param {string} [target] */
function post(sha, context, result, target = runUrl) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('status: sha must be a full 40-hex commit');
  const args = ['api', `repos/${REPO}/statuses/${sha}`, '-f', `state=${result.state}`, '-f', `context=${context}`, '-f', `description=${result.description.slice(0, 140)}`];
  if (target) args.push('-f', `target_url=${target}`);
  gh(args);
  const summary = `**${context}**: ${result.state} — ${result.description}\n`;
  console.log(summary.trim());
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

/** @param {string} path @returns {string[]} */
function reportFiles(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const file = join(path, entry.name);
    return entry.isDirectory() ? reportFiles(file) : file.endsWith('.json') ? [file] : [];
  });
}

/** @param {string} jobStatus @param {Report[]} reports @param {string} markdown @param {string} mode @param {string} shard @returns {Result} */
export function shardResult(jobStatus, reports, markdown, mode, shard) {
  const rows = reports.flatMap((report) => report.fields ?? report.rows ?? []);
  const infrastructure = reports.some((report) => report.exitCode === 3) || /(?:exit(?: code)?[: =]+3|infrastructure|Metal required|timed out)/i.test(markdown);
  const red = rows.find((row) => row.verdict === 'red');
  if (infrastructure) return { state: 'error', description: 'infrastructure: renderer, browser or timeout' };
  if (jobStatus !== 'success' || red) return { state: 'failure', description: red?.field ?? markdown.split('\n').find((line) => /\bred\b|\bfail(?:ure)?\b/i.test(line))?.replaceAll('|', ' ').trim() ?? `job ${jobStatus}` };
  if (mode === 'bootstrap') return { state: 'success', description: `bootstrap record: commit parity-baselines-gh-macos15-${shard}` };
  const retried = reports.flatMap((report) => report.flaked ?? []);
  const pending = [...new Set(reports.flatMap((report) => report.pending ?? []))];
  return { state: 'success', description: `${retried.length > 0 ? `green (retried: ${retried.join(', ')})` : 'green'}${pending.length > 0 ? ` · pending board: ${pending.join(', ')}` : ''}` };
}

/** @param {string} results @param {ActionJob[]} jobs @param {Status[]} statuses @returns {Result} */
export function gateResult(results, jobs, statuses) {
  const all = results.split(',');
  const newest = new Map();
  for (const status of statuses) if (!newest.has(status.context)) newest.set(status.context, status);
  const shardStatuses = [...newest.values()].filter((status) => status.context.startsWith('gpu-gate/') && status.context !== 'gpu-gate/asset-case');
  const assets = newest.get('gpu-gate/asset-case');
  const badJobs = jobs.filter((job) => job.name !== 'gate' && ['failure', 'timed_out', 'cancelled', 'action_required'].includes(job.conclusion ?? ''));
  const errors = [...newest.values()].some((status) => status.context.startsWith('gpu-gate/') && status.state === 'error');
  if (errors || badJobs.some((job) => job.infrastructure === true || job.conclusion === 'timed_out' || job.conclusion === 'cancelled')) return { state: 'error', description: 'infrastructure: failed renderer, timed out or cancelled job' };
  const red = [...newest.values()].filter((status) => status.context.startsWith('gpu-gate/') && status.state !== 'success').map((status) => status.context.slice('gpu-gate/'.length));
  if (all.some((result) => result !== 'success') || red.length > 0 || badJobs.length > 0 || assets?.state !== 'success') return { state: 'failure', description: `red: ${red.length > 0 ? red.join(', ') : badJobs.map((job) => job.name).join(', ') || results}` };
  return { state: 'success', description: `${shardStatuses.length}/${shardStatuses.length} shards green · assets ok` };
}

/** @param {string[]} args */
function main(args) {
  const [command, sha = '', shardOrResults = '', jobStatusOrUrl = '', path = '', mode = 'compare'] = args;
  if (process.env.INPUT_PLANT || process.env.INPUT_PROVE === 'true' || process.env.INPUT_RECORD === 'true') throw new Error('status: plant, proof and record runs cannot post statuses');
  if (command === 'shard') {
    if (!['compare', 'bootstrap'].includes(mode)) throw new Error('status: only compare or bootstrap posts a shard status');
    if (shardOrResults === 'asset-case') {
      /** @type {{ checked: number, missing: {url: string}[] }} */
      const report = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { checked: 0, missing: [] };
      post(sha, 'gpu-gate/asset-case', { state: jobStatusOrUrl === 'success' && report.missing.length === 0 ? 'success' : 'failure', description: report.missing[0]?.url ?? (jobStatusOrUrl === 'success' ? `${report.checked} URLs checked` : `job ${jobStatusOrUrl}`) });
      return;
    }
    /** @type {Report[]} */
    const reports = reportFiles(path).map((file) => JSON.parse(readFileSync(file, 'utf8')));
    if (reports.some((report) => (report.fields ?? []).some((field) => field.verdict === 'pending')) && existsSync('pending.json')) {
      /** @type {{ id: string, shard: string }[]} */
      const pending = JSON.parse(readFileSync('pending.json', 'utf8'));
      reports.push({ pending: pending.filter((entry) => entry.shard === shardOrResults).map((entry) => entry.id) });
    }
    const markdown = existsSync(join(path, 'report.md')) ? readFileSync(join(path, 'report.md'), 'utf8') : '';
    post(sha, `gpu-gate/${shardOrResults}`, shardResult(jobStatusOrUrl, reports, markdown, mode, shardOrResults));
    return;
  }
  if (command === 'gate') {
    /** @type {{ jobs: ActionJob[] }} */
    const jobs = JSON.parse(gh(['api', `repos/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}/jobs?per_page=100`]));
    // A browser can exit 3 before it writes a report. Completed jobs' logs preserve that exit code.
    for (const job of jobs.jobs) {
      if (job.conclusion !== 'failure' || job.id === undefined) continue;
      try {
        const log = gh(['api', `repos/${REPO}/actions/jobs/${job.id}/logs`]);
        job.infrastructure = log.includes('Process completed with exit code 3.');
      } catch { /* Job results still fail closed when log download is unavailable. */ }
      const shard = /^shard \(([^,)]+)/.exec(job.name)?.[1];
      if (job.infrastructure && shard) post(sha, `gpu-gate/${shard}`, { state: 'error', description: 'infrastructure: parity exited 3' });
    }
    /** @type {Status[]} */
    const statuses = JSON.parse(gh(['api', `repos/${REPO}/commits/${sha}/statuses?per_page=100`]));
    post(sha, 'gpu-gate', gateResult(shardOrResults, jobs.jobs, statuses), jobStatusOrUrl);
    return;
  }
  throw new Error('usage: status.mjs shard <sha> <slug> <job-status> <report-path> [mode] | gate <sha> <results> <run-url>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; }
}
