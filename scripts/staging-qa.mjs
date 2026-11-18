#!/usr/bin/env node
// J426–J428: the staging deploy checks. Run under browser-lane.sh on the release Mac.
// node scripts/staging-qa.mjs [--local | --candidate <worker-version-url> | --url <url>]
//   --release vX.Y.Z [--build <sha>] [--only K3] [--out <dir>]
// node scripts/staging-qa.mjs --train --dry-run --release vX.Y.Z
// SQ16 (J427): each leg runs the steps staging-qa-budget.mjs lists for it, about 10 minutes; over 12 is a P2 on the runner.
import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs, runSmoke, served } from './staging-smoke.mjs';
import { bugbashRows } from './staging-smoke/bugbash.mjs';
import { writeBoard } from './staging-smoke/board.mjs';
import { holds, worstFirst } from './staging-smoke/checks.mjs';
import { newestProfiles, STORE } from './staging-smoke/store.mjs';
import { CHANNELS, SMOKE_SCENARIOS } from './page-release/flow.mjs';
import { checkLocalSource, openQaRig } from './staging-qa-local.mjs';
import { bindCandidateBrowser } from './staging-qa-browser.mjs';
import { openQaCandidate } from './staging-qa-candidate.mjs';
import { budgetFinding, budgetLines, LEGS } from './staging-qa-budget.mjs';
import { iosSafari } from './staging-qa-sim.mjs';

/** @typedef {import('./staging-smoke/checks.mjs').Finding} Finding */
/** @typedef {{ id: string, browser: string, pass: boolean, seconds: number, playedMs: number, reason?: string, log: string }} Proof */
/** @typedef {{build?: string, findings: readonly Finding[], scenarios: readonly { id: string, status: string, legs: readonly {playedMs?: number}[] }[] }} SmokeEvidence */
const JOURNEYS = Object.freeze(['gate-chromium', 'journey-webkit', 'ios-safari']);
const DEPLOY_SCENARIOS = Object.freeze([...SMOKE_SCENARIOS, 'K6']);
const STAGING = CHANNELS.staging.origin;

/** @param {string} scenario @param {string} key @param {Finding['severity']} severity @param {string} text @returns {Finding} */
const finding = (scenario, key, severity, text) => ({ scenario, key, severity, text, source: 'check' });

/** `runner` holds the runner's own findings (SQ16: a leg over its cap is a P2).
 * @param {{ build: string, smoke: SmokeEvidence, proofs: Proof[], expected: readonly string[],
 * selected: readonly string[], after?: string, full: boolean, runner?: readonly Finding[] }} input */
export function mergeVerdict({ build, smoke, proofs, expected, selected, after, full, runner = [] }) {
  if (smoke.build !== build || after !== build) throw new Error('Staging build changed during QA');
  const findings = [
    ...smoke.findings.filter(row => row.source !== 'vision'),
    ...selected.filter(id => !smoke.scenarios.some(row => row.id === id && row.status === 'ran'))
      .map(id => finding(id, 'missing', 'P1', 'the scenario did not finish')),
    ...expected.filter(id => !proofs.some(row => row.id === id))
      .map(id => finding(id, 'missing', 'P1', 'the journey did not produce a result')),
    ...proofs.filter(row => !row.pass).map(row =>
      finding(row.id, row.reason?.includes('world is black or empty') === true ? 'black-world' : 'play', 'P0',
        row.reason ?? 'the journey did not reach play')),
    ...runner,
  ].sort(worstFirst);
  const played = smoke.scenarios.reduce((total, scenario) =>
    total + scenario.legs.reduce((sum, leg) => sum + (leg.playedMs ?? 0), 0), 0) +
    proofs.reduce((total, proof) => total + proof.playedMs, 0);
  return { findings, worst: findings[0]?.severity ?? 'none', hold: holds(findings), minutesInPlay: played / 60_000, full };
}

/** @param {{ release: string, findings: readonly Finding[] }} verdict @param {string} owner */
export function holdLine(verdict, owner) {
  const problems = verdict.findings.filter(row => row.source !== 'vision' && (row.severity === 'P0' || row.severity === 'P1'));
  if (problems.length === 0) return undefined;
  return `staging-qa HOLD ${verdict.release} ${problems.map(row => `${row.severity} ${row.scenario} ${row.key}`).join(', ')}. Fix forward with ${owner}; block unrelated cuts until the fix passes staging QA.`;
}

/** @param {string} file */
function readResult(file) { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined; }

/** @typedef {Awaited<ReturnType<typeof openQaCandidate>>} Candidate */

/** @param {{ id: string, root: string, url: string, out: string, build: string, candidate?: Candidate }} options @returns {Promise<Proof>} */
async function journey({ id, root, url, out, build, candidate }) {
  const gate = id === 'gate-chromium';
  const browser = gate ? 'chromium' : 'webkit';
  const dir = join(out, id);
  mkdirSync(dir, { recursive: true });
  const log = join(dir, 'run.log');
  const args = gate
    ? [join(import.meta.dirname, 'zone-gate-proof.mjs'), `--base=${url}`, `--out=${dir}`, '--engine=chromium', '--viewport=1280x800@1', '--target=far-reach', '--deploy', '--online']
    : [join(import.meta.dirname, 'journey-proof.mjs'), '--url', url, '--out', dir, '--browsers', browser, '--card', 'driftwood-isle', '--paths', 'mmo', '--runs', 'cold', '--deploy'];
  console.log(`staging-qa starting ${id}`);
  const started = Date.now();
  const fd = openSync(log, 'w', 0o600);
  let status;
  try {
    const binding = candidate === undefined ? [] : ['--import', join(import.meta.dirname, 'staging-qa-browser.mjs')];
    const env = { ...process.env, BROWSER: 'none', ...(candidate === undefined ? {} : {
      WS_QA_CANDIDATE_PROXY: candidate.server, WS_QA_CANDIDATE_HTTP: candidate.preview, WS_QA_CHROMIUM_SPKI: candidate.chromiumSPKI,
    }) };
    const child = spawn(process.execPath, [...binding, ...args], { cwd: root, env, stdio: ['ignore', fd, fd] });
    status = await new Promise((_resolve, reject) => { child.once('close', _resolve); child.once('error', reject); });
  } finally { closeSync(fd); }
  const report = readResult(join(dir, gate ? 'chromium-far-reach-zone-gate.json' : 'report.json'));
  const pass = status === 0 && report?.build === build &&
    (gate ? report?.fired?.ready === true : report?.report?.length === 1 && report?.report[0]?.ok === true);
  const problem = gate ? report?.note : report?.report?.[0]?.problems?.[0]?.text;
  const reason = typeof problem === 'string' && problem !== '' ? problem : 'no passing exact-build result';
  return { id, browser, pass, seconds: (Date.now() - started) / 1000, playedMs: Number(report?.report?.[0]?.playedMs ?? 0), log,
    ...(pass ? {} : { reason }) };
}

async function cli() {
  const args = parseArgs(process.argv.slice(2));
  const owner = args.get('fix-owner') ?? 'the staging release owner';
  if (args.has('dry-run') && args.has('verdict')) {
    const archived = readResult(resolve(String(args.get('verdict'))));
    if (archived === undefined) throw new Error('Archived verdict was not found');
    console.log(holdLine(archived, owner) ?? `staging-qa PASS ${String(archived.release)}`);
    return;
  }
  const release = args.get('release');
  if (release === undefined || !/^v\d+\.\d+\.\d+$/u.test(release)) throw new Error('Use --release vX.Y.Z');
  if (args.has('train')) {
    if (!args.has('dry-run')) throw new Error('Use --train with --dry-run to print the staging order');
    const steps = [
      `Run local QA on the green source (${LEGS.local.join(', ')})`,
      `Prepare ${release} from that source and start exact release CI`,
      'Build the staging page from the release commit',
      'Upload the unaliased Worker and its packs',
      'Wait for exact release CI and signed staging rooms, then run staging check',
      `Run QA on the unaliased candidate (${LEGS.candidate.join(', ')})`,
      'Run staging go-live with the local and candidate verdicts',
      `Run live QA within ten minutes (${LEGS.staging.join(', ')})`,
    ];
    steps.forEach((step, index) => { console.log(`${index + 1}. ${step}`); });
    return;
  }
  const local = args.has('local'), candidateUrl = args.get('candidate'), source = args.get('build');
  if ([local, candidateUrl !== undefined, args.has('url')].filter(Boolean).length > 1) {
    throw new Error('Choose one of --local, --candidate or --url');
  }
  if ((local || candidateUrl !== undefined) && (source === undefined || !/^[a-f0-9]{40}$/u.test(source))) {
    throw new Error('Local and candidate QA require --build <exact-sha>');
  }
  const url = new URL(args.get('url') ?? STAGING).origin;
  if (url !== STAGING && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/u.test(url)) throw new Error('Staging QA requires staging or a loopback server');
  const requested = args.get('only')?.split(',');
  const known = new Set(/** @type {string[]} */ ([...DEPLOY_SCENARIOS, ...JOURNEYS]));
  if (requested?.some(id => !known.has(id))) throw new Error('Unknown staging QA step');
  // SQ16 (J427): each leg runs its budgeted steps; --only picks steps by hand
  const kind = local ? 'local' : candidateUrl === undefined ? 'staging' : 'candidate';
  /** @type {readonly string[]} */
  const leg = requested ?? LEGS[kind];
  const selected = DEPLOY_SCENARIOS.filter(id => leg.includes(id));
  const expected = JOURNEYS.filter(id => leg.includes(id));
  // SQ14: the Simulator's Safari uses the Mac's own network, which no route can point at the unaliased candidate
  if (candidateUrl !== undefined && expected.includes('ios-safari')) throw new Error('iOS Simulator Safari runs on the local or live staging leg, not the candidate');
  if (args.has('dry-run')) {
    const target = local ? 'local source' : candidateUrl === undefined ? url : 'staging candidate';
    console.log(`staging-qa ${release} ${target}: ${[...selected, ...expected].join(', ')}; vision reports only; hold and fix forward on P0/P1`);
    for (const line of budgetLines(kind, [...(local ? ['build'] : []), ...selected, ...expected])) console.log(line);
    return;
  }
  const legStarted = Date.now();
  const root = resolve(args.get('root') ?? '.');
  const out = resolve(args.get('out') ?? join(root, 'tmp', 'staging-qa', release, String(Date.now())));
  if (existsSync(join(out, 'verdict.json')) || existsSync(join(out, 'smoke')) || expected.some(id => existsSync(join(out, id)))) throw new Error('Use a fresh staging QA output directory');
  const liveStore = resolve(args.get('store') ?? STORE);
  const store = local ? join(out, 'local-store') : candidateUrl === undefined ? liveStore : join(out, 'candidate-store');
  if (candidateUrl !== undefined) {
    const saved = newestProfiles(liveStore, url, release);
    if (saved !== undefined) cpSync(saved.dir, join(store, saved.note.release, 'profiles'), { recursive: true });
    mkdirSync(out, { recursive: true });
  }
  const rig = local && source !== undefined ? await openQaRig({ root, build: source, out }) : undefined;
  const candidate = candidateUrl !== undefined && source !== undefined ? await openQaCandidate({ root, out, candidate: candidateUrl, build: source }) : undefined;
  let unbind;
  try {
    unbind = candidate === undefined ? undefined : bindCandidateBrowser(candidate);
    await qualify({ url: rig?.base ?? url, release, root: rig?.source ?? root, out, store, local, kind, legStarted,
      selected, expected, owner, full: requested === undefined,
      ...(candidate === undefined ? {} : { candidate }),
      ...(source === undefined ? {} : { source }), ...(args.has('bugbash') ? { bugbash: args.get('bugbash') } : {}) });
    // SQ16: the candidate plays K1, K2 and K6 and the live leg does not, so a clean candidate's run and its K1/K2 profiles
    // become the live store's: the next release's old cache and time-to-play baseline
    if (candidate !== undefined && process.exitCode === 0 && existsSync(join(store, release))) cpSync(join(store, release), join(liveStore, release), { recursive: true });
  } finally {
    unbind?.();
    await candidate?.close();
    await rig?.close();
  }
}

/** @param {{url: string, release: string, root: string, out: string, store: string, local: boolean, kind: import('./staging-qa-budget.mjs').LegKind,
 * legStarted: number, selected: readonly string[], expected: readonly string[], owner: string, full: boolean, source?: string,
 * candidate?: Candidate, bugbash?: string | undefined}} options */
async function qualify({ url, release, root, out, store, local, kind, legStarted, selected, expected, owner, full, source, candidate, bugbash }) {
  const started = Date.now();
  const first = await served(url);
  const build = source ?? first.build;
  if (build === undefined || !/^[0-9a-f]{40}$/u.test(build) || first.build !== build || (!local && first.clientVersion !== release.slice(1))) {
    throw new Error('Staging QA requires /version.json for the requested build and version');
  }
  mkdirSync(out, { recursive: true });
  const smoke = selected.length === 0 ?
    { build, url, release, at: new Date().toISOString(), seconds: 0, scenarios: [], findings: [], vision: [], hold: false } :
    await runSmoke({ url, release, out: join(out, 'smoke'), only: selected, store, build, deploy: true, vision: !local, changelog: join(root, 'CHANGELOG.md') });
  /** @type {Proof[]} */
  const proofs = [];
  for (const id of expected) {
    proofs.push(id === 'ios-safari' ? await iosSafari({ root, url, out, build })
      : await journey({ id, root, url, out, build, ...(candidate === undefined ? {} : { candidate }) }));
  }
  await candidate?.verify();
  if (local) checkLocalSource(root, build);
  const after = await served(url);
  const legSeconds = (Date.now() - legStarted) / 1000, overCap = budgetFinding(kind, legSeconds);
  const merged = mergeVerdict({ build, smoke, proofs, expected, selected, ...(after.build === undefined ? {} : { after: after.build }), full,
    ...(overCap === undefined ? {} : { runner: [overCap] }) });
  const verdict = { ...smoke, ...merged, build, qa: true, kind, legSeconds,
    ...(candidate === undefined ? {} : { deploymentId: candidate.deploymentId, roomsSerial: candidate.serial, aliasBuild: candidate.aliasBuild }),
    startedAt: new Date(started).toISOString(), at: new Date().toISOString(),
    seconds: (Date.now() - started) / 1000, proofs };
  const hold = holdLine(verdict, owner);
  const rows = bugbash !== undefined && verdict.findings.length > 0
    ? bugbashRows(readFileSync(resolve(bugbash), 'utf8'), verdict.findings, { release, build }) : undefined;
  if (bugbash !== undefined && rows !== undefined) writeFileSync(resolve(bugbash), rows.text);
  const board = verdict.findings.length === 0 ? undefined : writeBoard({ ...verdict, ...(rows === undefined ? {} : { bugbash: rows }) }, { out });
  const file = join(out, 'verdict.json');
  writeFileSync(file, `${JSON.stringify({ ...verdict, ...(board === undefined ? {} : { board }) }, null, 2)}\n`);
  const line = hold ?? `staging-qa PASS ${release} ${build.slice(0, 8)}${verdict.full ? '' : ' partial'}: ${(verdict.seconds / 60).toFixed(1)} min, ${verdict.minutesInPlay.toFixed(1)} min in play`;
  if (verdict.full && !local) {
    const receipts = join(homedir(), '.cache', 'wildshard', 'lane-receipts.log');
    mkdirSync(dirname(receipts), { recursive: true });
    appendFileSync(receipts, `${new Date().toISOString()} ${process.env.WS_LANE_NAME ?? 'staging-qa'} ${line}\n`);
  }
  console.log(`${line} (${file})`);
  process.exitCode = verdict.hold ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) await cli();
