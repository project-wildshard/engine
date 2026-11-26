#!/usr/bin/env node
// MA10/J391: report only. Release preparation and publishing remain explicit train actions.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

const HOUR = 3_600_000;
/** @param {{tag:string, build:string, cutAt:string, newCommits:number}} latest @param {number} now */
export function releaseDue(latest, now) {
  const cut = Date.parse(latest.cutAt);
  if (!Number.isFinite(cut) || !Number.isFinite(now) || !Number.isSafeInteger(latest.newCommits) || latest.newCommits < 0) throw new Error('Invalid release clock or commit count');
  const opens = cut + 4 * HOUR, closes = cut + 8 * HOUR;
  const status = latest.newCommits === 0 ? 'no-change' : now < opens ? 'waiting' : now < closes ? 'due' : 'overdue';
  return { ...latest, status, nextWindow: { opens: new Date(opens).toISOString(), closes: new Date(closes).toISOString() }, onDemand: true };
}
/** Semantic version order includes a prepared branch; ignore unrelated and prerelease refs. @param {string[]} refs */
export function latestReleaseRef(refs) {
  return refs.map(ref => ({ ref, match: /^refs\/(?:tags\/|heads\/release\/|remotes\/origin\/release\/)(v\d+\.\d+\.\d+)$/u.exec(ref) }))
    .filter(row => row.match !== null).sort((a, b) => {
      const av = a.match?.[1]?.slice(1).split('.').map(Number) ?? [], bv = b.match?.[1]?.slice(1).split('.').map(Number) ?? [];
      for (let i = 0; i < 3; i++) { const difference = (bv[i] ?? 0) - (av[i] ?? 0); if (difference !== 0) return difference; }
      return a.ref.localeCompare(b.ref);
    })[0]?.ref;
}
/** @param {string[]} refs @param {(args:string[])=>string} readGit @param {number} now */
export function releaseDueFromRefs(refs, readGit, now) {
  const ref = latestReleaseRef(refs);
  if (ref === undefined) throw new Error('No prepared or tagged release');
  const tag = ref.split('/').at(-1) ?? '', build = readGit(['rev-parse', `${ref}^{commit}`]);
  const cutAt = new Date(Number(readGit(['show', '-s', '--format=%ct', build])) * 1000).toISOString();
  const newCommits = Number(readGit(['rev-list', '--no-merges', '--count', `${build}..refs/remotes/origin/main`]));
  return releaseDue({ tag, build, cutAt, newCommits }, now);
}
/** @param {string} value */
function mexico(value) { return `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Cancun', dateStyle: 'short', timeStyle: 'short', hour12: false }).format(new Date(value))} Cancún`; }
/** @param {ReturnType<typeof releaseDue>} result */
export function reminderLine(result) { return `MA10 ${result.status}: ${result.tag} ${result.build.slice(0, 8)}, ${result.newCommits} new commits; next cut ${mexico(result.nextWindow.opens)}–${mexico(result.nextWindow.closes)}; on demand anytime; green main required`; }
/** Dedupe in the existing receipt log; no extra state store. @param {ReturnType<typeof releaseDue>} result @param {string} previous */
export function receiptNeeded(result, previous) {
  const marker = `MA10-${result.status}-${result.tag}-${result.build.slice(0, 8)}`;
  return { marker, needed: ['due', 'overdue'].includes(result.status) && !previous.split('\n').some(line => line.includes(`codex-ms NOTE ${marker} `)) };
}
/** @param {string} value */
function xml(value) { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
/** @param {string} root @param {string} userHome */
export function reminderPlist(root, userHome) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>io.wildshard.release-due</string>\n<key>ProgramArguments</key><array><string>${xml(join(userHome, '.nvm/nvm-exec'))}</string><string>node</string><string>${xml(join(root, 'src/scripts/release-due.mjs'))}</string><string>--receipt</string></array>\n<key>EnvironmentVariables</key><dict><key>NODE_VERSION</key><string>default</string></dict>\n<key>WorkingDirectory</key><string>${xml(root)}</string>\n<key>StartInterval</key><integer>1800</integer><key>RunAtLoad</key><true/>\n</dict></plist>\n`;
}
/** @param {string[]} args @param {string} root */
function git(args, root) {
  return execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 25_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', SSH_ASKPASS_REQUIRE: 'never' },
  }).trim();
}
/** @param {string} root @param {typeof git} runGit */
export function refreshReminderRefs(root, runGit = git) {
  try {
    runGit(['fetch', '--quiet', '--no-write-fetch-head', '--no-recurse-submodules', '--tags',
      'origin', 'refs/heads/main:refs/remotes/origin/main',
      '+refs/heads/release/*:refs/remotes/origin/release/*'], root);
    return true;
  } catch {
    return false;
  }
}
/** @param {string} log @param {string} message */
function appendReminder(log, message) {
  appendFileSync(log, `${new Date().toISOString().slice(11, 16)} UTC codex-ms NOTE ${message}\n`);
}
/** @param {string[]} args */
export function main(args) {
  if (args.some(arg => !['--json', '--receipt', '--install'].includes(arg))) throw new Error('Usage: release-due.mjs [--json|--receipt|--install]');
  const root = resolve(import.meta.dirname, '..', '..'), home = homedir();
  if (args.includes('--install')) {
    if (process.platform !== 'darwin') throw new Error('The reminder installs only on the MacBook');
    if (dirname(git(['rev-parse', '--path-format=absolute', '--git-common-dir'], root)) !== root) throw new Error('Install only from the landed canonical checkout');
    const folder = join(home, 'Library/LaunchAgents'), file = join(folder, 'io.wildshard.release-due.plist'), domain = `gui/${process.getuid?.()}`;
    if (!existsSync(join(home, '.nvm/nvm-exec'))) throw new Error('nvm-exec is required');
    const contents = reminderPlist(root, home);
    if (existsSync(file) && readFileSync(file, 'utf8') !== contents) throw new Error('Existing reminder differs; preserve it for review');
    mkdirSync(folder, { recursive: true }); writeFileSync(file, contents);
    execFileSync('plutil', ['-lint', file], { stdio: 'ignore' });
    try { execFileSync('launchctl', ['print', `${domain}/io.wildshard.release-due`], { stdio: 'ignore' }); }
    catch { execFileSync('launchctl', ['bootstrap', domain, file], { stdio: 'ignore' }); }
    console.log('Installed report-only release reminder, every30min');
  }
  const log = join(home, '.cache/wildshard/lane-receipts.log');
  if (args.includes('--receipt') && !refreshReminderRefs(root)) {
    const lastKnown = git(['show', '-s', '--format=%h %ct', 'refs/remotes/origin/main'], root);
    const [build, timestamp] = lastKnown.split(' ');
    const checked = new Date(Number(timestamp) * 1000);
    const marker = `MA10-stale-${build}`;
    const message = `${marker} could not refresh origin; last known main commit at ${mexico(checked.toISOString())}`;
    const previous = existsSync(log) ? readFileSync(log, 'utf8') : '';
    if (!previous.includes(`codex-ms NOTE ${marker} `)) appendReminder(log, message);
    console.error(message);
    process.exitCode = 1;
    return undefined;
  }
  const refs = git(['for-each-ref', '--format=%(refname)', 'refs/tags', 'refs/heads/release', 'refs/remotes/origin/release'], root).split('\n');
  const result = releaseDueFromRefs(refs, gitArgs => git(gitArgs, root), Date.now());
  console.log(args.includes('--json') ? JSON.stringify(result) : reminderLine(result));
  if (args.includes('--receipt')) {
    const { marker, needed } = receiptNeeded(result, existsSync(log) ? readFileSync(log, 'utf8') : '');
    if (needed) appendReminder(log, `${marker} ${result.newCommits} new commits; green main cut due; on-demand remains available`);
  }
  return result;
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2));
