#!/usr/bin/env node
// AUTO-RELEASE AR5 (meta docs/plans/AUTO-RELEASE-PLAN.md, J355): the last step of an engine release, with no Jake command.
// Moves the box's cook worker to the tag production now serves, through the agents' own account (J266).
//   node scripts/release-cook.mjs vX.Y.Z [--dry-run]
// 1. Production's signed release must name vX.Y.Z (read from packs.wildshard.io, public; the box checks the signature).
// 2. If the box's wildshard-config has no `cook` verb yet, it is installed from a signed tag that carries it, by the
//    allowlisted `wildshard-apply <tag> harden` (which refreshes /usr/local/sbin and /opt/wildshard-vps). Only after
//    `wildshard-harden --check` shows no `fail` row, so the apply changes no sshd, ufw or Tailscale setting.
// 3. `sudo -n wildshard-config cook vX.Y.Z`: the box verifies the tag, writes cook.settings, rebuilds the cook step alone,
//    waits for its /health and rolls back if it does not come up. Then `show cook` and the worker's /health.
// --dry-run reads the box and says what it would do; it writes nothing. Output never carries an address or a secret.
import { spawnSync } from 'node:child_process';

const HOST = 'wildshard-agent';
const RELEASES = 'https://packs.wildshard.io/releases';
const TAG = /^v\d{1,4}\.\d{1,4}\.\d{1,4}$/u;
const SIGNED_TAG = /^(?:v\d{1,4}\.\d{1,4}\.\d{1,4}|server-(?:staging|production)-[0-9a-f]{40})$/u, COMMIT = /^[0-9a-f]{40}$/u;
const MARK = 'cook <tag>';

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
function carries(commit) {
  spawnSync('git', ['fetch', '--quiet', 'origin', commit], { encoding: 'utf8' });
  const shown = spawnSync('git', ['show', `${commit}:scripts/vps/wildshard-config`], { encoding: 'utf8', maxBuffer: 1 << 24 });
  return shown.status === 0 && shown.stdout.includes(MARK);
}

async function main() {
  const args = process.argv.slice(2), dry = args.includes('--dry-run');
  const tag = args.find(arg => arg !== '--dry-run');
  if (tag === undefined || !TAG.test(tag) || args.length > (dry ? 2 : 1)) stop('usage: node scripts/release-cook.mjs vX.Y.Z [--dry-run]');
  const production = await served('production');
  if (production.tag !== tag) stop(`production serves ${production.tag || 'nothing'}, not ${tag}: the cook follows production`);
  say('ok', `production serves ${tag} (${production.build.slice(0, 8)})`);

  const shown = box('sudo -n /usr/local/sbin/wildshard-config show cook');
  say('now', shown.status === 0 ? shown.out.trim().replaceAll('\n', ', ') : 'the box has no cook verb yet');
  if (shown.status === 0 && shown.out.includes(`COOK_ENGINE_REF=${tag}\n`) && shown.out.includes(`WILDSHARD_BUILD=${production.build}`)) {
    const health = box('curl -fsS --max-time 5 http://127.0.0.1:8792/health >/dev/null && echo up');
    if (health.out.includes('up')) { say('ok', `the cook worker already runs ${tag} and answers /health`); return; }
  }

  if (box(`grep -qF '${MARK}' /usr/local/sbin/wildshard-config`).status !== 0) {
    // The helper comes from a signed tag that carries it: production's if it does, else staging's.
    const staging = await served('staging');
    const source = carries(production.build) ? production : carries(staging.build) ? staging : null;
    if (source === null) stop('no signed release carries `wildshard-config cook` yet: it rides the next staging serial (AUTO-RELEASE AR8)');
    const check = box('sudo -n /usr/local/sbin/wildshard-harden --check');
    const fails = check.out.split('\n').filter(line => line.startsWith('fail'));
    if (fails.length > 0) stop(`harden --check has ${String(fails.length)} fail row(s) (${fails.map(line => line.split(/\s+/u)[1]).join(', ')}): applying would change the box, so no auto-install`);
    if (dry) { say('would', `install the cook verb by: sudo -n wildshard-apply ${source.tag} harden`); }
    else {
      say('doing', `sudo -n wildshard-apply ${source.tag} harden (detached; it may restart sshd)`);
      box(`nohup sudo -n /usr/local/sbin/wildshard-apply ${source.tag} harden > ~/release-cook-harden.log 2>&1 < /dev/null &`);
      // [w]: pgrep must not match the remote shell that runs it.
      const deadline = Date.now() + 20 * 60_000, running = `pgrep -f '[w]ildshard-apply ${source.tag}' >/dev/null`;
      // pgrep's 1 is "finished"; ssh's 255 (harden restarting sshd) is "ask again".
      let status;
      do {
        await new Promise(resolve => { setTimeout(resolve, 15_000); });
        if (Date.now() > deadline) stop('wildshard-apply harden did not finish in 20 minutes; see ~/release-cook-harden.log on the box');
        status = box(running).status;
      } while (status !== 1);
      if (box(`grep -qF '${MARK}' /usr/local/sbin/wildshard-config`).status !== 0) stop('harden ran but the cook verb is not installed; see ~/release-cook-harden.log on the box');
      // A step that could cut SSH arms a 10-minute dead-man; this new session proves the way in, so stop it as harden asks.
      if (box('systemctl is-active --quiet wildshard-harden-deadman.timer').status === 0) {
        say('note', 'harden armed its dead-man, so it changed an SSH-side setting; this session got in, stopping the timer');
        const stopped = box('sudo -n /usr/bin/systemctl stop wildshard-harden-deadman.timer');
        if (stopped.status !== 0 || box('systemctl is-active --quiet wildshard-harden-deadman.timer').status === 0) {
          stop('the harden dead-man timer is still armed: run `sudo -n systemctl stop wildshard-harden-deadman.timer` as wildshard-agent within 10 minutes');
        }
      }
      say('ok', `the cook verb is installed from ${source.tag}`);
    }
  }

  if (dry) { say('would', `sudo -n wildshard-config cook ${tag}`); return; }
  const moved = box(`sudo -n /usr/local/sbin/wildshard-config cook ${tag}`);
  for (const line of moved.out.trim().split('\n').filter(row => /^(ok|doing|undo|stop|note|wait|warn|done)\s/u.test(row))) console.info(redact(line));
  if (moved.status !== 0) stop(`wildshard-config cook ${tag} exited ${String(moved.status)}`);
  const after = box('sudo -n /usr/local/sbin/wildshard-config show cook; curl -fsS --max-time 5 http://127.0.0.1:8792/health >/dev/null && echo health-up');
  if (!after.out.includes(`COOK_ENGINE_REF=${tag}\n`) || !after.out.includes(`WILDSHARD_BUILD=${production.build}`) || !after.out.includes('health-up')) stop('the cook did not settle on the new tag; see journalctl -u wildshard-cook');
  say('done', `the cook worker runs ${tag} (${production.build.slice(0, 8)}) and answers /health`);
}

await main();
