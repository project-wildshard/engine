#!/usr/bin/env node
// PREVIEW-CD PCD3 (docs/plans/opus-2026-11-12-preview-cd.md): the watchdog for preview's hourly deploy. preview.yml runs
// on every green main ci and ends early inside the hour (Jake, 2026-11-12), so a green main that lands inside the hour and
// is the last push for a while stays undeployed until the next green ci. This finds the oldest green main push ci run
// whose commit is newer than the live preview's and changes a client input (preview.yml's own `inputs=(...)` list); when
// that run finished more than 75 minutes ago, preview is behind: it checks in `error` to the Sentry Crons monitor
// `preview-lag` (project wildshard-game, notifications off, J252) and dispatches preview.yml, unless a preview run is
// already queued or running. Otherwise it checks in `ok`. Run hourly by the coordinator's tick; a missed hour shows in
// Sentry as `missed`.
//
//   node scripts/preview-lag.mjs [--dry-run]     prints the verdict; --dry-run checks in and dispatches nothing
//
// Exit 0 when current or within 75 minutes, 1 when behind (after the dispatch), 2 when it could not tell.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const REPO = 'project-wildshard/engine';
const LIVE = 'https://preview.wildshard.io/version.json';
const LIMIT_MINUTES = 75;
// wildshard-game's public DSN, the one the page itself sends with (src/client/engine/telemetry/browserErrors.ts)
const DSN = 'https://ccaf25bcd6baa389433fb9efe0117c9b@o4512161165410304.ingest.us.sentry.io/4512161184088064';
const MONITOR = 'preview-lag';
const dryRun = process.argv.includes('--dry-run');

const run = (/** @type {string} */ cmd, /** @type {string[]} */ args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const git = (/** @type {string[]} */ args) => run('git', args);
const gitOk = (/** @type {string[]} */ args) => { try { git(args); return true; } catch { return false; } };

/** preview.yml's client inputs, so the watchdog and the deploy agree on what "changed" means */
function clientInputs() {
  const found = /inputs=\(([^)]*)\)/u.exec(readFileSync('.github/workflows/preview.yml', 'utf8'));
  if (found?.[1] === undefined) throw new Error('preview.yml has no inputs=(...) list');
  return found[1].trim().split(/\s+/u);
}

/** @param {'ok'|'error'} status */
async function checkIn(status) {
  const url = new URL(DSN);
  const endpoint = `https://${url.host}/api${url.pathname}/cron/${MONITOR}/${url.username}/`;
  const body = { status, monitor_config: { schedule: { type: 'interval', value: 1, unit: 'hour' }, checkin_margin: 15, max_runtime: 10, timezone: 'America/Cancun' } };
  try {
    const answer = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    console.log(`sentry ${MONITOR}: ${status} (${String(answer.status)})`);
  } catch (error) { console.log(`sentry ${MONITOR}: check-in failed (${String(error)})`); }
}

async function main() {
  const version = /** @type {{build?: unknown, describe?: unknown}} */ (await (await fetch(`${LIVE}?t=${String(Date.now())}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) })).json());
  const build = typeof version.build === 'string' ? version.build : '';
  const live = build.split('-')[0] ?? '';
  if (!/^[0-9a-f]{7,40}$/u.test(live)) { console.error(`preview-lag: the live build '${build}' names no commit`); return 2; }
  git(['fetch', '-q', 'origin', 'main']);
  if (!gitOk(['cat-file', '-e', `${live}^{commit}`])) { console.error(`preview-lag: ${live} is not on origin/main`); return 2; }
  const runs = /** @type {{headSha: string, updatedAt: string}[]} */ (JSON.parse(run('gh', ['run', 'list', '-R', REPO, '--workflow', 'ci.yml', '--branch', 'main', '--event', 'push', '--status', 'success', '--limit', '40', '--json', 'headSha,updatedAt'])));
  const inputs = clientInputs();
  // oldest first: the first green commit past the live one that the deploy would ship
  const behind = runs.reverse().find(r => !r.headSha.startsWith(live) && gitOk(['merge-base', '--is-ancestor', live, r.headSha])
    && !gitOk(['diff', '--quiet', live, r.headSha, '--', ...inputs]));
  const label = `live ${live.slice(0, 8)}${typeof version.describe === 'string' ? ` (${version.describe})` : ''}`;
  if (behind === undefined) {
    console.log(`preview-lag: ${label} is current with green main's client inputs`);
    if (!dryRun) await checkIn('ok');
    return 0;
  }
  const minutes = Math.floor((Date.now() - Date.parse(behind.updatedAt)) / 60_000);
  if (minutes <= LIMIT_MINUTES) {
    console.log(`preview-lag: ${label}; green ${behind.headSha.slice(0, 8)} waits ${String(minutes)} min (limit ${String(LIMIT_MINUTES)})`);
    if (!dryRun) await checkIn('ok');
    return 0;
  }
  console.log(`preview-lag: BEHIND: ${label}; green ${behind.headSha.slice(0, 8)} went green ${String(minutes)} min ago (limit ${String(LIMIT_MINUTES)})`);
  if (dryRun) return 1;
  await checkIn('error');
  const busy = /** @type {unknown[]} */ (JSON.parse(run('gh', ['run', 'list', '-R', REPO, '--workflow', 'preview.yml', '--limit', '5', '--json', 'status', '--jq', '[.[] | select(.status != "completed")]'])));
  if (busy.length > 0) console.log('preview-lag: a preview run is already queued or running: no dispatch');
  else { run('gh', ['workflow', 'run', 'preview.yml', '-R', REPO]); console.log('preview-lag: dispatched preview.yml'); }
  return 1;
}

process.exitCode = await main().catch((/** @type {unknown} */ error) => { console.error(`preview-lag: ${String(error)}`); return 2; });
