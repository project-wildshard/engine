#!/usr/bin/node
// MMO-SERVER-PLAN MS3.5 (J266): the agents' way to rerun harden.sh or setup.sh as root, from a signed, landed release only.
//   wildshard-apply <tag> harden|setup|rebuild
//   wildshard-apply <tag> verify    AUTO-RELEASE AR2 (J355): print `commit  <sha>` for a signed tag GitHub agrees on; runs nothing
//   wildshard-apply <tag> verify-cook    same check, for staging's signed versioned cook only
// <tag> is a release tag a signed channel file names: `vX.Y.Z` (production) or `server-staging-<sha>` (staging). The file is
// checked exactly as pull.mjs checks it (Ed25519 over `body`, the release public key embedded below and in setup.sh), and its
// `bundle.name` must sit under that tag. Its `engineBuild` commit is fetched from GitHub by hash, the tag must point at the
// same commit, and src/scripts/vps is unpacked from it into a fresh root-only folder, which is the only place the script runs
// from. It never runs anything from a path another user can write. Installed root-owned as /usr/local/sbin/wildshard-apply.
// Signed files come only from each channel's RELEASE_URL, so the tag must be one a channel serves now. Nothing a channel's
// own user can write (its bundle folders) is read: root never opens a path another account controls (Codex J206).
import { spawnSync } from 'node:child_process';
import { createPublicKey, verify } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Public SPKI DER, equal to setup.sh's EXPECTED_RELEASE_PUBLIC_KEY (the engine's test holds them equal). Never a signing key.
const RELEASE_PUBLIC_KEY = '302a300506032b657003210012e17122631777e2a6ad68e2fb4883d856def46f812aa9a3e49d701ed44ad17b';
const ENGINE_GIT = 'https://github.com/project-wildshard/engine.git';
const TAG = /^(?:v\d{1,4}\.\d{1,4}\.\d{1,4}|server-(?:staging|production)-[0-9a-f]{40})$/u, COMMIT = /^[0-9a-f]{40}$/u;
const COOK_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const COOK_HASH = /^[0-9a-f]{64}$/u;
const SCRIPTS = { harden: 'harden.sh', setup: 'setup.sh', rebuild: 'rebuild.sh' };
const WORK = '/var/lib/wildshard-apply';
// `<commit> <tag>` of the last harden that exited 0; root-written, world-readable (release-cook.mjs reads it, FR-A11).
const HARDEN_STAMP = '/var/lib/wildshard-harden-applied';

// The engine's test hands it its own key and signed files and stops before any fetch; never as root, so sudo cannot.
const test = process.geteuid?.() !== 0 ? process.env.WILDSHARD_APPLY_TEST : undefined;

/** @param {string} message @returns {never} */
function stop(message) { console.error(`stop    ${message}`); process.exit(1); }
/** @param {string} what @param {string} message */
function say(what, message) { console.info(`${what.padEnd(7)} ${message}`); }

/**
 * The commit a signed file names for this tag, or null. A bad signature is never believed (pull.mjs `readRelease`).
 * @param {string} text @param {string} tag @param {string} key @param {boolean} [versioned]
 * @returns {string | null}
 */
export function signedCommit(text, tag, key, versioned = false) {
  let signed;
  try { signed = JSON.parse(text); } catch { return null; }
  if (typeof signed?.body !== 'string' || typeof signed?.signature !== 'string' || !/^(?:[0-9a-f]{2})+$/u.test(signed.signature)) return null;
  const spki = createPublicKey({ key: Buffer.from(key, 'hex'), format: 'der', type: 'spki' });
  if (spki.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(signed.body), spki, Buffer.from(signed.signature, 'hex'))) return null;
  let release;
  try { release = JSON.parse(signed.body); } catch { return null; }
  if (!['production', 'staging'].includes(release?.channel) || typeof release.engineBuild !== 'string' || !COMMIT.test(release.engineBuild)) return null;
  if (typeof release.bundle?.name !== 'string' || !release.bundle.name.startsWith(`${tag}/`)) return null;
  if (versioned && (release.channel !== 'staging' || tag !== `server-staging-${release.engineBuild}`
    || typeof release.cook?.version !== 'string' || !COOK_VERSION.test(release.cook.version)
    || typeof release.cook.hash !== 'string' || !COOK_HASH.test(release.cook.hash)
    || !Array.isArray(release.shards) || release.shards.length === 0
    || release.shards.some((/** @type {{shardVersion?: unknown} | null} */ row) =>
      typeof row?.shardVersion !== 'string' || row.shardVersion.length === 0))) return null;
  return release.engineBuild;
}

/** Every signed file this box can see, as text. @returns {Promise<string[]>} */
async function signedFiles() {
  if (test !== undefined) return readdirSync(test).filter(name => name.endsWith('.json')).map(name => readFileSync(join(test, name), 'utf8'));
  const texts = [];
  for (const channel of ['production', 'staging']) {
    // Only RELEASE_URL is read from the root-only env file; nothing else in it is kept or printed.
    const env = existsSync(`/etc/wildshard/${channel}.env`) ? readFileSync(`/etc/wildshard/${channel}.env`, 'utf8') : '';
    const url = [...env.matchAll(/^RELEASE_URL=(.*)$/gmu)].pop()?.[1]?.trim().replaceAll(/^["']|["']$/gu, '');
    if (url !== undefined && url.startsWith('https://')) {
      try {
        const answer = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
        // A signed release file is a few hundred bytes; read at most 64 KiB of any answer.
        const parts = [];
        let size = 0;
        if (answer.ok && answer.body !== null) {
          for await (const part of answer.body) { size += part.length; if (size > 65_536) break; parts.push(part); }
          if (size <= 65_536) texts.push(Buffer.concat(parts).toString('utf8'));
        }
      } catch { say('warn', `${channel}'s signed release file did not answer`); }
    }
  }
  return texts;
}

/** git as root with no user or system config, so nothing outside this call shapes what it fetches. @param {string[]} args */
function git(args) {
  const run = spawnSync('/usr/bin/git', ['-c', 'transfer.fsckObjects=true', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', ...args],
    { encoding: 'utf8', cwd: '/', env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', HOME: '/root', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', LANG: 'C.UTF-8' } });
  if (run.status !== 0) stop(`git ${args[0] === '-C' ? args[2] : args[0]} failed: ${(run.stderr || '').trim().split('\n').pop() ?? ''}`);
  return run.stdout;
}

async function main() {
  const [tag, which, ...rest] = process.argv.slice(2);
  // Nothing is found by way of the caller's folder: not a git repository, not a profile (Codex J206).
  if (test === undefined) process.chdir('/');
  // One apply at a time: a second waits for the first under flock, so neither deletes the folder the other runs from.
  if (test === undefined && process.env.WILDSHARD_APPLY_LOCKED !== '1') {
    mkdirSync(WORK, { recursive: true, mode: 0o700 });
    const locked = spawnSync('/usr/bin/flock', [join(WORK, '.lock'), process.execPath, process.argv[1] ?? '', ...process.argv.slice(2)],
      { stdio: 'inherit', env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', HOME: '/root', LANG: 'C.UTF-8', WILDSHARD_APPLY_LOCKED: '1' } });
    process.exit(locked.status ?? 1);
  }
  const versioned = which === 'verify-cook', verifyOnly = versioned || which === 'verify';
  if (tag === undefined || which === undefined || rest.length > 0 || !(Object.hasOwn(SCRIPTS, which) || verifyOnly)) stop('usage: wildshard-apply <tag> harden|setup|rebuild|verify|verify-cook');
  if (!TAG.test(tag)) stop(`${tag} is not a release tag (vX.Y.Z or server-staging-<sha>)`);
  const key = test !== undefined ? process.env.WILDSHARD_APPLY_TEST_KEY ?? '' : RELEASE_PUBLIC_KEY;
  const commits = new Set((await signedFiles()).map(text => signedCommit(text, tag, key, versioned)).filter(commit => commit !== null));
  if (commits.size === 0) stop(versioned ? `no signed staging cook address names ${tag}`
    : `no signed release names ${tag}: only a tag a channel has published can be applied`);
  if (commits.size > 1) stop(`signed releases name ${tag} with different commits`);
  const [commit] = commits;
  say('ok', `${tag} is signed: engine ${commit}`);
  if (test !== undefined && verifyOnly) { say('commit', commit); return; }
  if (test !== undefined) { say('would', `fetch ${commit} and run src/scripts/vps/${SCRIPTS[/** @type {'harden' | 'setup' | 'rebuild'} */ (which)]}`); return; }

  // The tag on GitHub must point at the signed commit (a peeled annotated tag, or a lightweight one).
  const refs = git(['ls-remote', ENGINE_GIT, `refs/tags/${tag}`, `refs/tags/${tag}^{}`]).trim().split('\n').filter(Boolean).map(row => row.split('\t'));
  const pointed = (refs.find(([, ref]) => ref === `refs/tags/${tag}^{}`) ?? refs.find(([, ref]) => ref === `refs/tags/${tag}`))?.[0];
  if (pointed !== commit) stop(`GitHub's ${tag} points at ${pointed ?? 'nothing'}, not the signed ${commit}`);
  // verify: wildshard-config's cook verb reads this line and moves the cook to exactly this commit (AUTO-RELEASE AR4).
  if (verifyOnly) { say('commit', commit); return; }

  // A fresh root-only folder for this commit: fetched by hash, unpacked from git's own objects, never a working copy.
  mkdirSync(WORK, { recursive: true, mode: 0o700 });
  spawnSync('/usr/bin/chmod', ['700', WORK]);
  const repo = join(WORK, 'engine.git'), out = join(WORK, commit);
  if (!existsSync(repo)) git(['init', '--quiet', '--bare', repo]);
  git(['-C', repo, 'fetch', '--quiet', '--depth', '1', '--no-tags', ENGINE_GIT, commit]);
  if (git(['-C', repo, 'rev-parse', `${commit}^{commit}`]).trim() !== commit) stop(`the fetched commit is not ${commit}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { mode: 0o700 });
  const clean = { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', HOME: '/root', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LANG: 'C.UTF-8' };
  const unpack = spawnSync('/bin/sh', ['-c', 'set -e; git -C "$1" archive "$2" src/scripts/vps | tar -x -C "$3" --no-same-owner; chown -R root:root "$3"; chmod -R go-w "$3"',
    'unpack', repo, commit, out], { stdio: 'inherit', env: clean });
  const script = join(out, 'src/scripts/vps', SCRIPTS[/** @type {'harden' | 'setup' | 'rebuild'} */ (which)]);
  if (unpack.status !== 0 || !existsSync(script)) stop(`cannot unpack src/scripts/vps at ${commit}`);
  say('run', `${script} (engine ${commit.slice(0, 8)}, ${tag})`);
  // harden.sh run from here also refreshes /opt/wildshard-vps, the root-owned copy the allowlist names.
  const run = spawnSync('/usr/bin/bash', [script], { stdio: 'inherit', cwd: out, env: clean });
  // FAST-RELEASE FR-A11: the release reads which commit last hardened the box, so it can apply a changed src/scripts/vps itself.
  if (which === 'harden' && run.status === 0) {
    writeFileSync(HARDEN_STAMP, `${commit} ${tag}\n`, { mode: 0o644 });
    spawnSync('/usr/bin/chmod', ['644', HARDEN_STAMP]);
  }
  process.exit(run.status ?? 1);
}

await main();
