// oxlint-disable-next-line import/no-nodejs-modules -- The real helpers, on a made-up /etc.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Test keys only; the release key is never on a test box.
import { generateKeyPairSync, sign } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- A made-up /etc in the checkout's tmp/.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';

// MMO-SERVER-PLAN MS3.5 (J266): the agents' account, its allowlist and its two helpers. Neither helper honours its test
// switch as root, so these run as the developer; the box never sees them.
const CONFIG = resolve('scripts/vps/wildshard-config'), APPLY = resolve('scripts/vps/wildshard-apply.mjs');
const harden = readFileSync('scripts/vps/harden-apply.sh', 'utf8');
const made: string[] = [];
afterEach(() => { for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true }); });
function scratch(): string {
  mkdirSync('tmp/vps-agent', { recursive: true });
  const top = mkdtempSync(resolve('tmp/vps-agent/run-')); made.push(top);
  return top;
}

/** A made-up /etc/wildshard with a staging and a production env, secrets included. */
function etc(): string {
  const root = scratch(); mkdirSync(join(root, 'etc/wildshard'), { recursive: true });
  for (const channel of ['production', 'staging']) {
    writeFileSync(join(root, `etc/wildshard/${channel}.env`), `# E7.2\nRELEASE_URL=https://example.invalid/${channel}.json\nSEAT_SECRET=planted-${channel}-secret\nHOST=127.0.0.1\nWORLD_CELLS=driftwood-isle\nWORLD_WORKERS=2\nWORLD_SEATS=16\n`);
  }
  return root;
}
function config(root: string, ...args: string[]) {
  return configWith(root, {}, ...args);
}
function configWith(root: string, env: Readonly<Record<string, string>>, ...args: string[]) {
  const run = spawnSync('python3', [CONFIG, ...args], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', WILDSHARD_CONFIG_TEST_ROOT: root, WILDSHARD_CONFIG_TEST_RUNNING: '1', ...env } });
  return { status: run.status, out: run.stdout + run.stderr };
}
const read = (root: string, name: string) => readFileSync(join(root, 'etc/wildshard', name), 'utf8');

test('wildshard-config refuses a secret, a trust root, an unknown key, a bad value and an unflagged production change', () => {
  const root = etc();
  for (const [args, why] of [
    [['set', 'staging', 'SEAT_SECRET', 'x'], 'SEAT_SECRET is not a setting an agent may change'],
    [['set', 'staging', 'RELEASE_URL', 'https://evil.example/r.json'], 'RELEASE_URL is not a setting'],
    [['set', 'staging', 'ALLOWED_ORIGINS', '*'], 'ALLOWED_ORIGINS must be'],
    [['set', 'staging', 'ALLOWED_ORIGINS', 'https://staging.wildshard.io,https://wildshard-singleplayer.vercel.app'], 'ALLOWED_ORIGINS must be'],
    [['set', 'staging', 'ALLOWED_ORIGINS', 'https://play.wildshard.io'], 'ALLOWED_ORIGINS must be'],
    [['set', 'staging', 'ALLOWED_ORIGINS', 'https://staging.wildshard.io,https://staging.wildshard.io'], 'ALLOWED_ORIGINS must be'],
    [['set', 'staging', 'ALLOWED_ORIGINS', 'https://staging.wildshard.io https://play.wildshard.io'], 'ALLOWED_ORIGINS must be'],
    [['set', 'staging', 'ALLOWED_ORIGINS', 'https://staging.wildshard.io\nSEAT_SECRET=x'], 'ALLOWED_ORIGINS must be'],
    [['set', 'staging', 'TRUST_PROXY', 'none'], 'TRUST_PROXY is not a setting'],
    [['set', 'staging', 'NODE_OPTIONS', '--require=/tmp/x'], 'NODE_OPTIONS is not a setting'],
    [['set', 'staging', 'WORLD_WORKERS', '5'], 'WORLD_WORKERS must be'],
    [['set', 'staging', 'WORLD_WORKERS', 'two'], 'WORLD_WORKERS must be'],
    [['set', 'staging', 'WORLD_SEATS', '0'], 'WORLD_SEATS must be'],
    [['set', 'staging', 'WORLD_CELLS', 'driftwood-isle\nSEAT_SECRET=x'], 'WORLD_CELLS must be'],
    [['set', 'staging', 'WORLD_CELLS', 'a,a'], 'WORLD_CELLS must be'],
    [['set', 'staging', 'WORLD_CELLS', 'driftwood isle'], 'WORLD_CELLS must be'],
    [['set', 'production', 'WORLD_CELLS', 'grid'], 'a production change needs --production'],
    [['set', 'preview', 'WORLD_CELLS', 'grid'], 'the channel is production or staging'],
    [['set', '../etc', 'WORLD_CELLS', 'grid'], 'the channel is production or staging'],
  ] as const) {
    const run = config(root, ...args);
    expect(run.status, args.join(' ')).toBe(1);
    expect(run.out, args.join(' ')).toContain(why);
  }
  expect(existsSync(join(root, 'etc/wildshard/staging.settings'))).toBe(false);
  expect(existsSync(join(root, 'etc/wildshard/production.settings'))).toBe(false);
});

test('wildshard-config writes one setting, keeps the others and never touches the secrets', () => {
  const root = etc(), envBefore = read(root, 'staging.env');
  const first = config(root, 'set', 'staging', 'WORLD_WORKERS', '3');
  expect(first.status, first.out).toBe(0);
  expect(first.out).toContain('doing   restart wildshard-server@staging.service');
  expect(config(root, 'set', 'staging', 'WORLD_CELLS', 'grid').status).toBe(0);
  expect(config(root, 'set', 'staging', 'WORLD_WORKERS', '4').status).toBe(0);
  const settings = read(root, 'staging.settings');
  expect(settings.split('\n').filter(row => /^[A-Z]/u.test(row))).toEqual(['WORLD_CELLS=grid', 'WORLD_WORKERS=4']);
  expect(read(root, 'staging.env')).toBe(envBefore);
  expect(config(root, 'set', 'staging', 'WORLD_WORKERS', '4').out).toContain('already has WORLD_WORKERS=4');
  expect(config(root, 'set', 'production', 'WORLD_CELLS', 'grid', '--production').status).toBe(0);
  const shown = config(root, 'show', 'staging');
  expect(shown.out).toBe('WORLD_CELLS=grid\nWORLD_WORKERS=4\n');
  expect(shown.out).not.toContain('planted');
});

test('wildshard-config narrows ALLOWED_ORIGINS to the game hosts, keeping the channel its own (MS3.4)', () => {
  const root = etc();
  const hosts = 'https://play.wildshard.io,https://staging.wildshard.io,https://preview.wildshard.io';
  const staging = config(root, 'set', 'staging', 'ALLOWED_ORIGINS', hosts);
  expect(staging.status, staging.out).toBe(0);
  expect(config(root, 'show', 'staging').out).toBe(`ALLOWED_ORIGINS=${hosts}\n`);
  expect(config(root, 'set', 'production', 'ALLOWED_ORIGINS', 'https://staging.wildshard.io', '--production').out).toContain('ALLOWED_ORIGINS must be');
  expect(config(root, 'set', 'production', 'ALLOWED_ORIGINS', 'https://play.wildshard.io', '--production').status).toBe(0);
});

// SA33, GC33 (Jake, 2026-11-13): the placement pair and WORLD_CROSSING. Each placement key takes one exact value or blank, and the
// two go together, as main.ts throws at boot on one without the other.
const STAGING_FILE = 'https://packs.wildshard.io/releases/staging-placements.json';
const PLACEMENT_KEY = /^export const PLACEMENT_PUBLIC_KEY = '([0-9a-f]+)';$/mu.exec(readFileSync('scripts/preview-grid.ts', 'utf8'))?.[1] ?? '';

test('wildshard-config pins the placement key preview-grid.ts holds, an Ed25519 SPKI', () => {
  expect(PLACEMENT_KEY).toMatch(/^302a300506032b6570032100[0-9a-f]{64}$/u);
  expect(readFileSync(CONFIG, 'utf8')).toContain(`PLACEMENT_PUBLIC_KEY = '${PLACEMENT_KEY}'`);
});

test('wildshard-config refuses a placement file or key that is not the API\'s own, half a pair, and a crossing mode it does not know', () => {
  const root = etc(), other = PLACEMENT_KEY.slice(0, -2) + (PLACEMENT_KEY.endsWith('00') ? '01' : '00');
  for (const [args, why] of [
    [['set', 'staging', 'PLACEMENT_URL', 'https://evil.example/releases/staging-placements.json', 'PLACEMENT_PUBLIC_KEY', PLACEMENT_KEY], 'PLACEMENT_URL must be'],
    [['set', 'staging', 'PLACEMENT_URL', 'https://packs.wildshard.io/releases/production-placements.json', 'PLACEMENT_PUBLIC_KEY', PLACEMENT_KEY], 'PLACEMENT_URL must be'],
    [['set', 'staging', 'PLACEMENT_URL', `${STAGING_FILE}?x=1`, 'PLACEMENT_PUBLIC_KEY', PLACEMENT_KEY], 'PLACEMENT_URL must be'],
    [['set', 'staging', 'PLACEMENT_URL', STAGING_FILE, 'PLACEMENT_PUBLIC_KEY', other], 'PLACEMENT_PUBLIC_KEY must be'],
    [['set', 'staging', 'PLACEMENT_URL', STAGING_FILE, 'PLACEMENT_PUBLIC_KEY', PLACEMENT_KEY.toUpperCase()], 'PLACEMENT_PUBLIC_KEY must be'],
    [['set', 'staging', 'PLACEMENT_URL', STAGING_FILE], 'go together'],
    [['set', 'staging', 'PLACEMENT_PUBLIC_KEY', PLACEMENT_KEY], 'go together'],
    [['set', 'staging', 'PLACEMENT_URL', STAGING_FILE, 'PLACEMENT_PUBLIC_KEY', ''], 'go together'],
    [['set', 'staging', 'PLACEMENT_URL', STAGING_FILE, 'PLACEMENT_URL', STAGING_FILE], 'each key once'],
    [['set', 'staging', 'PLACEMENT_URL', STAGING_FILE, 'PLACEMENT_PUBLIC_KEY'], 'usage'],
    [['set', 'staging', 'WORLD_CROSSING', 'on'], 'WORLD_CROSSING must be'],
    [['set', 'staging', 'WORLD_CROSSING', ''], 'WORLD_CROSSING must be'],
    [['set', 'production', 'PLACEMENT_URL', 'https://packs.wildshard.io/releases/production-placements.json', 'PLACEMENT_PUBLIC_KEY', PLACEMENT_KEY], 'a production change needs --production'],
    [['set', 'production', 'WORLD_CROSSING', 'off'], 'a production change needs --production'],
  ] as const) {
    const run = config(root, ...args);
    expect(run.status, args.join(' ')).toBe(1);
    expect(run.out, args.join(' ')).toContain(why);
  }
  expect(existsSync(join(root, 'etc/wildshard/staging.settings'))).toBe(false);
  expect(existsSync(join(root, 'etc/wildshard/production.settings'))).toBe(false);
});

test('wildshard-config sets the placement pair in one write and one restart, clears it the same way, and reads the .env for the pair', () => {
  const root = etc();
  const both = config(root, 'set', 'staging', 'PLACEMENT_URL', STAGING_FILE, 'PLACEMENT_PUBLIC_KEY', PLACEMENT_KEY);
  expect(both.status, both.out).toBe(0);
  expect(both.out.match(/doing {3}restart/gu)).toHaveLength(1);
  expect(config(root, 'show', 'staging').out).toBe(`PLACEMENT_URL=${STAGING_FILE}\nPLACEMENT_PUBLIC_KEY=${PLACEMENT_KEY}\n`);
  expect(config(root, 'set', 'staging', 'WORLD_CROSSING', 'worker').status).toBe(0);
  // Blanking one half would boot into the throw; blanking both is off.
  expect(config(root, 'set', 'staging', 'PLACEMENT_URL', '').out).toContain('go together');
  expect(config(root, 'set', 'staging', 'PLACEMENT_URL', '', 'PLACEMENT_PUBLIC_KEY', '').status).toBe(0);
  expect(config(root, 'show', 'staging').out).toBe('WORLD_CROSSING=worker\nPLACEMENT_URL=\nPLACEMENT_PUBLIC_KEY=\n');
  // Production takes its own file, flagged.
  const production = config(root, 'set', 'production', 'PLACEMENT_URL', 'https://packs.wildshard.io/releases/production-placements.json', 'PLACEMENT_PUBLIC_KEY', PLACEMENT_KEY, '--production');
  expect(production.status, production.out).toBe(0);
  // A pair root wrote in the .env counts: the settings file may not blank one half of it, or add the other half alone.
  const fresh = etc();
  writeFileSync(join(fresh, 'etc/wildshard/staging.env'), `SEAT_SECRET=s\nPLACEMENT_URL="${STAGING_FILE}"\nPLACEMENT_PUBLIC_KEY=${PLACEMENT_KEY}\n`);
  expect(config(fresh, 'set', 'staging', 'PLACEMENT_PUBLIC_KEY', '').out).toContain('go together');
  expect(config(fresh, 'set', 'staging', 'WORLD_SEATS', '8').status).toBe(0);
  writeFileSync(join(fresh, 'etc/wildshard/staging.env'), `SEAT_SECRET=s\nPLACEMENT_URL=${STAGING_FILE}\n`);
  expect(config(fresh, 'set', 'staging', 'PLACEMENT_PUBLIC_KEY', PLACEMENT_KEY).status).toBe(0);
  expect(read(fresh, 'staging.env')).toBe(`SEAT_SECRET=s\nPLACEMENT_URL=${STAGING_FILE}\n`);
  // systemd's spacing counts too; a half pair already on the channel blocks every set, and says so.
  const spaced = etc();
  writeFileSync(join(spaced, 'etc/wildshard/staging.env'), `SEAT_SECRET=s\n  PLACEMENT_URL = ${STAGING_FILE}\n`);
  const half = config(spaced, 'set', 'staging', 'WORLD_SEATS', '8');
  expect(half.status).toBe(1);
  expect(half.out).toContain('already holds only one');
  writeFileSync(join(spaced, 'etc/wildshard/staging.env'), 'SEAT_SECRET=s\n');
  writeFileSync(join(spaced, 'etc/wildshard/staging.settings'), `PLACEMENT_PUBLIC_KEY=${PLACEMENT_KEY}\n`);
  expect(config(spaced, 'set', 'staging', 'WORLD_SEATS', '8').out).toContain('already holds only one');
  expect(config(spaced, 'set', 'staging', 'PLACEMENT_URL', STAGING_FILE).out).toContain('note    staging WORLD_CELLS is not grid');
});

test('a placement pair that leaves the server unhealthy is undone whole', () => {
  const root = etc();
  expect(config(root, 'set', 'staging', 'WORLD_SEATS', '16').status).toBe(0);
  const before = read(root, 'staging.settings');
  const bad = configWith(root, { WILDSHARD_CONFIG_TEST_HEALTHY: '0' }, 'set', 'staging', 'PLACEMENT_URL', STAGING_FILE, 'PLACEMENT_PUBLIC_KEY', PLACEMENT_KEY);
  expect(bad.status).toBe(2);
  expect(bad.out).toContain('the old settings are back');
  expect(read(root, 'staging.settings')).toBe(before);
});

test('a change that leaves the server unhealthy is undone, and the old settings are started again', () => {
  const root = etc();
  expect(config(root, 'set', 'staging', 'WORLD_SEATS', '16').status).toBe(0);
  const before = read(root, 'staging.settings');
  const bad = configWith(root, { WILDSHARD_CONFIG_TEST_HEALTHY: '0' }, 'set', 'staging', 'WORLD_SEATS', '20');
  expect(bad.status).toBe(2);
  expect(bad.out.match(/doing {3}restart/gu)).toHaveLength(2);
  expect(read(root, 'staging.settings')).toBe(before);
  const idle = configWith(root, { WILDSHARD_CONFIG_TEST_RUNNING: '0' }, 'set', 'staging', 'WORLD_SEATS', '24');
  expect(idle.status).toBe(0);
  expect(idle.out).toContain('is not running');
  expect(idle.out).not.toContain('restart');
});

test("setup.sh's split moves the settings out of the .env once, and leaves every secret there", () => {
  const root = etc();
  const split = config(root, 'split', 'production');
  expect(split.status, split.out).toBe(0);
  const env = read(root, 'production.env'), settings = read(root, 'production.settings');
  expect(env).toContain('SEAT_SECRET=planted-production-secret');
  expect(env).toContain('RELEASE_URL=');
  expect(env).not.toContain('WORLD_');
  expect(settings).toContain('WORLD_CELLS=driftwood-isle\nWORLD_WORKERS=2\nWORLD_SEATS=16\n');
  expect(settings).not.toContain('SEAT_SECRET');
  expect(config(root, 'split', 'production').out).toContain('holds no settings');
  // A quoted value moves without its quotes; one that fails its rule stays where it was, never lost.
  writeFileSync(join(root, 'etc/wildshard/staging.env'), 'SEAT_SECRET=s\nWORLD_CELLS="grid"\nWORLD_WORKERS=99\n');
  expect(config(root, 'split', 'staging').status).toBe(0);
  expect(read(root, 'staging.settings')).toContain('WORLD_CELLS=grid\n');
  expect(read(root, 'staging.env')).toBe('SEAT_SECRET=s\nWORLD_WORKERS=99\n');
  // The last assignment decides: a key whose last value fails stays whole in the .env, so the precedence never flips.
  writeFileSync(join(root, 'etc/wildshard/staging.env'), 'WORLD_SEATS=8\nWORLD_SEATS=9999\nWORLD_CELLS=a\nWORLD_CELLS=b\n');
  rmSync(join(root, 'etc/wildshard/staging.settings'));
  expect(config(root, 'split', 'staging').status).toBe(0);
  expect(read(root, 'staging.env')).toBe('WORLD_SEATS=8\nWORLD_SEATS=9999\n');
  expect(read(root, 'staging.settings')).toContain('WORLD_CELLS=b\n');
  expect(read(root, 'staging.settings')).not.toContain('WORLD_CELLS=a');
  expect(read(root, 'production.settings')).toBe(settings);
});

/** Signed channel files, as server-release signs them, with a test key. */
function releases(rows: readonly { readonly tag: string; readonly commit: string; readonly tamper?: boolean }[]) {
  const dir = scratch(), { privateKey, publicKey } = generateKeyPairSync('ed25519');
  rows.forEach((row, index) => {
    const body = JSON.stringify({ channel: 'staging', serial: index + 1, engineBuild: row.commit, saveEpoch: 1, shards: [], bundle: { name: `${row.tag}/engine-server-${row.commit}.tar.gz`, sha256: 'a'.repeat(64) }, socket: 'wss://x' });
    const signature = sign(null, Buffer.from(body), privateKey).toString('hex');
    writeFileSync(join(dir, `${String(index)}.json`), JSON.stringify({ body: row.tamper === true ? body.replace('"serial":', '"serial": ') : body, signature }));
  });
  return { dir, key: publicKey.export({ type: 'spki', format: 'der' }).toString('hex') };
}
function apply(dir: string, key: string, ...args: string[]) {
  const run = spawnSync(process.execPath, [APPLY, ...args], { encoding: 'utf8', env: { WILDSHARD_APPLY_TEST: dir, WILDSHARD_APPLY_TEST_KEY: key } });
  return { status: run.status, out: run.stdout + run.stderr };
}

test('wildshard-apply runs only a tag a signed release names, and refuses a bad tag, an unknown one or a forged file', () => {
  const good = 'b'.repeat(40), tag = `server-staging-${good}`;
  const { dir, key } = releases([{ tag, commit: good }, { tag: 'v9.9.9', commit: 'c'.repeat(40), tamper: true }]);
  const ok = apply(dir, key, tag, 'harden');
  expect(ok.status, ok.out).toBe(0);
  expect(ok.out).toContain(`${tag} is signed: engine ${good}`);
  for (const [args, why] of [
    [[tag], 'usage'], [[tag, 'bash'], 'usage'], [[tag, 'harden', '--open-443'], 'usage'],
    [['main', 'harden'], 'is not a release tag'], [['../../tmp/x', 'setup'], 'is not a release tag'], [['v1.2.3;id', 'setup'], 'is not a release tag'],
    [['v1.2.3', 'setup'], 'no signed release names v1.2.3'],
    [['v9.9.9', 'setup'], 'no signed release names v9.9.9'],
  ] as const) {
    const run = apply(dir, key, ...args);
    expect(run.status, args.join(' ')).toBe(1);
    expect(run.out, args.join(' ')).toContain(why);
  }
  // Signed by another key: the box's pinned key believes none of it.
  const other = releases([{ tag, commit: good }]);
  expect(apply(other.dir, key, tag, 'harden').out).toContain(`no signed release names ${tag}`);
});

test('wildshard-apply never reads a file a channel user owns', () => {
  expect(readFileSync(APPLY, 'utf8')).not.toMatch(/\/var\/lib\/wildshard\/\$\{channel\}|bundles/u);
});

test("wildshard-apply pins the same release public key setup.sh embeds", () => {
  const embedded = /^EXPECTED_RELEASE_PUBLIC_KEY=([0-9a-f]+)$/mu.exec(readFileSync('scripts/vps/setup.sh', 'utf8'))?.[1];
  expect(embedded).toMatch(/^302a300506032b6570032100[0-9a-f]{64}$/u);
  expect(readFileSync(APPLY, 'utf8')).toContain(`const RELEASE_PUBLIC_KEY = '${embedded ?? ''}';`);
});

/** The two allowlist lines harden-apply.sh writes, built by its own code. */
function sudoers(): { readonly raynos: string; readonly agent: string } {
  const start = harden.indexOf('units=(wildshard-server@production'), end = harden.indexOf('sudoers=$(umask 077; mktemp)');
  const agent = /^agent_rules=.*$/mu.exec(harden)?.[0] ?? '';
  const run = spawnSync('bash', ['-c', `OPT=/opt/wildshard-vps; ${harden.slice(start, end)}\n${agent}\nprintf 'raynos ALL=(root) NOPASSWD: %s\\nwildshard-agent ALL=(root) NOPASSWD: %s\\n' "\${rules#, }" "\${agent_rules#, }"`], { encoding: 'utf8' });
  const [raynos = '', agentLine = ''] = run.stdout.trim().split('\n');
  return { raynos, agent: agentLine };
}

test("the agent's allowlist is raynos's fixed commands, the two helpers and the root-owned scripts, and parses", () => {
  const { raynos, agent } = sudoers();
  const commands = (line: string) => line.replace(/^\S+ ALL=\(root\) NOPASSWD: /u, '').split(', ');
  const extra = commands(agent).filter(command => !commands(raynos).includes(command));
  expect(commands(raynos)).toContain('/usr/local/sbin/wildshard-lynis ""');
  expect(extra).toEqual(['/usr/local/sbin/wildshard-config', '/usr/local/sbin/wildshard-apply', '/usr/bin/bash /opt/wildshard-vps/rebuild.sh', '/usr/bin/bash /opt/wildshard-vps/harden.sh']);
  expect(commands(raynos).every(command => commands(agent).includes(command))).toBe(true);
  for (const command of commands(agent)) {
    expect(command, command).toMatch(/^\/(?:usr\/(?:local\/)?s?bin)\//u);
    expect(command, command).not.toMatch(/[*?[\]]|\bALL\b|sudoedit|(?:^|\/)sh(?:\s|$)|\/tmp\/|\/home\//u);
  }
  expect(commands(raynos)).not.toContain('/usr/local/sbin/wildshard-apply');
  const visudo = '/usr/sbin/visudo';
  if (existsSync(visudo)) {
    const file = join(scratch(), '21-wildshard-agent');
    writeFileSync(file, `${raynos}\n${agent}\n`);
    const checked = spawnSync(visudo, ['-cqf', file], { encoding: 'utf8' });
    expect(checked.status, checked.stderr).toBe(0);
  }
});

test("the agent logs in by root's copy of its key only, and sshd lets in raynos and it alone", () => {
  const drop = /cat > \/dev\/null|put \/etc\/ssh\/sshd_config\.d\/10-wildshard\.conf 644 root:root VH3 <<'EOF'\n([\s\S]*?)\nEOF/u.exec(harden)?.[1] ?? '';
  expect(drop.split('\n').filter(row => row.startsWith('AllowUsers'))).toEqual(['AllowUsers raynos wildshard-agent']);
  for (const want of ['PasswordAuthentication no', 'PermitRootLogin no', 'AllowTcpForwarding no', 'AllowAgentForwarding no', 'MaxSessions 2', 'LogLevel VERBOSE']) expect(drop).toContain(want);
  expect(harden).toContain('passwd -l "$AGENT"');
  expect(harden).toContain('put "/etc/ssh/authorized_keys/$AGENT" 644 root:root J266 < "$HERE/wildshard-agent.pub"');
  // The Match is the file's last block, so nothing after it is scoped to the agent by accident.
  expect(drop.trimEnd().split('\n').slice(-2)).toEqual(['Match User wildshard-agent', '    AuthorizedKeysFile /etc/ssh/authorized_keys/wildshard-agent']);
  expect(harden).not.toMatch(/\/home\/\$AGENT/u);
  expect(harden).not.toMatch(/usermod[^\n]*\bsudo\b[^\n]*wildshard-agent|-aG sudo "\$AGENT"/u);
  const key = readFileSync('scripts/vps/wildshard-agent.pub', 'utf8').trim().split('\n');
  expect(key).toHaveLength(1);
  expect(key[0]).toMatch(/^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5[A-Za-z0-9+/]+=* \S/u);
  expect(key[0]).not.toContain('PRIVATE');
  // sudo and SSH sessions reach Sentry through PAM for every account, the agent's too (VH14).
  expect(harden).toMatch(/for service in sshd sudo login; do/u);
});
