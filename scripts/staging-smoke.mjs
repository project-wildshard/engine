#!/usr/bin/env node
// Meta STAGING-SMOKE (J398, Jake 2026-11-17: "we should do this kind of stuff in an automated e2e test fashion for like every
// staging release of the engine"): every staging engine release replays the phone QA session of the "Game Right Now" board,
// cut by the SM0 audit to five scenarios (K1 to K5, scenarios.mjs), about 6 minutes a run.
//
//   node scripts/staging-smoke.mjs --url <candidate> --release vX.Y.Z [--only K3[,K4]] [--out <dir>] [--card <slug>]
//        [--deeplink <slug>] [--watch <s>] [--store <dir>] [--changelog <CHANGELOG.md>] [--no-vision]
//
// Headless and muted, WebKit at 402x874 (iPhone 17 Pro) with touch, Chromium only for K1; one browser at a time; rAF capped at
// 60 fps; one clip per scenario. Only GETs leave the page. The hard checks (checks.mjs) give each finding a severity; a P0
// or P1 sets `hold` (production go-live refuses, SM5) and the exit code to 1.
// Output: <out>/<K>/ (frames, clip), <out>/verdict.json (build, release, scenarios[].checks[], findings[], hold).
//
// THE BAR FOR A NEW SCENARIO (SM8, bang for buck): a new bug becomes a scenario only if
//   (a) it is P0 or P1,
//   (b) no kept scenario's hard check (checks.mjs) or vision pass would have caught it,
//   (c) the T1 suite (src/e2e/t1) or the J386 gate (verify-staging.sh) cannot hold it, and
//   (d) it adds at most 45 s, keeping the whole run under 10 minutes.
// Otherwise it becomes a hard check in an existing scenario, or an engine T1 test.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SCENARIOS, runScenario } from './staging-smoke/scenarios.mjs';
import { holds, verdictOf, worstFirst } from './staging-smoke/checks.mjs';
import { keepRun, lastRelease, STORE } from './staging-smoke/store.mjs';
import { changelogBullets, visionFindings, visionPass } from './staging-smoke/vision.mjs';

/** The whole run's budget (SM8 (d)): over this the runner warns. */
export const RUN_BUDGET_S = 600;

/** @param {readonly string[]} argv @returns {Map<string, string>} */
export function parseArgs(argv) {
  /** @type {Map<string, string>} */
  const args = new Map();
  for (let i = 0; i < argv.length; i++) {
    const key = (argv[i] ?? '').replace(/^--/u, ''), next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { args.set(key, next); i++; } else args.set(key, 'true');
  }
  return args;
}

/** What the candidate's /version.json says, or {} when it has none.
 * @param {string} url @returns {Promise<{ build?: string, describe?: string, clientVersion?: string, minClient?: string }>} */
export async function served(url) {
  try { return await (await fetch(`${url}/version.json`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) })).json(); } catch { return {}; }
}

/**
 * Run the smoke and write <out>/verdict.json.
 * @param {{ url: string, release: string, out: string, only?: readonly string[], card?: string, deepLink?: string, watchMs?: number, budgetMs?: number,
 *   build?: string, lastTimeToPlay?: Record<string, number>, oldProfiles?: Partial<Record<'chromium' | 'webkit', string>>,
 *   oldState?: import('./staging-smoke/scenarios.mjs').StorageState, store?: string, vision?: boolean, changelog?: string,
 *   log?: (line: string) => void }} options
 * `store` (the CLI's default: ~/.cache/wildshard/plan-artifacts/staging-smoke) keeps the run and gives the last release's
 * frames and times; without one the run is kept only in `out` and the vision pass has no baseline (no calls).
 */
export async function runSmoke({ url, release, out, only, card = 'driftwood-isle', deepLink = 'pine-hollow', watchMs, budgetMs, build, lastTimeToPlay, oldProfiles = {}, oldState, store, vision = true, changelog = resolve('CHANGELOG.md'), log = console.log }) {
  if (/wildshard\.io/u.test(url) && !/staging/u.test(url)) throw new Error('The staging smoke joins worlds: staging or local only, never production');
  const pw = await import('playwright');
  const started = Date.now();
  const version = await served(url);
  mkdirSync(out, { recursive: true });
  /** @type {import('./staging-smoke/scenarios.mjs').ScenarioResult[]} */
  const scenarios = [];
  for (const scenario of SCENARIOS) {
    if (only !== undefined && !only.includes(scenario.id)) continue;
    const oldProfile = oldProfiles[scenario.browser];
    const result = await runScenario(scenario, {
      url, out, card, deepLink, pw, ...(watchMs === undefined ? {} : { watchMs }), ...(budgetMs === undefined ? {} : { budgetMs }),
      ...(oldProfile === undefined ? {} : { oldProfile, ...(oldState === undefined ? {} : { oldState }) }), ...(version.minClient === undefined ? {} : { minClient: version.minClient }),
    });
    scenarios.push(result);
    const problems = result.legs.flatMap((leg) => leg.problems.map((p) => `${leg.name}: ${p.text}`));
    log(`${result.status === 'skip' ? 'SKIP' : result.status === 'ran' && problems.length === 0 ? 'PASS' : 'FAIL'} ${result.id} ${result.title} ${result.seconds.toFixed(0)} s${result.reason === undefined ? '' : `: ${result.reason}`}`);
    for (const line of problems) log(`  - ${line}`);
  }
  const seconds = (Date.now() - started) / 1000;
  const last = store === undefined ? undefined : lastRelease(store, release);
  const times = lastTimeToPlay ?? last?.timeToPlay;
  const judged = verdictOf(scenarios, { release, version, ...(build === undefined ? {} : { build }), ...(times === undefined ? {} : { lastTimeToPlay: times }) });
  // SM3: the Opus vision pass, against the last release's keyframes
  const looks = vision ? visionPass({ scenarios, release, ...(last === undefined ? {} : { last }), bullets: changelogBullets(changelog, release), out }) : [];
  for (const v of looks) log(`  vision ${v.scenario}: ${v.verdict}${v.severity === undefined ? '' : ` ${v.severity}`} ${v.line}`);
  const findings = [...judged.findings, ...visionFindings(looks)].sort(worstFirst);
  for (const f of findings) log(`  ${f.severity} ${f.scenario} ${f.key}: ${f.text}`);
  const verdict = {
    url, release, ...(version.build === undefined ? {} : { build: version.build }), ...(version.describe === undefined ? {} : { describe: version.describe }),
    version, at: new Date().toISOString(), seconds,
    scenarios: judged.rows.map(({ scenario, checks, timeToPlay }) => Object.assign(scenario, { checks, timeToPlay })),
    ...(last === undefined ? {} : { last: last.release }), vision: looks, findings, hold: holds(findings),
  };
  writeFileSync(join(out, 'verdict.json'), `${JSON.stringify(verdict, null, 1)}\n`);
  if (store !== undefined) log(`kept in ${keepRun(store, release, out, verdict)}`);
  log(`staging-smoke ${release}: ${verdict.hold ? 'HOLD' : 'no hold'}, ${String(findings.length)} findings, ${String(scenarios.length)} scenarios in ${seconds.toFixed(0)} s${seconds > RUN_BUDGET_S ? ` WARNING: over the ${String(RUN_BUDGET_S / 60)}-minute budget (SM8)` : ''}`);
  return verdict;
}

async function cli() {
  const args = parseArgs(process.argv.slice(2));
  const url = (args.get('url') ?? 'https://staging.wildshard.io').replace(/\/$/u, '');
  const release = args.get('release');
  if (release === undefined) { console.error('usage: node scripts/staging-smoke.mjs --url <candidate> --release vX.Y.Z [--only K3] [--out <dir>]'); process.exit(2); }
  const out = resolve(args.get('out') ?? `tmp/${process.env.WS_LANE_NAME ?? 'staging-smoke'}/smoke-${release}`);
  const only = args.get('only')?.split(',');
  const watch = args.get('watch');
  const verdict = await runSmoke({
    url, release, out, ...(only === undefined ? {} : { only }), ...(watch === undefined ? {} : { watchMs: Number(watch) * 1000 }),
    store: args.get('store') ?? STORE, vision: !args.has('no-vision'), ...(args.has('changelog') ? { changelog: resolve(String(args.get('changelog'))) } : {}),
    ...(args.has('card') ? { card: String(args.get('card')) } : {}), ...(args.has('deeplink') ? { deepLink: String(args.get('deeplink')) } : {}),
  });
  process.exitCode = verdict.hold ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) await cli();
