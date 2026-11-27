// oxlint-disable-next-line import/no-nodejs-modules -- Isolated checks run bash functions with fake paths.
import { spawnSync } from 'node:child_process'
// oxlint-disable-next-line import/no-nodejs-modules -- The md5 dpkg records for a conffile.
import { createHash } from 'node:crypto'
// MMO-PLAN MP0.1: rebuild.sh's own decisions, read out of the script and run with fake paths. The whole script runs only on a
// throwaway box (src/scripts/vps-rebuild-proof.sh), never here and never on the VPS.
// oxlint-disable-next-line import/no-nodejs-modules -- Read the script without invoking its root entry.
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
// oxlint-disable-next-line import/no-nodejs-modules -- Checkout-relative test files, never privileged paths.
import { join, resolve } from 'node:path'

import { afterEach, expect, test } from 'vitest'

const source = readFileSync('src/scripts/vps/rebuild.sh', 'utf8'),
  setup = readFileSync('src/scripts/vps/setup.sh', 'utf8')
function definition(name: string): string {
  const start = source.indexOf(`${name}() {`)
  if (start === -1) throw new Error(`Missing ${name}`)
  return source.slice(start, source.indexOf('\n}', start) + 2)
}
const roots: string[] = []
function scratch(): string {
  mkdirSync('tmp', { recursive: true })
  const root = mkdtempSync(resolve('tmp/vps-rebuild-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

test('the hard stop refuses any host that still holds the old box data, and passes a fresh one', () => {
  const root = scratch()
  const check = (markers: string[]): ReturnType<typeof spawnSync> =>
    spawnSync(
      'bash',
      [
        '-c',
        `say() { printf '%s %s\\n' "$1" "$2"; }; LIVE_MARKERS=(${markers.map(m => `'${m}'`).join(' ')}); ${definition('live_box')}\nif live_box; then exit 3; fi`,
      ],
      { encoding: 'utf8' },
    )
  const fresh = check([
    join(root, 'home/clawdbot'),
    join(root, 'var/snap/ollama'),
  ])
  expect(fresh.status).toBe(0)
  for (const marker of [
    'home/clawdbot',
    'home/matt',
    'var/snap/ollama',
    'home/raynos/.openclaw',
  ]) {
    mkdirSync(join(root, marker), { recursive: true })
    const refused = check([
      join(root, 'home/clawdbot'),
      join(root, 'home/matt'),
      join(root, 'var/snap/ollama'),
      join(root, 'home/raynos/.openclaw'),
    ])
    expect(refused.status, marker).toBe(3)
    expect(refused.stdout).toContain(join(root, marker))
    expect(refused.stdout).toContain('OPENCLAW-EXTRACT OX10')
    rmSync(join(root, marker), { recursive: true })
  }
})

test('the hard stop runs before any other step, in both modes', () => {
  const guard = source.indexOf('if live_box; then exit 3; fi')
  expect(guard).toBeGreaterThan(0)
  for (const later of [
    'apt-get',
    'useradd',
    'systemctl',
    'bash "$HERE/setup.sh"',
    'id -u',
  ])
    expect(source.indexOf(later), later).toBeGreaterThan(guard)
  // Every home's OpenClaw folder and unit, as OPENCLAW-EXTRACT's survey found them.
  for (const marker of [
    '/home/clawdbot',
    '/home/matt',
    '/var/snap/ollama',
    '/var/lib/docker/volumes/coolify-db',
    '/home/*/.openclaw',
    'openclaw-gateway.service',
  ])
    expect(source).toContain(marker)
})

test('the cook worker waits for its credentials and exactly one kind of store', () => {
  const root = scratch(),
    file = join(root, 'cook.env')
  const settings = join(root, 'cook.settings')
  const complete = (text: string, choice = ''): number | null => {
    writeFileSync(file, text)
    writeFileSync(settings, choice)
    return spawnSync('bash', [
      '-c',
      `COOK_SETTINGS="$2"\n${definition('env_value')}\n${definition('cook_value')}\n${definition('cook_env_complete')}\ncook_env_complete "$1"`,
      'cook',
      file,
      settings,
    ]).status
  }
  const base = 'COOK_NOTIFY_TOKEN=0123456789abcdef0123\n'
  const r2 =
    'R2_ACCOUNT_ID=a\nR2_BUCKET_PACKS=wildshard-packs\nR2_PACKS_ACCESS_KEY_ID=k\nR2_PACKS_SECRET_ACCESS_KEY=s\nCOOK_STORE_DIR=\n'
  expect(complete(base + r2)).toBe(0)
  expect(
    complete(
      `${base}R2_ACCOUNT_ID=\nR2_BUCKET_PACKS=wildshard-packs\nR2_PACKS_ACCESS_KEY_ID=\nR2_PACKS_SECRET_ACCESS_KEY=\nCOOK_STORE_DIR=/var/lib/wildshard-cook/store\n`,
    ),
  ).toBe(0)
  expect(
    complete(
      base +
        r2.replace(
          'R2_PACKS_SECRET_ACCESS_KEY=s',
          'R2_PACKS_SECRET_ACCESS_KEY=',
        ),
    ),
  ).not.toBe(0)
  for (const name of ['COOK_NOTIFY_TOKEN']) {
    expect(
      complete(base.replace(new RegExp(`^${name}=.*$`, 'm'), `${name}=`) + r2),
      name,
    ).not.toBe(0)
  }
  const cooked =
    'R2_ACCOUNT_ID=a\nR2_COOKED_ACCESS_KEY_ID=k\nR2_COOKED_SECRET_ACCESS_KEY=s\n'
  const versioned = 'COOK_VERSIONED_STORE=1\n'
  expect(complete(base + versioned + cooked)).toBe(0)
  expect(complete(base + cooked, versioned)).toBe(0)
  expect(complete(base + versioned + cooked, 'COOK_VERSIONED_STORE=0\n')).not.toBe(0)
  expect(complete(base + versioned + r2)).not.toBe(0)
  expect(complete(base + cooked)).not.toBe(0)
  // The template rebuild.sh writes is incomplete as written, so a fresh box waits rather than starting a worker.
  const template = source.slice(
    source.indexOf('# C4: the cook worker.'),
    source.indexOf('EOF', source.indexOf('# C4: the cook worker.')),
  )
  expect(complete(template)).not.toBe(0)
})

test('AUTO-RELEASE AR3: cook.settings wins over cook.env as systemd reads them, and --cook runs step 4 alone', () => {
  const root = scratch(), env = join(root, 'cook.env'), settings = join(root, 'cook.settings');
  writeFileSync(env, 'COOK_ENGINE_REF=v0.1.18\nWILDSHARD_BUILD=aaaa\nCOOK_NOTIFY_TOKEN=t\n');
  const value = (name: string) => spawnSync('bash', ['-c', `COOK_SETTINGS="$2"\n${definition('env_value')}\n${definition('cook_value')}\ncook_value "$1" "$3"`, 'cook', env, settings, name], { encoding: 'utf8' }).stdout.trim();
  // No settings file: cook.env's, as before AR3.
  expect(value('COOK_ENGINE_REF')).toBe('v0.1.18');
  writeFileSync(settings, '# header\nCOOK_ENGINE_REF=v0.1.20\nWILDSHARD_BUILD=38d11acac5103afcdf9df877dc6be9671d666b75\n');
  expect(value('COOK_ENGINE_REF')).toBe('v0.1.20');
  expect(value('WILDSHARD_BUILD')).toBe('38d11acac5103afcdf9df877dc6be9671d666b75');
  // Keys it does not hold, the secrets among them, stay cook.env's.
  expect(value('COOK_NOTIFY_TOKEN')).toBe('t');
  // A blank key in the later file is blank to systemd too, so the cook waits rather than run a ref no one named.
  writeFileSync(settings, 'COOK_ENGINE_REF=\n');
  expect(value('COOK_ENGINE_REF')).toBe('');
  // The unit reads the settings after the secrets, and a missing settings file is fine.
  const unit = source.slice(source.indexOf('wildshard-cook.service" 644'), source.indexOf('WantedBy=multi-user.target', source.indexOf('wildshard-cook.service" 644')));
  expect(unit.indexOf('EnvironmentFile=$COOK_ENV')).toBeGreaterThan(-1);
  expect(unit.indexOf('EnvironmentFile=-$COOK_SETTINGS')).toBeGreaterThan(unit.indexOf('EnvironmentFile=$COOK_ENV'));
  expect(source).toContain('COOK_REF=$(cook_value "$COOK_ENV" COOK_ENGINE_REF)');
  // The restart hash covers both files, and is cook.env's own hash while no settings file exists (no restart on upgrade).
  const hash = (path: string) => spawnSync('bash', ['-c', `set -euo pipefail\nCOOK_ENV="$1" COOK_SETTINGS="$2"\n${definition('cook_env_hash')}\ncook_env_hash`, 'cook', env, path], { encoding: 'utf8' }).stdout.trim();
  expect(hash(join(root, 'missing'))).toBe(createHash('sha256').update(readFileSync(env)).digest('hex'));
  expect(hash(settings)).not.toBe(hash(join(root, 'missing')));
  // --cook skips steps 1 to 3: the packages, harden.sh and setup.sh sit inside its guard, the cook step outside it.
  const guard = source.indexOf('if [ "$COOK_ONLY" = 0 ]; then'), end = source.indexOf('fi # COOK_ONLY: --cook skips steps 1 to 3');
  expect(guard).toBeGreaterThan(-1);
  for (const inside of ['# --- 1. Packages', 'bash "$HERE/harden.sh"', 'bash "$HERE/setup.sh"']) {
    expect(source.indexOf(inside), inside).toBeGreaterThan(guard);
    expect(source.indexOf(inside), inside).toBeLessThan(end);
  }
  expect(source.indexOf('# --- 4. The cook worker')).toBeGreaterThan(end);
  expect(spawnSync('bash', ['src/scripts/vps/rebuild.sh', '--cook', '--check'], { encoding: 'utf8' }).stdout).toContain('Expected no arguments, --check or --cook');
});

test('the staged key is the one setup.sh embeds, read by the same pattern', () => {
  const embedded = /^EXPECTED_RELEASE_PUBLIC_KEY=([0-9a-f]+)$/mu.exec(
    setup,
  )?.[1]
  expect(embedded).toMatch(/^302a300506032b6570032100[0-9a-f]{64}$/u)
  const read = spawnSync(
    'bash',
    [
      '-c',
      `HERE=src/scripts/vps; sed -n 's/^EXPECTED_RELEASE_PUBLIC_KEY=\\([0-9a-f]*\\)$/\\1/p' "$HERE/setup.sh"`,
    ],
    { encoding: 'utf8' },
  )
  expect(read.stdout.trim()).toBe(embedded)
  expect(source).not.toMatch(/302a300506032b6570032100[0-9a-f]{64}/u)
  expect(source).toContain(
    'KEY_FILE=/home/raynos/wildshard-e7/release-public-key.hex',
  )
  expect(setup).toContain(
    'KEY_FILE=/home/raynos/wildshard-e7/release-public-key.hex',
  )
})

test('rebuild.sh needs every file setup.sh needs beside it', () => {
  const needed =
    /for name in ([a-z.\- ]+); do\n\s+if \[ ! -f "\$HERE\/\$name" \]/u
      .exec(setup)?.[1]
      ?.split(' ') ?? []
  expect(needed.length).toBeGreaterThan(4)
  const listed =
    /REQUIRED=\(([a-z.\- ]+)\)/u.exec(source)?.[1]?.split(' ') ?? []
  for (const name of needed) expect(listed, name).toContain(name)
})

test('the cook worker keeps off the game ports and runs each job without a network', () => {
  expect(source).toMatch(/^COOK_PORT=8792$/mu)
  const unit = source.slice(
    source.indexOf('wildshard-cook.service" 644'),
    source.indexOf(
      'WantedBy=multi-user.target',
      source.indexOf('wildshard-cook.service" 644'),
    ),
  )
  expect(unit).toContain('Environment=COOK_PORT=$COOK_PORT')
  expect(unit).toContain('Environment=COOK_HOST=127.0.0.1')
  // systemd strips double quotes from a bare Environment= value; the JSON survives only inside single quotes.
  expect(unit).toContain(
    `Environment='COOK_JOB_WRAP=["$COOK_LIB/unshare","--user","--map-root-user","--net"]'`,
  )
  expect(unit).toContain(
    'ExecStartPre=$COOK_LIB/unshare --user --map-root-user --net /bin/true',
  )
  expect(unit).toContain('User=wildshard-cook')
  expect(unit).not.toMatch(/MemoryDenyWriteExecute/u)
  expect(readFileSync('src/scripts/cook-worker.mjs', 'utf8')).toContain(
    'env.COOK_PORT ?? 8792',
  )
})

test('MS2.4b: the cook reads and enters its root-owned checkout, and git trusts it', () => {
  const unit = source.slice(
    source.indexOf('wildshard-cook.service" 644'),
    source.indexOf(
      'WantedBy=multi-user.target',
      source.indexOf('wildshard-cook.service" 644'),
    ),
  )
  expect(unit).toContain(
    'Environment=GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0=$COOK_SRC',
  )
  expect(source).toMatch(/^COOK_GROUP=wildshard-cook$/mu)
  expect(source).toContain(
    'step "cook source readable by $COOK_GROUP" have_cook_read make_cook_read',
  )
  // a group this user is in but files here don't start with: the check sees the wrong group, the repair sets it
  const mine = spawnSync('id', ['-Gn'], { encoding: 'utf8' })
    .stdout.trim()
    .split(/\s+/u)
  const start = spawnSync(
    'stat',
    process.platform === 'darwin' ? ['-f', '%Sg', '.'] : ['-c', '%G', '.'],
    { encoding: 'utf8' },
  ).stdout.trim()
  const group = mine.find(name => name !== start) ?? mine[0] ?? ''
  const root = scratch(),
    src = join(root, 'engine')
  // the umask-027 shape: directories 750, files 640, one 600 and one group-writable, and the worker's hash 600
  mkdirSync(join(src, 'src/scripts/deep'), { recursive: true, mode: 0o750 })
  writeFileSync(join(src, 'src/scripts/cook-worker.mjs'), 'x', { mode: 0o640 })
  writeFileSync(join(src, 'src/scripts/deep/private.json'), '{}', { mode: 0o600 })
  writeFileSync(join(src, 'src/scripts/deep/shared.json'), '{}', { mode: 0o664 })
  writeFileSync(join(src, '.wildshard-env'), 'hash', { mode: 0o600 })
  spawnSync('chmod', [
    '750',
    src,
    join(src, 'src'),
    join(src, 'src/scripts'),
    join(src, 'src/scripts/deep'),
  ])
  const run = (name: string) =>
    spawnSync(
      'bash',
      [
        '-c',
        `COOK_SRC="$1" COOK_GROUP="$2"\n${definition('cook_unreadable')}\n${definition('have_cook_read')}\n${definition('make_cook_read')}\n${name}`,
        'rebuild',
        src,
        group,
      ],
      { encoding: 'utf8' },
    )
  expect(run('have_cook_read').status).toBe(1)
  expect(run('make_cook_read').status).toBe(0)
  expect(run('have_cook_read').status).toBe(0)
  const mode = (path: string) =>
    spawnSync(
      'stat',
      process.platform === 'darwin'
        ? ['-f', '%Lp %Sg', path]
        : ['-c', '%a %G', path],
      { encoding: 'utf8' },
    ).stdout.trim()
  expect(mode(src)).toBe(`750 ${group}`)
  expect(mode(join(src, 'src/scripts/deep'))).toBe(`750 ${group}`)
  expect(mode(join(src, 'src/scripts/deep/private.json'))).toBe(`640 ${group}`)
  expect(mode(join(src, 'src/scripts/deep/shared.json'))).toBe(`644 ${group}`)
  expect(mode(join(src, '.wildshard-env'))).toBe(`600 ${start}`)
})

test('MS2.4b: pnpm uses a root-owned store outside protected homes', () => {
  expect(source).toMatch(/^COOK_PNPM_STORE=\/var\/lib\/wildshard-pnpm-store$/mu)
  expect(source).toContain(
    'step "cook pnpm store $COOK_PNPM_STORE" have_cook_store make_cook_store',
  )
  expect(source).toContain('! -user root -o ! -group "$COOK_GROUP"')
  expect(source).toContain('chown root:"$COOK_GROUP"')
  expect(source).toContain(
    '--config.ci=false --store-dir "$COOK_PNPM_STORE" --virtual-store-dir "$COOK_PNPM_STORE/v10/links"',
  )
  expect(source).toContain('"$NODE" src/scripts/.kit/assert-store-layout.mjs')
  expect(source).toContain('ProtectHome=yes')
})

test('MS2.4a: staging chooses the cook ref and build, and a root timer follows it', () => {
  const unit = source.slice(
    source.indexOf('wildshard-cook.service" 644'),
    source.indexOf(
      'WantedBy=multi-user.target',
      source.indexOf('wildshard-cook.service" 644'),
    ),
  )
  expect(unit).toContain('EnvironmentFile=$COOK_STATE')
  expect(unit).toContain(
    'Environment=WILDSHARD_API_URL=https://api.wildshard.io',
  )
  expect(source).toContain(
    'cook-follow.mjs" --env "$ETC/staging.env" --state "$COOK_STATE"',
  )
  expect(source).toContain(
    'ExecStart=/usr/bin/bash $COOK_LIB/rebuild.sh --cook',
  )
  expect(source).toContain('OnUnitActiveSec=5min')
  expect(source).toContain(
    'install -m 750 -o root -g root "$HERE/cook-follow.mjs" "$COOK_LIB/cook-follow.mjs"',
  )
  expect(source).toContain(
    "The signed release's $COOK_REF does not resolve to $COOK_BUILD",
  )
  const template = source.slice(
    source.indexOf('# C4: the cook worker.'),
    source.indexOf('EOF', source.indexOf('# C4: the cook worker.')),
  )
  expect(template).not.toContain('COOK_ENGINE_REF=')
  expect(template).not.toContain('WILDSHARD_BUILD=')
})

test('Caddy is never started by the rebuild, and only the package file or its own placeholder is replaced', () => {
  const root = scratch(),
    caddyfile = join(root, 'Caddyfile'),
    shipped = ':80 {\n\troot * /usr/share/caddy\n\tfile_server\n}\n'
  const md5 = createHash('md5').update(shipped).digest('hex')
  const placeholder = /^CADDY_PLACEHOLDER="([^"]+)"$/mu.exec(source)?.[1]
  expect(placeholder).toContain('port 443 opens by Jake')
  const isDefault = (text: string | undefined): number | null => {
    if (text === undefined) rmSync(caddyfile, { force: true })
    else writeFileSync(caddyfile, text)
    // dpkg's own record of the shipped conffile: its path and md5.
    const dpkg = `dpkg-query() { printf ' /etc/caddy/Caddyfile ${md5}\\n'; }; md5sum() { command md5 -q 2>/dev/null || command md5sum; }`
    const script = `${dpkg}\nCADDY_PLACEHOLDER="${placeholder ?? ''}"\n${definition('caddy_default').replaceAll('local file=/etc/caddy/Caddyfile', `local file=${caddyfile}`).replace('$1 == f', '$1 == "/etc/caddy/Caddyfile"')}\ncaddy_default`
    return spawnSync('bash', ['-c', script]).status
  }
  expect(isDefault(shipped)).toBe(0)
  expect(isDefault(undefined)).toBe(0)
  expect(isDefault(`${placeholder ?? ''}\n`)).toBe(0)
  // VH9's file, even one that names the default page in a comment, is never the package's.
  expect(
    isDefault('rooms.wildshard.io {\n\treverse_proxy 127.0.0.1:8790\n}\n'),
  ).not.toBe(0)
  expect(isDefault(`# was root * /usr/share/caddy\n${shipped}`)).not.toBe(0)
  expect(source).toContain('printf \'#!/bin/sh\\nexit 101\\n\' > "$policy"')
  expect(source).toContain('mv -f -- "$saved" "$policy"')
  expect(source).toContain('systemctl disable --now --quiet caddy.service')
  expect(source).not.toMatch(/systemctl (enable|start|restart)[^\n]*caddy/u)
})

test('a blank COOK_STORE_DIR means R2, and the template leaves it commented', () => {
  expect(readFileSync('src/scripts/cook-worker.mjs', 'utf8')).toContain(
    "storeDirectory !== undefined && storeDirectory !== ''",
  )
  expect(source).toMatch(
    /^# COOK_STORE_DIR=\/var\/lib\/wildshard-cook\/store$/mu,
  )
  expect(source).not.toMatch(/^COOK_STORE_DIR=$/mu)
})

test('MS2.4b: the follow timer starts when installed, not at the next boot', () => {
  // `enable` alone left the box's timer inactive from its install until a reboot (opus-mmoserver, 2026-11-17).
  expect(source).toContain('systemctl enable --now --quiet wildshard-cook-follow.timer')
  expect(source).not.toMatch(/systemctl enable --quiet wildshard-cook-follow\.timer/u)
})

test('MS2.4b: while cook.settings names the ref, a new staging follow state restarts nobody', () => {
  const root = scratch(),
    env = join(root, 'cook.env'),
    state = join(root, 'cook-release.env'),
    settings = join(root, 'cook.settings')
  writeFileSync(env, 'COOK_NOTIFY_TOKEN=t\n')
  const hash = (settingsPath: string) =>
    spawnSync(
      'bash',
      [
        '-c',
        `set -euo pipefail\nCOOK_ENV="$1" COOK_STATE="$2" COOK_SETTINGS="$3"\n${definition('cook_settings_pin')}\n${definition('cook_env_hash')}\ncook_env_hash`,
        'cook',
        env,
        state,
        settingsPath,
      ],
      { encoding: 'utf8' },
    ).stdout.trim()
  writeFileSync(settings, 'COOK_ENGINE_REF=v0.1.34\nWILDSHARD_BUILD=bc945fb23549cc9a41c645966f12c94c0f4f4c24\n')
  writeFileSync(state, 'COOK_ENGINE_REF=server-staging-aaaa\nWILDSHARD_BUILD=aaaa\n')
  const pinned = hash(settings)
  writeFileSync(state, 'COOK_ENGINE_REF=server-staging-bbbb\nWILDSHARD_BUILD=bbbb\n')
  expect(hash(settings)).toBe(pinned)
  // Without the settings the follow state is what the worker runs, so a new one restarts it.
  const missing = join(root, 'missing')
  const before = hash(missing)
  writeFileSync(state, 'COOK_ENGINE_REF=server-staging-cccc\nWILDSHARD_BUILD=cccc\n')
  expect(hash(missing)).not.toBe(before)
})

// FAST-RELEASE FR-A22 (11-25): on Postgres's 13-15 alone the cook's encoder ran 2 lanes and Pine cooked in 849 s on the box
// against 258 s on the MacBook's 6, at a box load of 0.12. The cook takes staging's 9-12 too, at a low weight and nice, so
// rooms and Postgres win contention, and never production's 0-8.
test('FR-A22: the cook runs on CPUs 9-15 at a low weight, never production\'s', () => {
  const start = source.indexOf('wildshard-cook.service" 644'), unit = source.slice(start, source.indexOf('WantedBy=multi-user.target', start))
  expect(unit).toContain('\n$COOK_CPUS\n')
  expect(unit).not.toContain('$SHARED_CPUS')
  expect(source).toContain("COOK_CPUS='AllowedCPUs=9-15'")
  expect(unit).toMatch(/^CPUWeight=20$/mu)
  expect(unit).toMatch(/^Nice=10$/mu)
  // production's rooms keep 0-8 to themselves (setup.sh), and 9-15 never reaches into them
  expect(readFileSync('src/scripts/vps/setup.sh', 'utf8')).toContain('wildshard-server@production.service.d/cpus.conf <<\'EOF\'\n[Service]\nAllowedCPUs=0-8\n')
})
