#!/usr/bin/env node
// AUTO-RELEASE AR5 (meta docs/plans/AUTO-RELEASE-PLAN.md, J355): the last step of an engine release, with no Jake command.
// Moves the cook with staging, before its page alias (async uploads need the same exact build).
//   node src/scripts/release-cook.mjs vX.Y.Z [--dry-run]
//   node src/scripts/release-cook.mjs --staging --build=<sha> [--dry-run]
// 1. Production's signed release must name vX.Y.Z (read from packs.wildshard.io, public; the box checks the signature).
// 2. If the box's wildshard-config has no `cook` verb yet, it is installed from a signed tag that carries it, by the
//    allowlisted `wildshard-apply <tag> harden` (which refreshes /usr/local/sbin and /opt/wildshard-vps). Only after
//    `wildshard-harden --check` shows no `fail` row outside OFF_SSH_ROWS, so the apply changes no sshd, ufw or Tailscale
//    setting. An OFF_SSH_ROWS fail is one the apply fixes away from them (v0.1.21: SC2, Prometheus down on a root-only
//    /etc/prometheus, fixed by the tag's harden).
// 3. `sudo -n wildshard-config cook vX.Y.Z`: the box verifies the tag, writes cook.settings, rebuilds the cook step alone,
//    waits for its /health and rolls back if it does not come up. Then `show cook` and the worker's /health.
// 4. FAST-RELEASE FR-A11: harden copies all of src/scripts/vps to the box, so when src/scripts/vps changed since the box's last
//    harden (wildshard-apply's stamp, else the cook's previous build), the release runs `wildshard-apply <tag> harden`
//    itself, behind the same --check gate. A gate or an apply that fails says why in a `warn` line; the release goes on.
// 5. FAST-RELEASE FR-A25: the harden comes first, before the cook move. `wildshard-config cook` runs the box's root-owned
//    copy of rebuild.sh (/opt/wildshard-vps, which only harden refreshes), and the move restarts the cook, which starts the
//    staging recook the pack wait then waits on. With the harden after the move (v0.1.91), the move wrote the old unit
//    (AllowedCPUs=13-15, no CPUWeight) and the release recooked on 3 CPUs; FR-A22's 7 waited for the next release.
// 6. After the move, the cook unit's AllowedCPUs, CPUWeight and MemoryMax (`systemctl show`) must equal what this build's
//    rebuild.sh writes, or the release stops: that gap let FR-A22's CPU half go missing unnoticed. When the cook already ran
//    the tag, a stale unit is rewritten by one more `wildshard-config cook` from the fresh copy, then read again.
// --dry-run reads the box and says what it would do; it writes nothing. Output never carries an address or a secret.
import { agentFetch as fetch } from './agent-requests.mjs';
import { spawnSync } from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve as resolvePath} from 'node:path';
import {pathToFileURL} from 'node:url';

const HOST = 'wildshard-agent';
const RELEASES = 'https://releases.wildshard.io';
const PREPARATION_RELEASES = 'https://github.com/project-wildshard/engine/releases/download';
const TAG = /^v\d{1,4}\.\d{1,4}\.\d{1,4}$/u;
const SIGNED_TAG = /^(?:v\d{1,4}\.\d{1,4}\.\d{1,4}|server-(?:staging|production)-[0-9a-f]{40})$/u, COMMIT = /^[0-9a-f]{40}$/u;
const MARK = 'cook <tag>';
// harden --check rows whose fix never touches sshd, ufw or Tailscale: SC2 is the box-local Prometheus on loopback. VH5 is
// unattended upgrades and the reboot they ask for, which no apply fixes. v0.1.95's staging move ran the box's pre-lean
// rebuild.sh because a pending reboot held the harden that refreshes it, so the cook rolled back (QA 11-25 row 88).
const OFF_SSH_ROWS = new Set(['SC2', 'VH5']);
// wildshard-apply writes `<commit> <tag>` here after a harden that exits 0 (FR-A11): root-written, world-readable.
const HARDEN_STAMP = '/var/lib/wildshard-harden-applied';
const VPS = 'src/scripts/vps/';
// FR-A25: what the release reads of the running cook unit.
const UNIT_SHOW = 'systemctl show wildshard-cook -p AllowedCPUs -p CPUWeight -p MemoryMax';

/** @param {string} what @param {string} message */
function say(what, message) { console.info(`${what.padEnd(7)} ${redact(message)}`); }
/** @param {string} message @returns {never} */
function stop(message) { console.error(`stop    ${redact(message)}`); process.exit(1); }
/** Never print an address: IPv4 and tailnet hosts are blanked. @param {string} text */
function redact(text) { return text.replaceAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, '<address>').replaceAll(/\b[\w-]+\.tail[\w-]+\.ts\.net\b/gu, '<tailnet>'); }

/** One command on the box as the agents' account. @param {string} command */
function box(command) {
  const run = spawnSync('ssh', ['-o', 'ConnectTimeout=20', '-o', 'BatchMode=yes', HOST, command], { encoding: 'utf8', timeout: 20 * 60_000 });
  return { status: run.status ?? 1, out: `${run.stdout ?? ''}${run.stderr ?? ''}` };
}

/** The tag and build a channel's release file names (unverified here; the box verifies). @param {'production' | 'staging'} channel */
async function served(channel) {
  const answer = await fetch(`${RELEASES}/${channel}.json`, { signal: AbortSignal.timeout(20_000), cache: 'no-store' });
  if (!answer.ok) stop(`${channel}'s release file answered ${String(answer.status)}`);
  const body = JSON.parse(/** @type {{ body: string }} */ (await answer.json()).body);
  const tag = String(body.bundle?.name ?? '').split('/')[0] ?? '', build = String(body.engineBuild ?? '');
  // The file is unverified here and both values reach a shell on the box: only a release tag and a full commit pass.
  if (!SIGNED_TAG.test(tag) || !COMMIT.test(build)) stop(`${channel}'s release file names an unexpected tag or build`);
  return { tag, build };
}

/** True when engine `commit` ships the cook verb. @param {string} commit */
function carries(commit, staging = false) {
  spawnSync('git', ['fetch', '--quiet', 'origin', commit], { encoding: 'utf8' });
  const shown = spawnSync('git', ['show', `${commit}:src/scripts/vps/wildshard-config`], { encoding: 'utf8', maxBuffer: 1 << 24 });
  return shown.status === 0 && shown.stdout.includes(MARK) && (!staging || shown.stdout.includes('|server-staging-'));
}

/** The VPS uses the exact staging tag's archive for either cook channel.
 * @param {string} build @param {typeof globalThis.fetch} [read] */
export async function preparationClientGap(build, read = fetch) {
  const tag = `server-staging-${build}`;
  const asset = `${tag}/preparation-client.tar.gz`;
  try {
    const response = await read(`${PREPARATION_RELEASES}/${asset}`, {
      method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return null;
    return `${asset} returned HTTP ${response.status}; wait for the release's devserver-client job before moving the cook`;
  } catch {
    return `could not verify ${asset}; check the release's devserver-client job before moving the cook`;
  }
}

async function main() {
  const args = process.argv.slice(2), dry = args.includes('--dry-run'), stagingMove = args.includes('--staging');
  const expected = args.find(arg => arg.startsWith('--build='))?.slice('--build='.length);
  const requested = args.find(arg => !arg.startsWith('--'));
  if (stagingMove ? requested !== undefined || expected === undefined || !COMMIT.test(expected) || args.length !== (dry ? 3 : 2)
    : requested === undefined || !TAG.test(requested) || args.length !== (dry ? 2 : 1)) stop('usage: release-cook.mjs vX.Y.Z | --staging --build=<sha> [--dry-run]');
  const staging = await served('staging'), production = stagingMove ? staging : await served('production');
  const tag = selectCookRelease(staging, production, stagingMove ? {build: expected ?? ''} : {tag: requested ?? ''}).tag;
  say('ok', `${stagingMove ? 'staging' : 'production and staging'} serve ${tag} (${production.build.slice(0, 8)})`);
  const archiveGap = await preparationClientGap(production.build);
  if (archiveGap !== null) stop(archiveGap);

  const shown = box('sudo -n /usr/local/sbin/wildshard-config show cook');
  say('now', shown.status === 0 ? shown.out.trim().replaceAll('\n', ', ') : 'the box has no cook verb yet');
  const cookBuild = /^WILDSHARD_BUILD=([0-9a-f]{40})$/mu.exec(shown.out)?.[1];
  if (shown.status === 0 && shown.out.includes(`COOK_ENGINE_REF=${tag}\n`) && shown.out.includes(`WILDSHARD_BUILD=${production.build}`)) {
    const health = box('curl -fsS --max-time 5 http://127.0.0.1:8792/health >/dev/null && echo up');
    if (health.out.includes('up')) {
      say('ok', `the cook worker already runs ${tag} and answers /health`);
      await hardenIfDue(tag, production.build, cookBuild, dry);
      if (!dry) {
        if (cookUnitGap(expectedCookUnit(readFileSync('src/scripts/vps/rebuild.sh', 'utf8')), box(UNIT_SHOW).out) !== null) {
          say('doing', `the cook unit is behind this build's rebuild.sh: sudo -n wildshard-config cook ${tag} rewrites it`);
          moveCook(tag, production.build);
        }
        checkCookUnit();
      }
      return;
    }
  }

  const needsHelper = box(`grep -qF '${MARK}' /usr/local/sbin/wildshard-config`).status !== 0
    || (stagingMove && box("grep -qF '|server-staging-' /usr/local/sbin/wildshard-config").status !== 0);
  if (needsHelper) {
    // The helper comes from a signed tag that carries it: production's if it does, else staging's.
    const source = carries(production.build, stagingMove) ? production : carries(staging.build, stagingMove) ? staging : null;
    if (source === null) stop('no signed release carries `wildshard-config cook` yet: it rides the next staging serial (AUTO-RELEASE AR8)');
    const gate = hardenGate();
    if (gate !== null) stop(`${gate}: applying would change the box, so no auto-install`);
    if (dry) { say('would', `install the cook verb by: sudo -n wildshard-apply ${source.tag} harden`); }
    else {
      const failed = await applyHarden(source.tag);
      if (failed !== null) stop(failed);
      if (box(`grep -qF '${MARK}' /usr/local/sbin/wildshard-config`).status !== 0) stop('harden ran but the cook verb is not installed; see ~/release-cook-harden.log on the box');
      if (stagingMove && box("grep -qF '|server-staging-' /usr/local/sbin/wildshard-config").status !== 0) stop('The signed helper still cannot follow staging; no alias may move');
      say('ok', `the cook verb is installed from ${source.tag}`);
    }
  }

  // FR-A25: harden first, so the move runs this build's rebuild.sh and the recook it starts runs on this build's unit.
  await hardenIfDue(tag, production.build, cookBuild, dry);
  if (dry) {
    say('would', `sudo -n wildshard-config cook ${tag}, then read the cook unit against this build's rebuild.sh`);
    return;
  }
  moveCook(tag, production.build);
  checkCookUnit();
}

/** `wildshard-config cook <tag>` and its settle check. @param {string} tag @param {string} build */
function moveCook(tag, build) {
  const moved = box(`sudo -n /usr/local/sbin/wildshard-config cook ${tag}`);
  for (const line of moved.out.trim().split('\n').filter(row => /^(ok|doing|undo|stop|note|wait|warn|done)\s/u.test(row))) console.info(redact(line));
  if (moved.status !== 0) stop(`wildshard-config cook ${tag} exited ${String(moved.status)}`);
  const after = box('sudo -n /usr/local/sbin/wildshard-config show cook; curl -fsS --max-time 5 http://127.0.0.1:8792/health >/dev/null && echo health-up');
  if (!after.out.includes(`COOK_ENGINE_REF=${tag}\n`) || !after.out.includes(`WILDSHARD_BUILD=${build}`) || !after.out.includes('health-up')) stop('the cook did not settle on the new tag; see journalctl -u wildshard-cook');
  say('done', `the cook worker runs ${tag} (${build.slice(0, 8)}) and answers /health`);
}

/** FR-A25: the running cook unit against this build's rebuild.sh; stops the release on any difference. */
function checkCookUnit() {
  const expected = expectedCookUnit(readFileSync('src/scripts/vps/rebuild.sh', 'utf8'));
  const gap = cookUnitGap(expected, box(UNIT_SHOW).out);
  if (gap !== null) stop(`the cook unit does not match this build's rebuild.sh: ${gap} (FR-A25); the recook would run on the wrong box`);
  say('ok', `cook unit AllowedCPUs=${expected.AllowedCPUs} CPUWeight=${expected.CPUWeight} MemoryMax=${expected.MemoryMax} as rebuild.sh writes`);
}

const UNITS = /** @type {Record<string, number>} */ ({K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4});

/** What rebuild.sh's wildshard-cook unit sets on a 16-core box: AllowedCPUs (COOK_CPUS), CPUWeight and MemoryMax in
 *  bytes, as `systemctl show` prints them. @param {string} rebuild @returns {{AllowedCPUs: string, CPUWeight: string, MemoryMax: string}} */
export function expectedCookUnit(rebuild) {
  const cpus = /\bCOOK_CPUS='AllowedCPUs=([0-9,-]+)'/u.exec(rebuild)?.[1];
  const start = rebuild.indexOf('"$SYSTEMD/wildshard-cook.service" 644'), end = rebuild.indexOf('\nEOF\n', start);
  const unit = start === -1 || end === -1 ? '' : rebuild.slice(start, end);
  const weight = /^CPUWeight=(\d+)$/mu.exec(unit)?.[1], memory = /^MemoryMax=(\d+)([KMGT])?$/mu.exec(unit);
  if (cpus === undefined || !unit.includes('$COOK_CPUS') || weight === undefined || memory === null) throw new Error("rebuild.sh's cook unit has no COOK_CPUS, CPUWeight or MemoryMax line");
  return {AllowedCPUs: cpus, CPUWeight: weight, MemoryMax: String(Number(memory[1]) * (memory[2] === undefined ? 1 : UNITS[memory[2]] ?? 1))};
}

/** Each key `systemctl show` reports differently from `expected`, as `key box <value>, rebuild.sh <value>`, or null.
 * @param {{AllowedCPUs: string, CPUWeight: string, MemoryMax: string}} expected @param {string} shown */
export function cookUnitGap(expected, shown) {
  const read = Object.fromEntries(shown.split('\n').map(line => line.trim().split('=')).filter(([key]) => key !== undefined && key !== '')
    .map(([key, ...value]) => [key, value.join('=')]));
  const gaps = Object.entries(expected).filter(([key, value]) => read[key] !== value).map(([key, value]) => `${key} box ${read[key] ?? '(none)'}, rebuild.sh ${value}`);
  return gaps.length === 0 ? null : gaps.join('; ');
}

/** The --check rows that make an unattended apply unsafe, or null when it may run. @returns {string | null} */
function hardenGate() { return hardenGateOf(box('sudo -n /usr/local/sbin/wildshard-harden --check').out); }

/** The same gate on a `wildshard-harden --check` output. @param {string} out @returns {string | null} */
export function hardenGateOf(out) {
  if (!out.includes('summary')) return 'harden --check did not finish';
  const fails = out.split('\n').filter(line => line.startsWith('fail') && !OFF_SSH_ROWS.has(line.split(/\s+/u)[1] ?? ''));
  return fails.length > 0 ? `harden --check has ${String(fails.length)} fail row(s) (${fails.map(line => line.split(/\s+/u)[1]).join(', ')})` : null;
}

/** Runs `wildshard-apply <tag> harden` detached and waits for it. Null when it finished, else why not.
 * @param {string} tag @returns {Promise<string | null>} */
async function applyHarden(tag) {
  say('doing', `sudo -n wildshard-apply ${tag} harden (detached; it may restart sshd)`);
  box(`nohup sh -c 'sudo -n /usr/local/sbin/wildshard-apply ${tag} harden; echo "apply-exit $?"' > ~/release-cook-harden.log 2>&1 < /dev/null &`);
  // [w]: pgrep must not match the remote shell that runs it.
  const deadline = Date.now() + 20 * 60_000, running = `pgrep -f '[w]ildshard-apply ${tag}' >/dev/null`;
  // pgrep's 1 is "finished"; ssh's 255 (harden restarting sshd) is "ask again".
  let status;
  do {
    await new Promise(resolve => { setTimeout(resolve, 15_000); });
    if (Date.now() > deadline) return 'wildshard-apply harden did not finish in 20 minutes; see ~/release-cook-harden.log on the box';
    status = box(running).status;
  } while (status !== 1);
  const exit = /apply-exit (\d+)\s*$/u.exec(box('tail -n 1 ~/release-cook-harden.log').out)?.[1];
  if (exit !== '0') return `wildshard-apply harden exited ${exit ?? 'without a status'}; see ~/release-cook-harden.log on the box`;
  // A step that could cut SSH arms a 10-minute dead-man; this new session proves the way in, so stop it as harden asks.
  if (box('systemctl is-active --quiet wildshard-harden-deadman.timer').status === 0) {
    say('note', 'harden armed its dead-man, so it changed an SSH-side setting; this session got in, stopping the timer');
    const stopped = box('sudo -n /usr/bin/systemctl stop wildshard-harden-deadman.timer');
    if (stopped.status !== 0 || box('systemctl is-active --quiet wildshard-harden-deadman.timer').status === 0) {
      return 'the harden dead-man timer is still armed: run `sudo -n systemctl stop wildshard-harden-deadman.timer` as wildshard-agent within 10 minutes';
    }
  }
  return null;
}

/** FR-A11: is the box's harden behind this build? harden copies all of src/scripts/vps, so any change there since the last
 *  harden (the stamp's commit, else the cook's previous build) makes it due. `changed` lists paths between two commits,
 *  or null when it cannot.
 * @param {string | undefined} applied @param {string} build @param {(from: string, to: string) => string[] | null} changed
 * @returns {{due: boolean, why: string}} */
export function hardenDue(applied, build, changed) {
  if (applied === undefined || !COMMIT.test(applied)) return { due: true, why: "no record of the box's last harden" };
  if (applied === build) return { due: false, why: `the box's harden is already ${build.slice(0, 8)}` };
  const paths = changed(applied, build);
  if (paths === null) return { due: true, why: `cannot compare ${applied.slice(0, 8)} with ${build.slice(0, 8)}` };
  const inputs = paths.filter(path => path.startsWith(VPS));
  if (inputs.length === 0) return { due: false, why: `no harden input changed since ${applied.slice(0, 8)}` };
  const named = inputs.slice(0, 3).join(', ') + (inputs.length > 3 ? ', ...' : '');
  return { due: true, why: `${String(inputs.length)} harden input(s) changed since ${applied.slice(0, 8)} (${named})` };
}

/** @param {string} from @param {string} to @returns {string[] | null} */
function changedPaths(from, to) {
  for (const commit of [from, to]) spawnSync('git', ['fetch', '--quiet', 'origin', commit], { encoding: 'utf8' });
  const diff = spawnSync('git', ['diff', '--name-only', '--no-renames', from, to, '--', VPS], { encoding: 'utf8', maxBuffer: 1 << 24 });
  return diff.status === 0 ? diff.stdout.split('\n').filter(Boolean) : null;
}

/** Applies harden from `tag` when it is due. Never stops the release: a refusal is a `warn` line that says why.
 * @param {string} tag @param {string} build @param {string | undefined} cookBuild @param {boolean} dry */
async function hardenIfDue(tag, build, cookBuild, dry) {
  const stamp = box(`cat ${HARDEN_STAMP} 2>/dev/null`).out.trim().split(/\s+/u)[0] ?? '';
  const { due, why } = hardenDue(COMMIT.test(stamp) ? stamp : cookBuild, build, changedPaths);
  if (!due) { say('ok', `harden: ${why}`); return; }
  const gate = hardenGate();
  if (gate !== null) { say('warn', `harden is due (${why}) but not applied: ${gate}; a lane applies it by hand`); return; }
  if (dry) { say('would', `harden is due (${why}): sudo -n wildshard-apply ${tag} harden`); return; }
  say('note', `harden is due: ${why}`);
  const failed = await applyHarden(tag);
  if (failed === null) say('done', `harden applied from ${tag}`);
  else say('warn', `harden from ${tag}: ${failed}; a lane applies it by hand`);
}

/** Reject stale end-of-prod steps and bind staging moves to the exact signed build.
 * @param {{tag: string, build: string}} staging
 * @param {{tag: string, build: string}} production
 * @param {{build: string} | {tag: string}} request
 */
export function selectCookRelease(staging, production, request) {
  if ('build' in request) {
    if (!COMMIT.test(request.build) || staging.build !== request.build || staging.tag !== `server-staging-${request.build}`) throw new Error('Cook move needs the exact signed staging build and server tag');
    return staging;
  }
  if (!TAG.test(request.tag) || production.tag !== request.tag || production.build !== staging.build) throw new Error('Cook follows staging: production tag must match its exact build');
  return production;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolvePath(process.argv[1])).href) await main();
