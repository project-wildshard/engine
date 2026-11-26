// Meta QA 11-25 row 142: engine's nightly is on a 07:17 UTC cron that GitHub fires 7 to 11 hours late on this
// repo (every scheduled run 11-08 to 11-25 started between 14:10 and 19:14 UTC, gaps up to 28 h; pins-mirror's
// six-hourly and shard-sweep's twenty-minute crons fire two or three times a day), so a tag could meet no nightly
// newer than the day before. Three readers share one idea of "the newest release nightly" (a scheduled run, or a
// dispatched production `nightly release proof`):
//  - nightly-keeper.yml, on every push to main, dispatches a release proof when the newest started over KICK_MS ago;
//  - main-watch writes one `main NIGHTLY STALE` receipt when none started in the last STALE_MS (the alarm);
//  - TC22 (release-nightly.ts) refuses a verdict over STALE_MS old, or one off the tag's line of history.
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const KICK_MS = 20 * 60 * 60_000;
export const STALE_MS = 26 * 60 * 60_000;
export const DISPATCH = 'gh workflow run nightly -R project-wildshard/engine --ref main -f pins_channel=production';

export interface NightlyRun {id: number; head_sha: string; status: string; conclusion: string | null; event: string;
  display_title?: string; created_at?: string}

export function isReleaseNightly(run: NightlyRun | null | undefined): boolean {
  return run?.event === 'schedule' || (run?.event === 'workflow_dispatch' && run.display_title === 'nightly release proof');
}

/** The newest release nightly that ran or is running: a cancelled or skipped run never ran its heads. */
export function newestRelease(runs: readonly (NightlyRun | null)[]): NightlyRun | null {
  let newest: NightlyRun | null = null;
  for (const run of runs) {
    if (run === null || !isReleaseNightly(run) || run.conclusion === 'cancelled' || run.conclusion === 'skipped') continue;
    const at = Date.parse(run.created_at ?? '');
    if (!Number.isFinite(at)) continue;
    if (newest === null || at > Date.parse(newest.created_at ?? '')) newest = run;
  }
  return newest;
}

export function ageMs(run: NightlyRun, now: number): number {
  return now - Date.parse(run.created_at ?? '');
}

export const hours = (ms: number) => (ms / 3_600_000).toFixed(1);

/** The keeper's call: dispatch when no release nightly started (or is running) within `limit`. */
export function kickDue(runs: readonly (NightlyRun | null)[], now: number, limit = KICK_MS): {due: boolean; why: string} {
  const newest = newestRelease(runs);
  if (newest === null) return {due: true, why: 'no release nightly on main'};
  const age = ageMs(newest, now);
  const what = `release nightly ${newest.id} (${newest.event}, ${newest.status}) started ${hours(age)} h ago`;
  return age > limit ? {due: true, why: `${what}, over ${hours(limit)} h`} : {due: false, why: `${what}, within ${hours(limit)} h`};
}

/** main-watch's alarm: one receipt per stale newest run (or per "none"), never repeated while it stays stale. */
export function staleReceipt(runs: readonly (NightlyRun | null)[], now: number, receipts: string, limit = STALE_MS): string | null {
  const newest = newestRelease(runs);
  const key = newest === null ? 'newest none' : `newest ${newest.id}`;
  if (newest !== null && ageMs(newest, now) <= limit) return null;
  if (receipts.split('\n').some(line => line.includes('main NIGHTLY STALE') && line.includes(`${key} `))) return null;
  const since = newest === null ? 'no release nightly on main' : `started ${hours(ageMs(newest, now))} h ago at ${newest.created_at} on ${newest.head_sha.slice(0, 10)}`;
  return `main NIGHTLY STALE ${key} (${since}): no release nightly in the last ${hours(limit)} h, so TC22 holds the next tag;`
    + ` nightly-keeper.yml should have dispatched one (meta QA 11-25 row 142). Dispatch: ${DISPATCH}`;
}

function liveRuns(repo: string): NightlyRun[] {
  return JSON.parse(execFileSync('gh', ['api', `repos/${repo}/actions/workflows/nightly.yml/runs?branch=main&per_page=50`,
    '--jq', '.workflow_runs | map({id, head_sha, status, conclusion, event, display_title, created_at})'],
  {encoding: 'utf8', timeout: 30_000, maxBuffer: 4 << 20})) as NightlyRun[];
}

/** `kick` (nightly-keeper.yml): dispatch a release proof when due. `check`: print the newest one's age. */
export function main(argv: readonly string[], env = process.env, now = Date.now()): void {
  const mode = argv[0], repo = env.GITHUB_REPOSITORY ?? 'project-wildshard/engine';
  if (mode !== 'kick' && mode !== 'check') throw new Error('Use nightly-keeper.ts kick|check');
  const verdict = kickDue(liveRuns(repo), now);
  console.log(`nightly-keeper: ${verdict.why}`);
  if (mode === 'check' || !verdict.due) return;
  execFileSync('gh', ['workflow', 'run', 'nightly.yml', '-R', repo, '--ref', 'main', '-f', 'pins_channel=production'], {stdio: 'inherit', timeout: 30_000});
  // Runs of this keeper queue one at a time: hold until the dispatch is listed, so the next push's keeper sees it.
  for (let tries = 0; tries < 12; tries += 1) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
    if (!kickDue(liveRuns(repo), Date.now()).due) {console.log('nightly-keeper: dispatched a nightly release proof on main'); return;}
  }
  console.log('nightly-keeper: dispatched; not listed after 60 s');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2));
