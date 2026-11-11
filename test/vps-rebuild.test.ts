// MMO-PLAN MP0.1: rebuild.sh's own decisions, read out of the script and run with fake paths. The whole script runs only on a
// throwaway box (scripts/vps-rebuild-proof.sh), never here and never on the VPS.
// oxlint-disable-next-line import/no-nodejs-modules -- Read the script without invoking its root entry.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The md5 dpkg records for a conffile.
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Checkout-relative test files, never privileged paths.
import { join, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Isolated checks run bash functions with fake paths.
import { spawnSync } from 'node:child_process';
import { afterEach, expect, test } from 'vitest';

const source = readFileSync('scripts/vps/rebuild.sh', 'utf8'), setup = readFileSync('scripts/vps/setup.sh', 'utf8');
function definition(name: string): string {
  const start = source.indexOf(`${name}() {`);
  if (start === -1) throw new Error(`Missing ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const roots: string[] = [];
function scratch(): string {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/vps-rebuild-'));
  roots.push(root);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test('the hard stop refuses any host that still holds the old box data, and passes a fresh one', () => {
  const root = scratch();
  const check = (markers: string[]): ReturnType<typeof spawnSync> => spawnSync('bash', ['-c', `say() { printf '%s %s\\n' "$1" "$2"; }; LIVE_MARKERS=(${markers.map(m => `'${m}'`).join(' ')}); ${definition('live_box')}\nif live_box; then exit 3; fi`], { encoding: 'utf8' });
  const fresh = check([join(root, 'home/clawdbot'), join(root, 'var/snap/ollama')]);
  expect(fresh.status).toBe(0);
  for (const marker of ['home/clawdbot', 'home/matt', 'var/snap/ollama', 'home/raynos/.openclaw']) {
    mkdirSync(join(root, marker), { recursive: true });
    const refused = check([join(root, 'home/clawdbot'), join(root, 'home/matt'), join(root, 'var/snap/ollama'), join(root, 'home/raynos/.openclaw')]);
    expect(refused.status, marker).toBe(3);
    expect(refused.stdout).toContain(join(root, marker));
    expect(refused.stdout).toContain('OPENCLAW-EXTRACT OX10');
    rmSync(join(root, marker), { recursive: true });
  }
});

test('the hard stop runs before any other step, in both modes', () => {
  const guard = source.indexOf('if live_box; then exit 3; fi');
  expect(guard).toBeGreaterThan(0);
  for (const later of ['apt-get', 'useradd', 'systemctl', 'bash "$HERE/setup.sh"', 'id -u']) expect(source.indexOf(later), later).toBeGreaterThan(guard);
  // Every home's OpenClaw folder and unit, as OPENCLAW-EXTRACT's survey found them.
  for (const marker of ['/home/clawdbot', '/home/matt', '/var/snap/ollama', '/var/lib/docker/volumes/coolify-db', '/home/*/.openclaw', 'openclaw-gateway.service']) expect(source).toContain(marker);
});

test('the cook worker waits for a build, an API, a token and exactly one kind of store', () => {
  const root = scratch(), file = join(root, 'cook.env');
  const complete = (text: string): number | null => {
    writeFileSync(file, text);
    return spawnSync('bash', ['-c', `${definition('env_value')}\n${definition('cook_env_complete')}\ncook_env_complete "$1"`, 'cook', file]).status;
  };
  const base = 'COOK_ENGINE_REF=v0.1.6\nWILDSHARD_BUILD=b1\nWILDSHARD_API_URL=https://api.wildshard.io\nCOOK_NOTIFY_TOKEN=0123456789abcdef0123\n';
  const r2 = 'R2_ACCOUNT_ID=a\nR2_BUCKET_PACKS=wildshard-packs\nR2_PACKS_ACCESS_KEY_ID=k\nR2_PACKS_SECRET_ACCESS_KEY=s\nCOOK_STORE_DIR=\n';
  expect(complete(base + r2)).toBe(0);
  expect(complete(`${base}R2_ACCOUNT_ID=\nR2_BUCKET_PACKS=wildshard-packs\nR2_PACKS_ACCESS_KEY_ID=\nR2_PACKS_SECRET_ACCESS_KEY=\nCOOK_STORE_DIR=/var/lib/wildshard-cook/store\n`)).toBe(0);
  expect(complete(base + r2.replace('R2_PACKS_SECRET_ACCESS_KEY=s', 'R2_PACKS_SECRET_ACCESS_KEY='))).not.toBe(0);
  for (const name of ['COOK_ENGINE_REF', 'WILDSHARD_BUILD', 'WILDSHARD_API_URL', 'COOK_NOTIFY_TOKEN']) {
    expect(complete(base.replace(new RegExp(`^${name}=.*$`, 'm'), `${name}=`) + r2), name).not.toBe(0);
  }
  // The template rebuild.sh writes is incomplete as written, so a fresh box waits rather than starting a worker.
  const template = source.slice(source.indexOf('# C4: the cook worker.'), source.indexOf('EOF', source.indexOf('# C4: the cook worker.')));
  expect(complete(template)).not.toBe(0);
});

test('the staged key is the one setup.sh embeds, read by the same pattern', () => {
  const embedded = /^EXPECTED_RELEASE_PUBLIC_KEY=([0-9a-f]+)$/mu.exec(setup)?.[1];
  expect(embedded).toMatch(/^302a300506032b6570032100[0-9a-f]{64}$/u);
  const read = spawnSync('bash', ['-c', `HERE=scripts/vps; sed -n 's/^EXPECTED_RELEASE_PUBLIC_KEY=\\([0-9a-f]*\\)$/\\1/p' "$HERE/setup.sh"`], { encoding: 'utf8' });
  expect(read.stdout.trim()).toBe(embedded);
  expect(source).not.toMatch(/302a300506032b6570032100[0-9a-f]{64}/u);
  expect(source).toContain('KEY_FILE=/home/raynos/wildshard-e7/release-public-key.hex');
  expect(setup).toContain('KEY_FILE=/home/raynos/wildshard-e7/release-public-key.hex');
});

test('rebuild.sh needs every file setup.sh needs beside it', () => {
  const needed = /for name in ([a-z.\- ]+); do\n\s+if \[ ! -f "\$HERE\/\$name" \]/u.exec(setup)?.[1]?.split(' ') ?? [];
  expect(needed.length).toBeGreaterThan(4);
  const listed = /for name in ([a-z.\- ]+); do\n\s+if \[ ! -f "\$HERE\/\$name" \]; then say stop "\$name must sit beside rebuild.sh"/u.exec(source)?.[1]?.split(' ') ?? [];
  for (const name of needed) expect(listed, name).toContain(name);
});

test('the cook worker keeps off the game ports and runs each job without a network', () => {
  expect(source).toMatch(/^COOK_PORT=8792$/mu);
  const unit = source.slice(source.indexOf('wildshard-cook.service" 644'), source.indexOf('WantedBy=multi-user.target', source.indexOf('wildshard-cook.service" 644')));
  expect(unit).toContain('Environment=COOK_PORT=$COOK_PORT');
  expect(unit).toContain('Environment=COOK_HOST=127.0.0.1');
  // systemd strips double quotes from a bare Environment= value; the JSON survives only inside single quotes.
  expect(unit).toContain(`Environment='COOK_JOB_WRAP=["$COOK_LIB/unshare","--user","--map-root-user","--net"]'`);
  expect(unit).toContain('ExecStartPre=$COOK_LIB/unshare --user --map-root-user --net /bin/true');
  expect(unit).toContain('User=wildshard-cook');
  expect(unit).not.toMatch(/MemoryDenyWriteExecute/u);
  expect(readFileSync('scripts/cook-worker.mjs', 'utf8')).toContain('env.COOK_PORT ?? 8792');
});

test('Caddy is never started by the rebuild, and only the package file or its own placeholder is replaced', () => {
  const root = scratch(), caddyfile = join(root, 'Caddyfile'), shipped = ':80 {\n\troot * /usr/share/caddy\n\tfile_server\n}\n';
  const md5 = createHash('md5').update(shipped).digest('hex');
  const placeholder = /^CADDY_PLACEHOLDER="([^"]+)"$/mu.exec(source)?.[1];
  expect(placeholder).toContain('port 443 opens by Jake');
  const isDefault = (text: string | undefined): number | null => {
    if (text === undefined) rmSync(caddyfile, { force: true }); else writeFileSync(caddyfile, text);
    // dpkg's own record of the shipped conffile: its path and md5.
    const dpkg = `dpkg-query() { printf ' /etc/caddy/Caddyfile ${md5}\\n'; }; md5sum() { command md5 -q 2>/dev/null || command md5sum; }`;
    const script = `${dpkg}\nCADDY_PLACEHOLDER="${placeholder ?? ''}"\n${definition('caddy_default').replaceAll('local file=/etc/caddy/Caddyfile', `local file=${caddyfile}`).replace('$1 == f', '$1 == "/etc/caddy/Caddyfile"')}\ncaddy_default`;
    return spawnSync('bash', ['-c', script]).status;
  };
  expect(isDefault(shipped)).toBe(0);
  expect(isDefault(undefined)).toBe(0);
  expect(isDefault(`${placeholder ?? ''}\n`)).toBe(0);
  // VH9's file, even one that names the default page in a comment, is never the package's.
  expect(isDefault('rooms.wildshard.io {\n\treverse_proxy 127.0.0.1:8790\n}\n')).not.toBe(0);
  expect(isDefault(`# was root * /usr/share/caddy\n${shipped}`)).not.toBe(0);
  expect(source).toContain("printf '#!/bin/sh\\nexit 101\\n' > \"$policy\"");
  expect(source).toContain('mv -f -- "$saved" "$policy"');
  expect(source).toContain('systemctl disable --now --quiet caddy.service');
  expect(source).not.toMatch(/systemctl (enable|start|restart)[^\n]*caddy/u);
});

test('a blank COOK_STORE_DIR means R2, and the template leaves it commented', () => {
  expect(readFileSync('scripts/cook-worker.mjs', 'utf8')).toContain("env.COOK_STORE_DIR === undefined || env.COOK_STORE_DIR === ''");
  expect(source).toMatch(/^# COOK_STORE_DIR=\/var\/lib\/wildshard-cook\/store$/mu);
  expect(source).not.toMatch(/^COOK_STORE_DIR=$/mu);
});
