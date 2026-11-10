// Explicit Ring 2/manual proof. Never part of pre-push.
import assert from 'node:assert/strict'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { once, on } from 'node:events'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  lstatSync,
  rmSync,
  existsSync,
  writeFileSync,
  chmodSync,
  symlinkSync,
  readdirSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve as absolute } from 'node:path'
import { createInterface } from 'node:readline'
import { test } from 'node:test'
import { setTimeout as wait } from 'node:timers/promises'

import { WebSocket, WebSocketServer } from 'ws'

/** Stop only a ChildProcess this proof spawned. A forced fallback remains red.
 * @param {import('node:child_process').ChildProcess} child */
async function stopProxyChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit', { signal: AbortSignal.timeout(2000) })
  child.kill('SIGTERM')
  try {
    await exited
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) {
      const killed = once(child, 'exit', { signal: AbortSignal.timeout(1000) })
      child.kill('SIGKILL')
      await killed
    }
    throw new Error('Owned proxy did not drain normally', { cause: error })
  }
}

/** @param {string} work @param {string} target @param {string[]} [extra] */
async function launch(work, target, extra = []) {
  mkdirSync(work, { recursive: true })
  const child = spawn(
    process.execPath,
    [
      'scripts/chaos-proxy.mjs',
      `--work=${absolute(work)}`,
      `--page-upstream=${target}`,
      `--release-upstream=${target}`,
      `--world-upstream=${target}`,
      '--page-port=0',
      '--world-port=0',
      '--tls-port=0',
      ...extra,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )
  let errors = ''
  child.stderr.on('data', chunk => {
    if (errors.length < 16_384) errors += String(chunk)
  })
  const lines = createInterface({ input: child.stdout })
  try {
    const [line] = await once(lines, 'line', {
      signal: AbortSignal.timeout(2000),
    })
    const ready = JSON.parse(String(line))
    assert.equal(ready.schema, 'chaos-proxy/1')
    assert.equal(lstatSync(ready.tokenFile).mode & 0o777, 0o600)
    const token = readFileSync(ready.tokenFile, 'utf8')
    /** @param {unknown} [body] @param {boolean} [authenticate] */
    const control = (body, authenticate = true) =>
      fetch(ready.controlUrl, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(authenticate ? { authorization: `Bearer ${token}` } : {}),
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(2000),
      })
    /** @param {import('./chaos-rules.mjs').ChaosRule[]} rules @param {string} [scenario] */
    const set = async (rules, scenario = 'proof') => {
      const response = await control({ scenario, rules })
      assert.equal(response.status, 200, errors)
      return response.json()
    }
    return {
      ready,
      child,
      control,
      set,
      errors: () => errors,
      close: async () => {
        await stopProxyChild(child)
        lines.close()
        assert.equal(existsSync(ready.tokenFile), false)
      },
    }
  } catch (error) {
    await stopProxyChild(child)
    lines.close()
    throw new Error(`Proxy CLI readiness failed: ${errors}`, { cause: error })
  }
}
/** @param {string} origin */
async function socket(origin) {
  const address = new URL(origin)
  address.protocol = address.protocol === 'https:' ? 'wss:' : 'ws:'
  const client = new WebSocket(address)
  await once(client, 'open', { signal: AbortSignal.timeout(2000) })
  return client
}
/** @param {WebSocket} client @param {Buffer} bytes */
async function echo(client, bytes) {
  const result = once(client, 'message', { signal: AbortSignal.timeout(2000) })
  client.send(bytes)
  const [data] = await result
  assert.ok(Buffer.isBuffer(data))
  assert.deepEqual(data, bytes)
}
/** A reliable sentinel fences earlier unreliable responses. Every received
 * unreliable byte is separately retained and compared by the loss proof.
 * @param {WebSocket} client @param {Buffer} bytes */
async function echoAfterQueued(client, bytes) {
  const messages = on(client, 'message', { signal: AbortSignal.timeout(2000) })
  client.send(bytes)
  for await (const [data] of messages) {
    assert.ok(Buffer.isBuffer(data))
    if (data.equals(bytes)) return
  }
  throw new Error('Reliable sentinel did not arrive')
}

await test(
  'real CLI/upstreams exercise all 13 faults, healing and protocol preservation',
  { timeout: 10_000 },
  async () => {
    mkdirSync('tmp/fm2', { recursive: true })
    const work = mkdtempSync('tmp/fm2/proof-'),
      cert = absolute(work, 'cert.pem'),
      key = absolute(work, 'key.pem')
    const config = absolute(work, 'openssl.cnf')
    writeFileSync(
      config,
      '[req]\ndistinguished_name=dn\nx509_extensions=extensions\nprompt=no\n[dn]\nCN=127.0.0.1\n[extensions]\nsubjectAltName=IP:127.0.0.1\n',
    )
    try {
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-keyout',
          key,
          '-out',
          cert,
          '-days',
          '1',
          '-config',
          config,
        ],
        { stdio: 'ignore' },
      )
      chmodSync(key, 0o600)
    } catch (error) {
      rmSync(work, { recursive: true })
      throw error
    }
    const bytes = Buffer.alloc(64, 7),
      manifest = {
        parts: [{ url: '/part.bin' }],
        files: [{ url: '/part.bin' }],
      },
      book = {
        book: 'packs',
        client: { fixture: { phone: { url: '/pack/phone.json' } } },
      }
    const upstream = createServer((request, response) => {
      const path = request.url ?? '/'
      if (
        path === '/assets/spawn/packs-fixture.json' ||
        path === '/pack/phone.json'
      ) {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(path.includes('/spawn/') ? book : manifest))
      } else if (path === '/doctor/') {
        response.setHeader('content-type', 'text/html')
        response.end('<script type="module" src="/doctor-entry.js"></script>')
      } else if (path === '/health') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ time: Date.now() }))
      } else {
        response.setHeader('content-length', String(bytes.length))
        response.end(bytes)
      }
    })
    const wss = new WebSocketServer({ server: upstream })
    wss.on('connection', client => {
      client.on('message', (data, binary) => {
        client.send(data, { binary })
      })
    })
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    const address = upstream.address()
    assert.ok(address !== null && typeof address !== 'string')
    const target = `http://127.0.0.1:${address.port}`
    /** @type {Awaited<ReturnType<typeof launch>>|undefined} */ let proxy
    /** @type {Set<WebSocket>} */ const clients = new Set()
    const started = performance.now(),
      kinds = new Set()
    try {
      proxy = await launch(join(work, 'main'), target, [
        `--api-upstream=${target}`,
        `--tls-cert=${cert}`,
        `--tls-key=${key}`,
      ])
      const running = proxy,
        page = running.ready.pageOrigin,
        world = running.ready.worldOrigin
      const denied = await running.control(undefined, false)
      assert.equal(denied.status, 401)
      assert.equal(denied.headers.has('access-control-allow-origin'), false)
      assert.equal((await fetch(`${page}/api/facts`)).status, 200)
      await (await fetch(`${page}/assets/spawn/packs-fixture.json`)).json()
      await (await fetch(`${page}/pack/phone.json`)).json()
      await (await fetch(`${page}/doctor/`)).text()
      kinds.add('latency')
      console.log('fault:latency')
      await running.set([
        { route: 'page', kind: 'latency', ms: 60, jitterMs: 5, seed: 12 },
      ])
      let at = performance.now()
      await fetch(`${page}/bytes`)
      assert.ok(performance.now() - at >= 45)
      kinds.add('status')
      console.log('fault:status')
      await running.set([
        { route: 'health', kind: 'status', code: 429, retryAfter: '20' },
      ])
      const status = await fetch(`${world}/health`)
      assert.equal(status.status, 429)
      assert.equal(status.headers.get('retry-after'), '20')
      assert.equal(status.headers.get('access-control-allow-origin'), page)
      kinds.add('stall')
      console.log('fault:stall')
      await running.set([{ route: 'page', kind: 'stall' }])
      let settled = false
      const held = fetch(`${page}/bytes`).finally(() => {
        settled = true
      })
      await wait(40)
      assert.equal(settled, false)
      await running.set([])
      assert.equal((await held).status, 200)
      kinds.add('reset')
      console.log('fault:reset')
      await running.set([{ route: 'page', kind: 'reset' }])
      await assert.rejects(fetch(`${page}/bytes`))
      kinds.add('bandwidth')
      console.log('fault:bandwidth')
      await running.set([
        { route: 'page', kind: 'bandwidth', bytesPerSecond: 1024 },
      ])
      at = performance.now()
      assert.equal(
        (await (await fetch(`${page}/bytes`)).arrayBuffer()).byteLength,
        64,
      )
      assert.ok(performance.now() - at >= 45)
      kinds.add('truncate')
      console.log('fault:truncate')
      await running.set([{ route: 'packs', kind: 'truncate', bytes: 1 }])
      assert.deepEqual(
        await (await fetch(`${page}/pack/phone.json`)).json(),
        manifest,
      )
      const broken = Buffer.from(
        await (await fetch(`${page}/part.bin`)).arrayBuffer(),
      )
      assert.deepEqual(broken, bytes.subarray(0, 1))
      assert.notDeepEqual(broken, bytes)
      assert.equal(
        (await (await fetch(`${page}/unrelated.bin`)).arrayBuffer()).byteLength,
        64,
      )
      kinds.add('body')
      console.log('fault:body')
      await running.set([
        {
          route: 'doctor',
          kind: 'body',
          text: 'owned sign in',
          contentType: 'text/html',
        },
      ])
      const body = await fetch(`${page}/doctor-entry.js`)
      assert.equal(body.headers.get('content-type'), 'text/html')
      assert.equal(await body.text(), 'owned sign in')
      await running.set([])
      const live = await socket(world)
      clients.add(live)
      await echo(live, Buffer.from([0, 12]))
      kinds.add('delay-frames')
      console.log('fault:delay-frames')
      await running.set([
        {
          route: 'socket',
          kind: 'delay-frames',
          ms: 60,
          jitterMs: 5,
          seed: 42,
        },
      ])
      at = performance.now()
      await echo(live, Buffer.from([1, 2]))
      assert.ok(performance.now() - at >= 45)
      await running.set([
        { route: 'socket', kind: 'bandwidth', bytesPerSecond: 1024 },
      ])
      at = performance.now()
      await echo(live, bytes)
      assert.ok(performance.now() - at >= 45)
      kinds.add('half-open')
      console.log('fault:half-open')
      await running.set([{ route: 'socket', kind: 'half-open' }])
      /** @type {Buffer[]} */ const heldMessages = []
      const retain = (/** @type {unknown} */ data) => {
        assert.ok(Buffer.isBuffer(data))
        heldMessages.push(data)
      }
      live.on('message', retain)
      live.send(Buffer.from([2, 3]))
      await wait(40)
      assert.equal(live.readyState, WebSocket.OPEN)
      assert.equal(heldMessages.length, 0)
      await running.set([])
      await echo(live, Buffer.from([0, 41]))
      assert.equal(heldMessages.length, 1)
      live.off('message', retain)
      kinds.add('loss')
      console.log('fault:loss')
      /** @type {number[][]} */ const samples = []
      for (let run = 0; run < 2; run++) {
        await running.set([
          { route: 'socket', kind: 'loss', fraction: 0.5, seed: 28 },
        ])
        /** @type {number[]} */
        const received = []
        const collect = (/** @type {unknown} */ value) => {
          assert.ok(Buffer.isBuffer(value))
          if (value[0] === 1) received.push(value[1] ?? 0)
        }
        live.on('message', collect)
        for (let i = 0; i < 20; i++) live.send(Buffer.from([1, i]))
        await echoAfterQueued(live, Buffer.from([0, 88]))
        for (const prefix of [2, 3, 8])
          await echo(live, Buffer.from([prefix, 99]))
        live.off('message', collect)
        assert.ok(received.length > 0 && received.length < 20)
        samples.push(received)
      }
      assert.deepEqual(samples[0], samples[1])
      await running.set([
        { route: 'socket', kind: 'loss', fraction: 1, seed: 28 },
      ])
      await echo(live, Buffer.from([8, 7]))
      const pong = once(live, 'pong', { signal: AbortSignal.timeout(1000) })
      live.ping()
      await pong
      kinds.add('drop-after')
      console.log('fault:drop-after')
      const dropped = once(live, 'close', { signal: AbortSignal.timeout(1000) })
      await running.set([{ route: 'socket', kind: 'drop-after', afterMs: 30 }])
      const [dropCode] = await dropped
      assert.equal(dropCode, 1006)
      clients.delete(live)
      await running.set([])
      const coded = await socket(world)
      clients.add(coded)
      kinds.add('close')
      console.log('fault:close')
      const closing = once(coded, 'close', {
        signal: AbortSignal.timeout(1000),
      })
      await running.set([
        { route: 'socket', kind: 'close', code: 4001, reason: 'owned refusal' },
      ])
      const [code, reason] = await closing
      assert.equal(code, 4001)
      assert.equal(String(reason), 'owned refusal')
      clients.delete(coded)
      const prior = await (await running.control()).json()
      const invalid = await running.control({
        scenario: 'invalid',
        rules: [
          { route: 'socket', kind: 'close', code: 1006, reason: 'invalid' },
        ],
      })
      assert.equal(invalid.status, 400)
      assert.deepEqual(
        (await (await running.control()).json()).rules,
        prior.rules,
      )
      for (const rules of [
        [{ route: 'socket', kind: 'half-open', direction: null }],
        [
          { route: 'socket', kind: 'half-open', direction: 'both' },
          { route: 'socket', kind: 'loss', direction: 'up', fraction: 1 },
        ],
        [{ route: 'socket', kind: 'status', code: 503 }],
      ]) {
        assert.equal(
          (await running.control({ scenario: 'invalid', rules })).status,
          400,
        )
        assert.deepEqual(
          (await (await running.control()).json()).rules,
          prior.rules,
        )
      }
      const tooLarge = await running.control({
        scenario: 'oversize',
        rules: [
          {
            route: 'page',
            kind: 'body',
            text: 'x'.repeat(150_000),
            contentType: 'text/plain',
          },
        ],
      })
      assert.equal(tooLarge.status, 413)
      assert.deepEqual(
        (await (await running.control()).json()).rules,
        prior.rules,
      )
      kinds.add('refuse-upgrade')
      console.log('fault:refuse-upgrade')
      await running.set([
        { route: 'socket', kind: 'refuse-upgrade', code: 503 },
      ])
      const refused = new WebSocket(world.replace('http:', 'ws:'))
      refused.on('error', () => undefined)
      const [, _response] = await once(refused, 'unexpected-response', {
        signal: AbortSignal.timeout(1000),
      })
      assert.equal(_response.statusCode, 503)
      _response.resume()
      refused.terminate()
      await running.set([])
      const secure = new WebSocket(
        running.ready.tlsOrigin.replace('https:', 'wss:'),
        { ca: readFileSync(cert) },
      )
      clients.add(secure)
      await once(secure, 'open', { signal: AbortSignal.timeout(1000) })
      await echo(secure, Buffer.from([0, 3]))
      secure.terminate()
      clients.delete(secure)
      const facts = await (await running.control()).json()
      assert.equal(facts.counters.queueOverflow, 0)
      assert.equal(facts.counters.metadataOverflow, 0)
      assert.ok(facts.counters.droppedMessages > 0)
      assert.equal(kinds.size, 13)
      console.log(
        JSON.stringify({
          kinds: [...kinds],
          elapsedMs: performance.now() - started,
          matches: facts.counters.matches,
        }),
      )
      await running.close()
      proxy = undefined
      const noApi = await launch(join(work, 'no-api'), target)
      try {
        assert.equal(
          (await fetch(`${noApi.ready.pageOrigin}/api/facts`)).status,
          503,
        )
      } finally {
        await noApi.close()
      }
    } finally {
      for (const client of clients) client.terminate()
      await proxy?.close()
      for (const client of wss.clients) client.terminate()
      await new Promise(resolve => {
        wss.close(() => {
          resolve(null)
        })
      })
      upstream.closeAllConnections()
      upstream.close()
      await once(upstream, 'close')
      rmSync(work, { recursive: true })
    }
  },
)

await test(
  'startup refuses external targets, symlink work and occupied ports without adoption',
  { timeout: 5000 },
  async () => {
    const work = mkdtempSync('tmp/fm2/refusal-'),
      occupied = createServer((_request, response) => {
        response.end('still owned by the proof')
      })
    occupied.listen(0, '127.0.0.1')
    await once(occupied, 'listening')
    const address = occupied.address()
    assert.ok(address !== null && typeof address !== 'string')
    try {
      const external = join(work, 'external'),
        bad = spawnSync(
          process.execPath,
          [
            'scripts/chaos-proxy.mjs',
            `--work=${absolute(external)}`,
            '--page-upstream=https://play.wildshard.io',
            '--page-port=0',
            '--world-port=0',
          ],
          { encoding: 'utf8', timeout: 2000 },
        )
      assert.notEqual(bad.status, 0)
      assert.equal(bad.stdout, '')
      assert.equal(existsSync(external), false)
      assert.match(bad.stderr, /loopback/u)
      const real = join(work, 'real'),
        alias = join(work, 'alias')
      mkdirSync(real)
      symlinkSync(absolute(real), alias)
      const linked = spawnSync(
        process.execPath,
        [
          'scripts/chaos-proxy.mjs',
          `--work=${absolute(alias)}`,
          '--page-port=0',
          '--world-port=0',
        ],
        { encoding: 'utf8', timeout: 2000 },
      )
      assert.notEqual(linked.status, 0)
      assert.deepEqual(readdirSync(real), [])
      const bind = join(work, 'bind'),
        collision = spawnSync(
          process.execPath,
          [
            'scripts/chaos-proxy.mjs',
            `--work=${absolute(bind)}`,
            `--page-port=${address.port}`,
            '--world-port=0',
          ],
          { encoding: 'utf8', timeout: 2000 },
        )
      assert.notEqual(collision.status, 0)
      assert.match(collision.stderr, /EADDRINUSE/u)
      assert.equal(existsSync(join(bind, 'control.token')), false)
      assert.equal(
        await (await fetch(`http://127.0.0.1:${address.port}`)).text(),
        'still owned by the proof',
      )
    } finally {
      occupied.closeAllConnections()
      occupied.close()
      await once(occupied, 'close')
      rmSync(work, { recursive: true })
    }
  },
)

await test(
  'healing cancels long timers and parent EOF releases owned listeners',
  { timeout: 5000 },
  async () => {
    const work = mkdtempSync('tmp/fm2/heal-'),
      upstream = createServer((_request, response) => {
        response.end('healed')
      })
    const wss = new WebSocketServer({ server: upstream })
    wss.on('connection', client => {
      client.on('message', (data, binary) => {
        client.send(data, { binary })
      })
    })
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    const address = upstream.address()
    assert.ok(address !== null && typeof address !== 'string')
    const proxy = await launch(
      join(work, 'proxy'),
      `http://127.0.0.1:${address.port}`,
    )
    /** @type {WebSocket|undefined} */ let client
    try {
      await proxy.set([{ route: 'page', kind: 'latency', ms: 120_000 }])
      const response = fetch(proxy.ready.pageOrigin)
      await wait(30)
      await proxy.set([])
      assert.equal(await (await response).text(), 'healed')
      client = await socket(proxy.ready.worldOrigin)
      /** @type {Buffer[]} */
      const received = []
      client.on('message', (/** @type {unknown} */ data) => {
        assert.ok(Buffer.isBuffer(data))
        received.push(data)
      })
      await proxy.set([{ route: 'socket', kind: 'delay-frames', ms: 120_000 }])
      client.send(Buffer.from([1, 9]))
      await wait(30)
      await proxy.set([{ route: 'socket', kind: 'half-open' }])
      await wait(30)
      assert.equal(received.length, 0)
      await proxy.set([])
      await echo(client, Buffer.from([0, 10]))
      assert.deepEqual(received, [Buffer.from([0, 10])])
      await proxy.set([
        { route: 'socket', kind: 'drop-after', afterMs: 120_000 },
      ])
      await proxy.set([])
      await echo(client, Buffer.from([0, 11]))
      const exit = once(proxy.child, 'exit', {
        signal: AbortSignal.timeout(2000),
      })
      proxy.child.stdin.end()
      const [status] = await exit
      assert.equal(status, 0)
      assert.equal(existsSync(proxy.ready.tokenFile), false)
      await assert.rejects(fetch(proxy.ready.pageOrigin))
    } finally {
      client?.terminate()
      await proxy.close()
      for (const peer of wss.clients) peer.terminate()
      await new Promise(resolve => {
        wss.close(() => {
          resolve(null)
        })
      })
      upstream.closeAllConnections()
      upstream.close()
      await once(upstream, 'close')
      rmSync(work, { recursive: true })
    }
  },
)
