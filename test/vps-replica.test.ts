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

import { doorArgs, limits, RELEASE_PUBLIC_KEY, replicaRelease, stagingRelease, unitArgs } from '../scripts/vps/replica.mjs'

const REPLICA = resolve('scripts/vps/replica.mjs'), CONFIG = resolve('scripts/vps/wildshard-config')
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
  const setup = readFileSync('scripts/vps/setup.sh', 'utf8')
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
  for (const word of ['--unit=wildshard-replica', '--collect', '--pipe', 'DynamicUser=yes', 'AllowedCPUs=9-12', 'MemoryMax=6G', 'RuntimeMaxSec=1900',
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
  expect(limits(['1800', '4', '32', 'driftwood-isle'])).toEqual({ seconds: 1800, workers: 4, seats: 32, cells: 'driftwood-isle' })
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
    WILDSHARD_REPLICA_TEST_SYSTEMD_RUN: stand('systemd-run', `[ "$1" = --unit=wildshard-replica-door ] && exit 0; cat "${root}/replica/release.json" > "${root}/seen-release.json"; ls "${root}/replica/server" > "${root}/seen-server"; echo '{"at":"worker","p95":1}'`),
    WILDSHARD_REPLICA_TEST_CHMOD: stand('chmod', 'exit 0'),
  }
  return { root, env, calls: () => readFileSync(log, 'utf8') }
}

test('start fetches the signed bundle, runs it as the fixed sandboxed unit, streams its lines and leaves nothing', () => {
  const { root, env, calls } = box()
  const run = spawnSync('node', [REPLICA, 'start', '600', '4', '32', 'driftwood-isle'], { encoding: 'utf8', env })
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
