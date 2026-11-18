#!/usr/bin/env node
// J426–J428: the staging deploy checks. Run under browser-lane.sh on the release Mac.
// node scripts/staging-qa.mjs --url https://staging.wildshard.io --release vX.Y.Z [--build <sha>] [--only K3] [--out <dir>]
import { spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs, runSmoke, served } from './staging-smoke.mjs';
import { bugbashRows } from './staging-smoke/bugbash.mjs';
import { writeBoard } from './staging-smoke/board.mjs';
import { holds, worstFirst } from './staging-smoke/checks.mjs';
import { STORE } from './staging-smoke/store.mjs';
import { CHANNELS, SMOKE_SCENARIOS } from './page-release/flow.mjs';

/** @typedef {import('./staging-smoke/checks.mjs').Finding} Finding */
/** @typedef {{ id: string, browser: string, pass: boolean, seconds: number, playedMs: number, reason?: string, log: string }} Proof */
/** @typedef {{build?: string, findings: readonly Finding[], scenarios: readonly { id: string, status: string, legs: readonly {playedMs?: number}[] }[] }} SmokeEvidence */
const JOURNEYS = Object.freeze(['gate-chromium', 'journey-webkit']);
const STAGING = CHANNELS.staging.origin;

/** @param {string} scenario @param {string} key @param {Finding['severity']} severity @param {string} text @returns {Finding} */
const finding = (scenario, key, severity, text) => ({ scenario, key, severity, text, source: 'check' });

/** @param {{ build: string, smoke: SmokeEvidence, proofs: Proof[], expected: readonly string[],
 * selected: readonly string[], after?: string, full: boolean }} input */
export function mergeVerdict({ build, smoke, proofs, expected, selected, after, full }) {
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

/** @param {{ id: string, root: string, url: string, out: string, build: string }} options @returns {Proof} */
function journey({ id, root, url, out, build }) {
  const gate = id === 'gate-chromium';
  const browser = gate ? 'chromium' : 'webkit';
  const dir = join(out, id);
  mkdirSync(dir, { recursive: true });
  const log = join(dir, 'run.log');
  const args = gate
    ? [join(import.meta.dirname, 'zone-gate-proof.mjs'), `--base=${url}`, `--out=${dir}`, '--engine=chromium', '--viewport=1280x800@1', '--target=far-reach', '--deploy']
    : [join(import.meta.dirname, 'journey-proof.mjs'), '--url', url, '--out', dir, '--browsers', browser, '--card', 'driftwood-isle', '--paths', 'mmo', '--runs', 'cold', '--deploy'];
  console.log(`staging-qa starting ${id}`);
  const started = Date.now();
  const fd = openSync(log, 'w', 0o600);
  let child;
  try { child = spawnSync(process.execPath, args, { cwd: root, stdio: ['ignore', fd, fd], env: { ...process.env, BROWSER: 'none' } }); }
  finally { closeSync(fd); }
  const report = readResult(join(dir, gate ? 'chromium-far-reach-zone-gate.json' : 'report.json'));
  const pass = child.status === 0 && report?.build === build &&
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
  const url = new URL(args.get('url') ?? STAGING).origin;
  if (url !== STAGING && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/u.test(url)) throw new Error('Staging QA requires staging or a loopback server');
  const requested = args.get('only')?.split(',');
  const known = new Set(/** @type {string[]} */ ([...SMOKE_SCENARIOS, ...JOURNEYS]));
  if (requested?.some(id => !known.has(id))) throw new Error('Unknown staging QA step');
  const selected = SMOKE_SCENARIOS.filter(id => requested === undefined || requested.includes(id));
  const expected = JOURNEYS.filter(id => requested === undefined || requested.includes(id));
  if (args.has('dry-run')) {
    console.log(`staging-qa ${release} ${url}: ${[...selected, ...expected].join(', ')}; vision reports only; hold and fix forward on P0/P1`);
    return;
  }
  const root = resolve(args.get('root') ?? '.');
  const out = resolve(args.get('out') ?? join(root, 'tmp', 'staging-qa', release, String(Date.now())));
  if (existsSync(join(out, 'verdict.json')) || existsSync(join(out, 'smoke')) || expected.some(id => existsSync(join(out, id)))) throw new Error('Use a fresh staging QA output directory');
  const store = resolve(args.get('store') ?? STORE);
  const started = Date.now();
  const first = await served(url);
  const build = args.get('build') ?? first.build;
  if (build === undefined || !/^[0-9a-f]{40}$/u.test(build) || first.build !== build || first.clientVersion !== release.slice(1)) {
    throw new Error('Staging QA requires /version.json for the requested build and version');
  }
  mkdirSync(out, { recursive: true });
  const smoke = selected.length === 0 ?
    { build, url, release, at: new Date().toISOString(), seconds: 0, scenarios: [], findings: [], vision: [], hold: false } :
    await runSmoke({ url, release, out: join(out, 'smoke'), only: selected, store, build, deploy: true, changelog: join(root, 'CHANGELOG.md') });
  const proofs = expected.map(id => journey({ id, root, url, out, build }));
  const after = await served(url);
  const merged = mergeVerdict({ build, smoke, proofs, expected, selected, ...(after.build === undefined ? {} : { after: after.build }), full: requested === undefined });
  const verdict = { ...smoke, ...merged, build, qa: true, startedAt: new Date(started).toISOString(), at: new Date().toISOString(),
    seconds: (Date.now() - started) / 1000, proofs };
  const hold = holdLine(verdict, owner);
  const bugbash = args.get('bugbash');
  const rows = bugbash !== undefined && verdict.findings.length > 0
    ? bugbashRows(readFileSync(resolve(bugbash), 'utf8'), verdict.findings, { release, build }) : undefined;
  if (bugbash !== undefined && rows !== undefined) writeFileSync(resolve(bugbash), rows.text);
  const board = verdict.findings.length === 0 ? undefined : writeBoard({ ...verdict, ...(rows === undefined ? {} : { bugbash: rows }) }, { out });
  const file = join(out, 'verdict.json');
  writeFileSync(file, `${JSON.stringify({ ...verdict, ...(board === undefined ? {} : { board }) }, null, 2)}\n`);
  const line = hold ?? `staging-qa PASS ${release} ${build.slice(0, 8)}${verdict.full ? '' : ' partial'}: ${(verdict.seconds / 60).toFixed(1)} min, ${verdict.minutesInPlay.toFixed(1)} min in play`;
  if (verdict.full) {
    const receipts = join(homedir(), '.cache', 'wildshard', 'lane-receipts.log');
    mkdirSync(dirname(receipts), { recursive: true });
    appendFileSync(receipts, `${new Date().toISOString()} ${process.env.WS_LANE_NAME ?? 'staging-qa'} ${line}\n`);
  }
  console.log(`${line} (${file})`);
  process.exitCode = verdict.hold ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) await cli();
