// MMO-SERVER MP1.2.d: the cap bench's replica on the box. replica.mjs and wildshard-config's `replica` verb honour their test
// switches only when not root, so these run as the developer with stand-ins for systemd-run, systemctl and tailscale.
// oxlint-disable-next-line import/no-nodejs-modules -- The real helpers, on a made-up /etc.
import { spawnSync } from 'node:child_process'
// oxlint-disable-next-line import/no-nodejs-modules -- Test keys and a test bundle's digest only.
import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
// oxlint-disable-next-line import/no-nodejs-modules -- A made-up box in the checkout's tmp/.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { join, resolve } from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { doorArgs, limits, RELEASE_PUBLIC_KEY, replicaRelease, SCRATCH_HBA, scratchUrl, stagingRelease, unitArgs } from '../src/scripts/vps/replica.mjs'

const REPLICA = resolve('src/scripts/vps/replica.mjs'), CONFIG = resolve('src/scripts/vps/wildshard-config')
const key = generateKeyPairSync('ed25519')
const publicKey = key.publicKey.export({ type: 'spki', format: 'der' }).toString('hex')
const build = 'c'.repeat(40)
const made: string[] = []
afterEach(() => {
  for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true })
})
function scratch(): string {
  mkdirSync('tmp/vps-replica', { recursive: true })
  const top = mkdtempSync(resolve('tmp/vps-replica/run-'))
  made.push(top)
  return top
}
function signed(body: Record<string, unknown>, privateKey = key.privateKey): string {
  const text = JSON.stringify(body)
  return JSON.stringify({ body: text, signature: sign(null, Buffer.from(text), privateKey).toString('hex') })
}
const staging = (sha256 = 'd'.repeat(64), extra: Record<string, unknown> = {}) =>
  signed({
    channel: 'staging', serial: 98, engineBuild: build, saveEpoch: 1, shards: [{ slug: 'driftwood-isle', revision: 3 }],
    bundle: { name: `server-staging-${build}/engine-server-${build}.tar.gz`, sha256 }, ...extra,
  })

test('replica.mjs pins the release key setup.sh embeds', () => {
  const setup = readFileSync('src/scripts/vps/setup.sh', 'utf8')
  expect(/^EXPECTED_RELEASE_PUBLIC_KEY=([0-9a-f]+)$/mu.exec(setup)?.[1]).toBe(RELEASE_PUBLIC_KEY)
})

test("only staging's own signed release is believed", () => {
  expect(stagingRelease(staging(), publicKey)?.engineBuild).toBe(build)
  const other = generateKeyPairSync('ed25519')
  expect(stagingRelease(staging(), other.publicKey.export({ type: 'spki', format: 'der' }).toString('hex'))).toBeNull()
  expect(stagingRelease(staging('d'.repeat(64), { channel: 'production' }), publicKey)).toBeNull()
  expect(stagingRelease(staging('d'.repeat(64), { bundle: { name: '../../etc/shadow', sha256: 'd'.repeat(64) } }), publicKey)).toBeNull()
  expect(stagingRelease(staging('not-hex'), publicKey)).toBeNull()
  expect(stagingRelease('{"body":"{}","signature":"zz"}', publicKey)).toBeNull()
})

test("the replica's one-off release is production's shape for staging's build, under its own fresh key", () => {
  const release = stagingRelease(staging(), publicKey)
  if (release === null) throw new Error('unsigned')
  const own = replicaRelease(release), file = JSON.parse(own.text) as { body: string, signature: string }
  const spki = createPublicKey({ key: Buffer.from(own.publicKey, 'hex'), format: 'der', type: 'spki' })
  expect(verify(null, Buffer.from(file.body), spki, Buffer.from(file.signature, 'hex'))).toBe(true)
  expect(JSON.parse(file.body)).toEqual({ channel: 'production', serial: 1, engineBuild: build, saveEpoch: 1, shards: release.shards })
  expect(own.publicKey).not.toBe(publicKey)
})

test('the unit is sandboxed, bounded, on staging CPUs and the tailnet, and holds no secret of the box', () => {
  const words = unitArgs({ seconds: 1900, workers: 4, seats: 32, cells: 'driftwood-isle', host: '100.70.1.2', publicKey: 'ab', folder: '/var/lib/wildshard-replica' })
  for (const word of ['--unit=wildshard-replica', '--collect', '--pipe', 'DynamicUser=yes', 'AllowedCPUs=9-12', 'MemoryMax=6G', 'RuntimeMaxSec=1900', 'OOMScoreAdjust=1000',
    'ProtectSystem=strict', 'NoNewPrivileges=yes', 'CapabilityBoundingSet=', 'HOST=127.0.0.1', 'PORT=18797', 'DATABASE_URL=memory:',
    'RELEASE_CHANNEL=production', 'RELEASE_PUBLIC_KEY=ab', 'SENTRY_DSN=', 'TELEMETRY_URL=', 'ERRORS_URL=', 'WORLD_SEATS=32', 'WORLD_WORKERS=4'])
    expect(words, word).toContain(word)
  expect(words.at(-1)).toBe('/var/lib/wildshard-replica/server/main.mjs')
  expect(() => unitArgs({ seconds: 60, workers: 1, seats: 1, cells: 'a', host: '0.0.0.0', publicKey: 'ab', folder: '/x' })).toThrow('not a tailnet address')
  expect(() => unitArgs({ seconds: 60, workers: 1, seats: 1, cells: 'a', host: '46.1.2.3', publicKey: 'ab', folder: '/x' })).toThrow('not a tailnet address')
  // The door: the tailnet address alone, handed to the replica's loopback, so its door trusts each bot's forwarded address.
  const door = doorArgs({ seconds: 1900, host: '100.70.1.2' })
  for (const word of ['--unit=wildshard-replica-door', '--socket-property=ListenStream=100.70.1.2:18796', 'DynamicUser=yes', 'RuntimeMaxSec=1900',
    '/usr/lib/systemd/systemd-socket-proxyd', '127.0.0.1:18797'])
    expect(door, word).toContain(word)
  expect(door.filter(word => word.startsWith('--socket-property='))).toEqual(['--socket-property=ListenStream=100.70.1.2:18796'])
  expect(() => doorArgs({ seconds: 60, host: '46.1.2.3' })).toThrow('not a tailnet address')
})

test('the bounds: 60 to 3,900 seconds, 1 to 4 workers, 1 to 64 seats, up to 8 cell slugs', () => {
  expect(limits(['1800', '4', '32', 'driftwood-isle'])).toEqual({ seconds: 1800, workers: 4, seats: 32, cells: 'driftwood-isle', saves: 'memory' })
  for (const bad of [['59', '4', '32', 'a'], ['3901', '4', '32', 'a'], ['600', '5', '32', 'a'], ['600', '4', '65', 'a'], ['600', '4', '0', 'a'],
    ['600', '4', '32', 'A;rm'], ['600', '4', '32', 'a,b,c,d,e,f,g,h,i'], ['600', '4', '32']])
    expect(limits(bad), bad.join(' ')).toBeNull()
})

/** A made-up box: staging.env, the signed file and the bundle behind fetch, and stand-ins that log what they were asked. */
function box(bundleSha?: string) {
  const root = scratch(), bin = join(root, 'bin'), log = join(root, 'calls.log')
  mkdirSync(join(root, 'etc/wildshard'), { recursive: true })
  mkdirSync(join(root, 'fetch'), { recursive: true })
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(root, 'etc/wildshard/staging.env'),
    'RELEASE_URL=https://packs.example/releases/staging.json\nBUNDLE_ORIGIN=https://bundles.example\nSEAT_SECRET=planted-staging-secret\n')
  const server = join(root, 'bundle')
  mkdirSync(server, { recursive: true })
  writeFileSync(join(server, 'main.mjs'), 'console.log("server")\n')
  spawnSync('tar', ['-czf', join(root, 'bundle.tar.gz'), '-C', server, 'main.mjs'])
  const bytes = readFileSync(join(root, 'bundle.tar.gz'))
  writeFileSync(join(root, 'fetch', encodeURIComponent('https://packs.example/releases/staging.json')),
    staging(bundleSha ?? createHash('sha256').update(bytes).digest('hex')))
  writeFileSync(join(root, 'fetch', encodeURIComponent(`https://bundles.example/server-staging-${build}/engine-server-${build}.tar.gz`)), bytes)
  const stand = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/bash\necho "${name} $*" >> "${log}"\n${body}\n`)
    chmodSync(join(bin, name), 0o755)
    return join(bin, name)
  }
  const env = {
    PATH: process.env['PATH'] ?? '', WILDSHARD_REPLICA_TEST: root, WILDSHARD_REPLICA_TEST_KEY: publicKey,
    WILDSHARD_REPLICA_TEST_SYSTEMCTL: stand('systemctl', '[ "$1" = is-active ] && exit "${ACTIVE:-3}"; exit 0'),
    WILDSHARD_REPLICA_TEST_TAILSCALE: stand('tailscale', 'echo 100.70.1.2'),
    WILDSHARD_REPLICA_TEST_SYSTEMD_RUN: stand('systemd-run', `[ "$1" = --unit=wildshard-replica-door ] && exit 0; cat "${root}/replica/release.json" > "${root}/seen-release.json"; ls -l "${root}/replica/release.json" | cut -c1-10 > "${root}/seen-mode"; ls "${root}/replica/server" > "${root}/seen-server"; echo '{"at":"worker","p95":1}'`),
    WILDSHARD_REPLICA_TEST_CHMOD: stand('chmod', 'exit 0'),
    // E7.4b.b: the scratch cluster's tools. createcluster makes its conf folder, dropcluster removes it, runuser keeps its SQL.
    WILDSHARD_REPLICA_TEST_PG_CREATECLUSTER: stand('pg_createcluster', `mkdir -p "${root}/etc/postgresql/$1/$2" && touch "${root}/etc/postgresql/$1/$2/postgresql.conf" && echo planted > "${root}/etc/postgresql/$1/$2/pg_hba.conf"`),
    WILDSHARD_REPLICA_TEST_PG_CONFTOOL: stand('pg_conftool', 'exit 0'),
    // Debian postgresql@.service uses the unescaped instance (%I) for its config path assertion.
    WILDSHARD_REPLICA_TEST_PG_CTLCLUSTER: stand('pg_ctlcluster', `unit=$(printf '%s-%s' "$1" "$2" | sed 's|-|/|g')
test -f "${root}/etc/postgresql/$unit/postgresql.conf" || exit 1
cp "${root}/etc/postgresql/$unit/pg_hba.conf" "${root}/seen-hba"`),
    WILDSHARD_REPLICA_TEST_PG_DROPCLUSTER: stand('pg_dropcluster', `rm -rf "${root}/etc/postgresql/$2/$3"`),
    WILDSHARD_REPLICA_TEST_RUNUSER: stand('runuser', `cat > "${root}/seen-sql"`),
  }
  return { root, env, calls: () => readFileSync(log, 'utf8') }
}

test('start fetches the signed bundle, runs it as the fixed sandboxed unit, streams its lines and leaves nothing', () => {
  const { root, env, calls } = box()
  // The box's login.defs UMASK is 027: the replica's dynamic user must still read its release file.
  const run = spawnSync('bash', ['-c', 'umask 027; exec node "$@"', 'node', REPLICA, 'start', '600', '4', '32', 'driftwood-isle'], { encoding: 'utf8', env })
  expect(run.status, run.stderr).toBe(0)
  const lines = run.stdout.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
  expect(lines[0]).toMatchObject({ at: 'replica', build, serial: 98, host: '100.70.1.2', port: 18796, cpus: '9-12' })
  expect(lines[1]).toEqual({ at: 'worker', p95: 1 })
  const asked = calls()
  expect(asked).toContain('systemd-run --unit=wildshard-replica-door --collect --quiet --socket-property=ListenStream=100.70.1.2:18796')
  expect(asked).toContain('systemd-run --unit=wildshard-replica --collect --pipe')
  expect(asked).toContain('systemctl stop wildshard-replica.service wildshard-replica-door.socket wildshard-replica-door.service')
  expect(asked).toContain('RuntimeMaxSec=600')
  expect(asked).not.toContain('planted-staging-secret')
  expect(readFileSync(join(root, 'seen-server'), 'utf8')).toContain('main.mjs')
  expect(JSON.parse(JSON.parse(readFileSync(join(root, 'seen-release.json'), 'utf8')).body)).toMatchObject({ channel: 'production', engineBuild: build })
  expect(readFileSync(join(root, 'seen-mode'), 'utf8').trim()).toBe('-rw-r--r--')
  expect(existsSync(join(root, 'replica'))).toBe(false)
})

test('start refuses a bundle that differs from its signed digest, and a second replica while one runs', () => {
  const bad = box('e'.repeat(64))
  const run = spawnSync('node', [REPLICA, 'start', '600', '4', '32', 'driftwood-isle'], { encoding: 'utf8', env: bad.env })
  expect(run.status).toBe(1)
  expect(run.stderr).toContain('differs from its signed SHA-256')
  expect(bad.calls()).not.toContain('systemd-run')
  const busy = box()
  const twice = spawnSync('node', [REPLICA, 'start', '600', '4', '32', 'driftwood-isle'], { encoding: 'utf8', env: { ...busy.env, ACTIVE: '0' } })
  expect(twice.status).toBe(1)
  expect(twice.stderr).toContain('one replica at a time')
})

test('stop ends the fixed unit and removes the folder', () => {
  const { root, env, calls } = box()
  mkdirSync(join(root, 'replica/server'), { recursive: true })
  const run = spawnSync('node', [REPLICA, 'stop'], { encoding: 'utf8', env })
  expect(run.status).toBe(0)
  expect(calls()).toContain('systemctl stop wildshard-replica.service wildshard-replica-door.socket wildshard-replica-door.service')
  expect(existsSync(join(root, 'replica'))).toBe(false)
})

test('wildshard-config replica passes only checked words to the root-owned helper', () => {
  const root = scratch(), seen = join(root, 'seen'), helper = join(root, 'replica.mjs')
  writeFileSync(helper, `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(seen)}, process.argv.slice(2).join(' '))\n`)
  const config = (...args: string[]) => spawnSync('python3', [CONFIG, ...args], { encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '', WILDSHARD_CONFIG_TEST_ROOT: root, WILDSHARD_CONFIG_TEST_REPLICA: helper } })
  expect(config('replica', 'start').status).toBe(0)
  expect(readFileSync(seen, 'utf8')).toBe('start 1800 4 32 driftwood-isle')
  expect(config('replica', 'start', '--seconds', '1900', '--cells', 'driftwood-isle,nalati-grasslands').status).toBe(0)
  expect(readFileSync(seen, 'utf8')).toBe('start 1900 4 32 driftwood-isle,nalati-grasslands')
  expect(config('replica', 'stop').status).toBe(0)
  expect(readFileSync(seen, 'utf8')).toBe('stop')
  rmSync(seen)
  for (const bad of [['--seconds', '4000'], ['--workers', '9'], ['--seats', '100'], ['--cells', 'a;b'], ['--host', '0.0.0.0'], ['--seconds']]) {
    const run = config('replica', 'start', ...bad)
    expect(run.status, bad.join(' ')).toBe(1)
    expect(run.stderr).toContain('usage: wildshard-config replica start')
  }
  expect(existsSync(seen)).toBe(false)
})

test('E7.4b.b: the bounds take memory or postgres saves, and the scratch URL is the replica role on its own socket port', () => {
  expect(limits(['600', '2', '16', 'driftwood-isle', 'postgres'])).toEqual({ seconds: 600, workers: 2, seats: 16, cells: 'driftwood-isle', saves: 'postgres' })
  expect(limits(['600', '2', '16', 'driftwood-isle'])?.saves).toBe('memory')
  for (const bad of [['600', '2', '16', 'a', 'pg'], ['600', '2', '16', 'a', 'postgres', 'x']]) expect(limits(bad), bad.join(' ')).toBeNull()
  const password = 'a'.repeat(48)
  expect(scratchUrl(password)).toBe(`postgresql://replica:${password}@localhost:5439/saves_replica?host=/var/run/postgresql`)
  expect(() => scratchUrl("x';--")).toThrow('hex')
  const words = unitArgs({ seconds: 600, workers: 2, seats: 16, cells: 'a', host: '100.70.1.2', publicKey: 'ab', folder: '/x', database: scratchUrl(password) })
  expect(words).toContain(`DATABASE_URL=${scratchUrl(password)}`)
  for (const database of ['postgresql:///saves_staging?host=/var/run/postgresql', 'postgresql:///saves_production?host=/var/run/postgresql'])
    expect(() => unitArgs({ seconds: 600, workers: 2, seats: 16, cells: 'a', host: '100.70.1.2', publicKey: 'ab', folder: '/x', database })).toThrow('scratch cluster')
  expect(SCRATCH_HBA).toBe('local all postgres peer\nlocal saves_replica replica scram-sha-256\n')
  // Nothing in the helper names the channels' cluster or databases.
  const source = readFileSync(REPLICA, 'utf8')
  for (const name of ['16-main', "'main'", 'saves_production', 'saves_staging', '5432']) expect(source, name).not.toContain(name)
})

test('E7.4b.b: a postgres start makes the scratch cluster, keeps the password off argv, and stop leaves no cluster', () => {
  const { root, env, calls } = box()
  mkdirSync(join(root, 'etc/postgresql/16/wildshard-replica'), { recursive: true })
  const run = spawnSync('node', [REPLICA, 'start', '600', '2', '16', 'driftwood-isle', 'postgres'], { encoding: 'utf8', env })
  expect(run.status, run.stderr).toBe(0)
  const asked = calls(), sql = readFileSync(join(root, 'seen-sql'), 'utf8')
  const password = /PASSWORD '([0-9a-f]{48})'/u.exec(sql)?.[1] ?? ''
  expect(password).toMatch(/^[0-9a-f]{48}$/u)
  expect(sql).toContain('CREATE DATABASE saves_replica OWNER replica;')
  expect(asked).toContain('pg_createcluster 16 wildshard_replica --port 5439')
  expect(asked).toContain('pg_conftool 16 wildshard_replica set listen_addresses')
  expect(asked).toContain('pg_ctlcluster 16 wildshard_replica start')
  expect(asked).toContain('runuser -u postgres -- /usr/bin/psql -X -q -v ON_ERROR_STOP=1 -p 5439 -d postgres')
  expect(asked.split('\n').filter(line => !line.startsWith('systemd-run')).join('\n')).not.toContain(password)
  expect(asked).toContain(`DATABASE_URL=postgresql://replica:${password}@localhost:5439/saves_replica?host=/var/run/postgresql`)
  expect(readFileSync(join(root, 'seen-hba'), 'utf8')).toBe(SCRATCH_HBA)
  expect(asked).toContain('pg_dropcluster --stop 16 wildshard-replica')
  expect(asked).toContain('pg_dropcluster --stop 16 wildshard_replica')
  expect(JSON.parse(run.stdout.trim().split('\n')[0] ?? '{}')).toMatchObject({ at: 'replica', saves: 'postgres' })
  expect(existsSync(join(root, 'etc/postgresql/16/wildshard_replica'))).toBe(false)
  expect(existsSync(join(root, 'etc/postgresql/16/wildshard-replica'))).toBe(false)
  expect(existsSync(join(root, 'replica'))).toBe(false)
})

test('E7.4b.b: pg-restart restarts only the scratch cluster, and only while a replica runs on it', () => {
  const { root, env, calls } = box()
  const none = spawnSync('node', [REPLICA, 'pg-restart'], { encoding: 'utf8', env: { ...env, ACTIVE: '0' } })
  expect(none.status).toBe(1)
  expect(none.stderr).toContain('no replica runs on the scratch cluster')
  mkdirSync(join(root, 'etc/postgresql/16/wildshard_replica'), { recursive: true })
  const idle = spawnSync('node', [REPLICA, 'pg-restart'], { encoding: 'utf8', env })
  expect(idle.status).toBe(1)
  const run = spawnSync('node', [REPLICA, 'pg-restart'], { encoding: 'utf8', env: { ...env, ACTIVE: '0' } })
  expect(run.status, run.stderr).toBe(0)
  expect(JSON.parse(run.stdout.trim())).toMatchObject({ at: 'scratch.restarted', unit: 'postgresql@16-wildshard_replica.service' })
  expect(calls()).toContain('systemctl restart postgresql@16-wildshard_replica.service')
  expect(calls()).not.toContain('16-main')
  const stop = spawnSync('node', [REPLICA, 'stop'], { encoding: 'utf8', env })
  expect(stop.status).toBe(0)
  expect(calls()).toContain('pg_dropcluster --stop 16 wildshard_replica')
  expect(existsSync(join(root, 'etc/postgresql/16/wildshard_replica'))).toBe(false)
})

test.each([false, true])('E7.4b.c: checkpoint restart needs a blocked save witness (%s)', witnessed => {
  const { root, env, calls } = box()
  mkdirSync(join(root, 'etc/postgresql/16/wildshard_replica'), { recursive: true })
  const psql = join(root, 'bin', 'checkpoint-psql')
  writeFileSync(psql, `#!/bin/bash
echo "runuser $*" >> "${root}/calls.log"
while IFS= read -r sql; do
  printf '%s\\n' "$sql" >> "${root}/seen-sql"
  if [[ "$sql" == "SELECT 'checkpoint.waiting';" ]]; then
    if [[ "$WITNESSED" == 1 ]]; then
      echo checkpoint.waiting
    else
      exit 1
    fi
  fi
done
`, { mode: 0o755 })
  const run = spawnSync('node', [REPLICA, 'pg-restart', '--checkpoint'], { encoding: 'utf8', timeout: 5000,
    env: { ...env, ACTIVE: '0', WILDSHARD_REPLICA_TEST_RUNUSER: psql, WITNESSED: witnessed ? '1' : '0' } })
  expect(run.status, run.stderr).toBe(witnessed ? 0 : 1)
  expect(calls()).toContain('runuser -u postgres -- /usr/bin/psql')
  expect(calls()).toContain('-p 5439 -d saves_replica')
  expect(calls()).not.toContain('16-main')
  const sql = readFileSync(join(root, 'seen-sql'), 'utf8')
  expect(sql).toContain('LOCK TABLE public.player_save IN SHARE MODE')
  expect(sql).toContain('pg_blocking_pids')
  if (witnessed) {
    expect(calls()).toContain('systemctl restart postgresql@16-wildshard_replica.service')
    expect(JSON.parse(run.stdout)).toMatchObject({ at: 'scratch.restarted', checkpointInFlight: true })
  } else {
    expect(calls()).not.toContain('systemctl restart')
    expect(run.stderr).toContain('no blocked checkpoint write')
  }
})

test('E7.4b.b: wildshard-config passes --saves and pg-restart through, and nothing else', () => {
  const root = scratch(), seen = join(root, 'seen'), helper = join(root, 'replica.mjs')
  writeFileSync(helper, `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(seen)}, process.argv.slice(2).join(' '))\n`)
  const config = (...args: string[]) => spawnSync('python3', [CONFIG, ...args], { encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '', WILDSHARD_CONFIG_TEST_ROOT: root, WILDSHARD_CONFIG_TEST_REPLICA: helper } })
  expect(config('replica', 'start', '--saves', 'postgres', '--workers', '2').status).toBe(0)
  expect(readFileSync(seen, 'utf8')).toBe('start 1800 2 32 driftwood-isle postgres')
  expect(config('replica', 'start', '--saves', 'memory').status).toBe(0)
  expect(readFileSync(seen, 'utf8')).toBe('start 1800 4 32 driftwood-isle')
  expect(config('replica', 'pg-restart').status).toBe(0)
  expect(readFileSync(seen, 'utf8')).toBe('pg-restart')
  expect(config('replica', 'pg-restart', '--checkpoint').status).toBe(0)
  expect(readFileSync(seen, 'utf8')).toBe('pg-restart --checkpoint')
  rmSync(seen)
  for (const bad of [['start', '--saves', 'main'], ['start', '--saves', 'postgres;id'], ['pg-restart', 'main'], ['pg-restart', '--checkpoint', 'main']]) {
    const run = config('replica', ...bad)
    expect(run.status, bad.join(' ')).toBe(1)
    expect(run.stderr).toContain('usage: wildshard-config replica start')
  }
  expect(existsSync(seen)).toBe(false)
})

test('with no tailnet address the start stops before any fetch, and leaves no folder', () => {
  const { root, env, calls } = box()
  const run = spawnSync('node', [REPLICA, 'start', '600', '4', '32', 'driftwood-isle'], { encoding: 'utf8',
    env: { ...env, WILDSHARD_REPLICA_TEST_TAILSCALE: '/usr/bin/true' } })
  expect(run.status).toBe(1)
  expect(run.stderr).toContain('no tailnet address')
  expect(calls()).not.toContain('systemd-run')
  expect(existsSync(join(root, 'replica'))).toBe(false)
})
