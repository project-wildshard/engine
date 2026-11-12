import { randomBytes, timingSafeEqual } from 'node:crypto'
import { once } from 'node:events'
import {
  mkdirSync,
  realpathSync,
  lstatSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
} from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { createServer as createTlsServer } from 'node:https'
import { connect } from 'node:net'
import { resolve as absolute, join } from 'node:path'

import { WebSocket, WebSocketServer } from 'ws'

import { chaosRouter } from './chaos-router.mjs'
import { chaosRules, chaosRandom, chaosDelay } from './chaos-rules.mjs'

const MAX_BODY = 128 * 1024,
  MAX_QUEUE = 8 * 1024 * 1024,
  MAX_METADATA = 2 * 1024 * 1024,
  MAX_PENDING = 1024
/** macOS lets a 127.0.0.1 bind shadow a 0.0.0.0, :: or default-host listener
 * on the same port, so EADDRINUSE alone cannot protect an occupant. Anything
 * that already answers on loopback owns the port.
 * @param {number} port */
async function refuseOccupiedLoopback(port) {
  const answered = await new Promise((resolve, reject) => {
    const probe = connect({ host: '127.0.0.1', port })
    probe.setTimeout(1000)
    probe.once('connect', () => {
      probe.destroy()
      resolve(true)
    })
    probe.once('timeout', () => {
      probe.destroy()
      resolve(true)
    })
    probe.once('error', error => {
      probe.destroy()
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ECONNREFUSED')
        resolve(false)
      else reject(error)
    })
  })
  if (answered)
    throw Object.assign(
      new Error(`listen EADDRINUSE: 127.0.0.1:${port} already answers`),
      { code: 'EADDRINUSE' },
    )
}
/** A cancellable absolute deadline. Node otherwise wraps delays above its
 * signed 32-bit timer range to approximately one millisecond.
 * @param {number} deadline */
function deadlineWait(deadline) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer
  /** @type {(elapsed:boolean)=>void} */
  let complete = () => undefined
  let done = false
  /** @type {Promise<boolean>} */
  const promise = new Promise(resolve => {
    complete = elapsed => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(elapsed)
    }
    const step = () => {
      if (done) return
      const remaining = deadline - performance.now()
      if (remaining <= 0) complete(true)
      else timer = setTimeout(step, Math.min(remaining, 2_147_483_647))
    }
    step()
  })
  return {
    promise,
    cancel: () => {
      complete(false)
    },
  }
}
/** @param {string} text */
function upstream(text) {
  const url = new URL(text)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  )
    throw new Error('Only explicit loopback HTTP upstream origins are allowed')
  return url
}
/** @param {number} port */
function validPort(port) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535)
    throw new Error('Invalid fixture port')
  return port
}
/** @param {string} path @param {boolean} privateFile */
function fixtureFile(path, privateFile) {
  const file = absolute(path),
    stat = lstatSync(file)
  if (
    realpathSync(file) !== file ||
    !stat.isFile() ||
    stat.uid !== process.getuid?.() ||
    (privateFile && (stat.mode & 0o077) !== 0)
  )
    throw new Error('TLS fixture must be an owned regular file (key private)')
  return readFileSync(file)
}
/** Cancellable real waits: heal releases pending work, close disposes it. */
function wakeups() {
  /** @type {Set<()=>void>} */
  const waits = new Set()
  return {
    wake: () => {
      for (const end of waits) end()
    },
    /** @param {number|null} ms */
    wait: ms =>
      new Promise(resolve => {
        /** @type {()=>void} */
        let cancel = () => undefined
        const end = () => {
          cancel()
          waits.delete(end)
          resolve(null)
        }
        waits.add(end)
        if (ms !== null) {
          const alarm = deadlineWait(performance.now() + ms)
          cancel = alarm.cancel
          void (async () => {
            if (await alarm.promise) end()
          })()
        }
      }),
  }
}
/** @typedef {{work:string,pageUpstream?:string,releaseUpstream?:string,worldUpstream?:string,apiUpstream?:string,pagePort?:number,worldPort?:number,tlsPort?:number,tlsCert?:string,tlsKey?:string}} ChaosOptions */
/** @param {ChaosOptions} options */
export async function openChaosProxy(options) {
  // Reject configuration before creating a token or opening any socket.
  const pageTarget = upstream(options.pageUpstream ?? 'http://127.0.0.1:18798'),
    releaseTarget = upstream(
      options.releaseUpstream ?? 'http://127.0.0.1:18799',
    ),
    worldTarget = upstream(options.worldUpstream ?? 'http://127.0.0.1:18797'),
    apiTarget =
      options.apiUpstream === undefined
        ? undefined
        : upstream(options.apiUpstream)
  const pagePort = validPort(options.pagePort ?? 18791),
    worldPort = validPort(options.worldPort ?? 18792),
    tlsPort = validPort(options.tlsPort ?? 18793)
  if ((options.tlsCert === undefined) !== (options.tlsKey === undefined))
    throw new Error('Supply both owned TLS certificate and key')
  const tls =
    options.tlsCert === undefined
      ? undefined
      : {
          cert: fixtureFile(options.tlsCert, false),
          key: fixtureFile(options.tlsKey ?? '', true),
        }
  const work = absolute(options.work)
  mkdirSync(work, { recursive: true })
  const stat = lstatSync(work)
  if (
    realpathSync(work) !== work ||
    !stat.isDirectory() ||
    stat.uid !== process.getuid?.()
  )
    throw new Error('Proxy work must be an owned real directory')
  const token = randomBytes(32).toString('hex'),
    tokenFile = join(work, 'control.token')
  writeFileSync(tokenFile, token, { flag: 'wx', mode: 0o600 })
  const tokenStat = lstatSync(tokenFile)
  let active = chaosRules({ scenario: 'healthy', rules: [] }),
    generation = 0,
    closed = false,
    pageOrigin = ''
  const router = chaosRouter()
  const counters = {
    matches: /** @type {Record<string,number>} */ ({}),
    forwardedBytes: 0,
    droppedBytes: 0,
    forwardedMessages: 0,
    droppedMessages: 0,
    metadataOverflow: 0,
    queueOverflow: 0,
  }
  /** @type {{kind:string,route:string,direction?:string,delayMs?:number}[]} */
  const events = []
  /** @type {Set<{change:()=>void,close:()=>void}>} */
  const operations = new Set()
  /** @type {Set<import('node:net').Socket>} */
  const sockets = new Set()
  /** Every upstream remains owned until its native close, including failed
   * client upgrades and the other half of a closing bridge.
   * @type {Set<WebSocket>} */
  const upstreamSockets = new Set()
  /** @type {import('node:http').Server[]} */
  const servers = []
  /** @type {WeakMap<import('node:http').IncomingMessage,string>} */
  const protocols = new WeakMap()
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_QUEUE,
    handleProtocols: (_offered, request) => protocols.get(request) ?? false,
  })
  const snapshot = () => ({
    schema: 'chaos-proxy/1',
    scenario: active.scenario,
    rules: active.rules,
    counters: { ...counters, matches: { ...counters.matches } },
    activeConnections: operations.size,
    events: [...events],
  })
  /** @param {import('./chaos-rules.mjs').ChaosRule} rule @param {string} [direction] @param {number} [delayMs] */
  const matched = (rule, direction, delayMs) => {
    counters.matches[rule.route] = (counters.matches[rule.route] ?? 0) + 1
    if (events.length < 256)
      events.push({
        kind: rule.kind,
        route: rule.route,
        ...(direction === undefined ? {} : { direction }),
        ...(delayMs === undefined ? {} : { delayMs }),
      })
  }
  /** @param {string} route @param {'up'|'down'} [direction] */
  const ruleFor = (route, direction) =>
    active.rules.find(
      rule =>
        rule.route === route &&
        (direction === undefined ||
          rule.direction === direction ||
          rule.direction === 'both'),
    )
  /** @type {WeakMap<import('./chaos-rules.mjs').ChaosRule,()=>number>} */
  const randoms = new WeakMap()
  /** @param {import('./chaos-rules.mjs').ChaosRule} rule */
  const random = rule => {
    let value = randoms.get(rule)
    if (value === undefined) {
      value = chaosRandom(rule.seed)
      randoms.set(rule, value)
    }
    return value
  }
  /** @param {import('node:http').IncomingMessage} request @param {import('node:http').ServerResponse} response */
  const control = async (request, response) => {
    const supplied = request.headers.authorization ?? '',
      expected = `Bearer ${token}`
    if (
      Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    ) {
      response.writeHead(401, { 'cache-control': 'no-store' }).end()
      return
    }
    if (request.method !== 'GET' && request.method !== 'POST') {
      response.writeHead(405).end()
      return
    }
    try {
      if (request.method === 'POST') {
        /** @type {Buffer[]} */ const body = []
        let size = 0
        for await (const chunk of request) {
          const bytes = Buffer.from(chunk)
          size += bytes.length
          if (size > MAX_BODY) {
            response.writeHead(413).end()
            request.resume()
            return
          }
          body.push(bytes)
        }
        const replacement = chaosRules(
          /** @type {unknown} */ (JSON.parse(Buffer.concat(body).toString())),
        )
        active = replacement
        generation++
        for (const operation of operations) operation.change()
      }
      response
        .writeHead(200, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        })
        .end(JSON.stringify(snapshot()))
    } catch {
      if (!response.headersSent)
        response.writeHead(400, { 'cache-control': 'no-store' }).end()
      else response.destroy()
    }
  }
  /** @param {import('node:http').ServerResponse} response @param {string} route @param {number} code @param {Buffer} body @param {Record<string,string>} [headers] */
  const injected = (response, route, code, body, headers = {}) => {
    response
      .writeHead(code, {
        'content-type': 'text/plain',
        'content-length': String(body.length),
        'cache-control': 'no-store',
        ...(route === 'health'
          ? { 'access-control-allow-origin': pageOrigin }
          : {}),
        ...headers,
      })
      .end(body)
  }
  /** @param {import('node:http').IncomingMessage} request @param {import('node:http').ServerResponse} response @param {boolean} world */
  const http = async (request, response, world) => {
    const raw = request.url ?? '/'
    if (
      closed ||
      !raw.startsWith('/') ||
      raw.startsWith('//') ||
      raw.includes('\\')
    ) {
      response.writeHead(400).end()
      return
    }
    const path = new URL(raw, 'http://127.0.0.1').pathname
    if (!world && path === '/__chaos') {
      await control(request, response)
      return
    }
    const route = world
      ? path === '/health'
        ? 'health'
        : 'page'
      : router.route(path)
    if (world && route !== 'health') {
      response.writeHead(404).end()
      return
    }
    const target =
      route === 'release'
        ? releaseTarget
        : route === 'api'
          ? apiTarget
          : world
            ? worldTarget
            : pageTarget
    if (target === undefined) {
      injected(
        response,
        route,
        503,
        Buffer.from('No owned API upstream configured'),
      )
      return
    }
    const forwarded = new URL(raw, target)
    if (
      forwarded.origin !== target.origin ||
      forwarded.username !== '' ||
      forwarded.password !== ''
    ) {
      response.writeHead(400).end()
      return
    }
    const wake = wakeups()
    let alive = true
    /** @type {import('node:http').ClientRequest|undefined} */ let outgoing
    /** @type {import('node:http').IncomingMessage|undefined} */ let source
    const operation = {
      change: wake.wake,
      close: () => {
        alive = false
        wake.wake()
        outgoing?.destroy()
        source?.destroy()
        response.destroy()
      },
    }
    operations.add(operation)
    const finish = () => {
      alive = false
      wake.wake()
      outgoing?.destroy()
      source?.destroy()
      operations.delete(operation)
    }
    response.once('close', finish)
    try {
      for (;;) {
        if (!alive) break
        const rule = ruleFor(route),
          version = generation
        if (rule?.kind === 'stall') {
          matched(rule)
          await wake.wait(null)
          continue
        }
        if (rule?.kind === 'reset') {
          matched(rule)
          response.destroy()
          return
        }
        if (rule?.kind === 'status') {
          matched(rule)
          injected(
            response,
            route,
            rule.code ?? 503,
            Buffer.alloc(0),
            rule.retryAfter === undefined
              ? {}
              : { 'retry-after': rule.retryAfter },
          )
          return
        }
        if (rule?.kind === 'body') {
          matched(rule)
          injected(response, route, 200, Buffer.from(rule.text ?? ''), {
            'content-type': rule.contentType ?? 'text/plain',
          })
          return
        }
        if (rule?.kind === 'latency') {
          const ms = chaosDelay(rule, random(rule))
          matched(rule, undefined, ms)
          await wake.wait(ms)
          if (generation !== version) continue
        }
        break
      }
      if (!alive) return
      outgoing = httpRequest(forwarded, {
        method: request.method,
        headers: { ...request.headers, host: target.host },
        agent: false,
      })
      const incoming = new Promise((resolve, reject) => {
        outgoing?.once('response', resolve)
        outgoing?.once('error', reject)
      })
      request.once('aborted', () => {
        outgoing?.destroy()
      })
      request.pipe(outgoing)
      source = /** @type {import('node:http').IncomingMessage} */ (
        await incoming
      )
      if (!alive) {
        source.destroy()
        return
      }
      const headers = { ...source.headers }
      delete headers['transfer-encoding']
      const rule = ruleFor(route),
        truncate =
          rule?.kind === 'truncate' && router.binary(path, headers)
            ? rule
            : undefined
      if (truncate !== undefined) {
        /** @type {Buffer[]} */ const pieces = []
        let size = 0
        for await (const data of source) {
          const piece = Buffer.from(data).subarray(
            0,
            Math.max(0, (truncate.bytes ?? 0) - size),
          )
          pieces.push(piece)
          size += piece.length
          if (size >= (truncate.bytes ?? 0)) break
        }
        delete headers['content-encoding']
        headers['content-length'] = String(size)
        headers['cache-control'] = 'no-store'
        matched(truncate)
        counters.forwardedBytes += size
        response
          .writeHead(source.statusCode ?? 502, headers)
          .end(Buffer.concat(pieces))
        return
      }
      response.writeHead(source.statusCode ?? 502, headers)
      const wantsMetadata =
        route === 'book' ||
        (route === 'packs' &&
          (path.endsWith('.json') ||
            source.headers['content-type']?.includes('json') === true)) ||
        (route === 'doctor' &&
          source.headers['content-type']?.includes('text/html') === true)
      /** @type {Buffer[]} */ const metadata = []
      let metadataBytes = 0
      for await (const data of source) {
        if (!alive) break
        const chunk = Buffer.from(data)
        if (wantsMetadata && metadataBytes <= MAX_METADATA) {
          metadataBytes += chunk.length
          if (metadataBytes <= MAX_METADATA) metadata.push(chunk)
        }
        let current = ruleFor(route)
        while (current?.kind === 'stall') {
          if (!alive) break
          matched(current)
          await wake.wait(null)
          current = ruleFor(route)
        }
        if (!alive) break
        if (current?.kind === 'reset') {
          matched(current)
          response.destroy()
          break
        }
        if (current?.kind === 'bandwidth') {
          matched(current)
          await wake.wait((chunk.length * 1000) / (current.bytesPerSecond ?? 1))
          if (!alive) break
        }
        if (chunk.length > 0) {
          counters.forwardedBytes += chunk.length
          if (!response.write(chunk)) {
            const controller = new AbortController()
            try {
              await Promise.race([
                once(response, 'drain', { signal: controller.signal }),
                once(response, 'close', { signal: controller.signal }),
              ])
            } finally {
              controller.abort()
            }
          }
        }
      }
      if (wantsMetadata) {
        if (metadataBytes <= MAX_METADATA) {
          if (!router.observe(path, source.headers, Buffer.concat(metadata)))
            counters.metadataOverflow++
        } else counters.metadataOverflow++
      }
      if (alive) response.end()
    } catch {
      if (alive) {
        if (!response.headersSent)
          injected(response, route, 502, Buffer.alloc(0))
        else response.destroy()
      }
    } finally {
      if (response.writableEnded || response.destroyed) finish()
    }
  }
  /** @param {WebSocket} target @param {number} code @param {Buffer} reason */
  const closePeer = (target, code, reason) => {
    if (code === 1005 || code === 1006 || code === 1015) target.terminate()
    else if (target.readyState === WebSocket.OPEN) target.close(code, reason)
    else target.terminate()
  }
  /** @param {WebSocket} client @param {WebSocket} remote */
  const bridge = (client, remote) => {
    const wake = wakeups()
    let alive = true,
      queued = 0
    const due = { up: 0, down: 0 }
    const pressure = () =>
      queued + client.bufferedAmount + remote.bufferedAmount
    const updateFlows = () => {
      if (!alive) return
      if (pressure() >= MAX_QUEUE / 2) {
        client.pause()
        remote.pause()
      } else {
        client.resume()
        remote.resume()
      }
    }
    /** @type {Set<(replaced?:boolean)=>void>} */ const pending = new Set()
    const activate = () => {
      for (const direction of /** @type {const} */ (['up', 'down'])) {
        const rule = ruleFor('socket', direction),
          peer = direction === 'down' ? client : remote
        if (rule?.kind === 'close') {
          matched(rule, direction)
          peer.close(rule.code, rule.reason)
        }
        if (rule?.kind === 'drop-after') {
          matched(rule, direction)
          const version = generation
          void wake.wait(rule.afterMs ?? 0).then(() => {
            if (alive && version === generation) {
              client.terminate()
              remote.terminate()
            }
            return null
          })
        }
      }
    }
    const operation = {
      change: () => {
        if (!alive) return
        wake.wake()
        due.up = 0
        due.down = 0
        const previous = [...pending]
        for (const send of previous) send(true)
        activate()
      },
      close: () => {
        alive = false
        wake.wake()
        for (const send of pending) send()
        client.terminate()
        remote.terminate()
      },
    }
    operations.add(operation)
    /** @param {'up'|'down'} direction @param {WebSocket} to @param {import('ws').RawData} raw @param {boolean} binary */
    const message = (direction, to, raw, binary) => {
      if (!alive) return
      const bytes = Array.isArray(raw)
          ? Buffer.concat(raw)
          : Buffer.isBuffer(raw)
            ? raw
            : Buffer.from(raw),
        rule = ruleFor('socket', direction)
      if (
        rule?.kind === 'half-open' ||
        (rule?.kind === 'loss' &&
          binary &&
          bytes[0] === 1 &&
          random(rule)() < (rule.fraction ?? 0))
      ) {
        matched(rule, direction)
        counters.droppedBytes += bytes.length
        counters.droppedMessages++
        updateFlows()
        return
      }
      if (rule?.kind === 'loss' && binary && bytes[0] === 1)
        matched(rule, direction)
      let delay = 0
      if (rule?.kind === 'delay-frames') {
        delay = chaosDelay(rule, random(rule))
        matched(rule, direction, delay)
        due[direction] = Math.max(performance.now() + delay, due[direction])
        delay = Math.max(0, due[direction] - performance.now())
      }
      if (rule?.kind === 'bandwidth') {
        matched(rule, direction)
        due[direction] =
          Math.max(performance.now(), due[direction]) +
          (bytes.length * 1000) / (rule.bytesPerSecond ?? 1)
        delay = due[direction] - performance.now()
      }
      if (
        pending.size >= MAX_PENDING ||
        pressure() + bytes.length > MAX_QUEUE
      ) {
        counters.queueOverflow++
        operation.close()
        return
      }
      queued += bytes.length
      updateFlows()
      /** @type {()=>void} */
      let cancel = () => undefined
      let sent = false
      /** @param {boolean} [replaced] */
      const send = (replaced = false) => {
        if (sent) return
        sent = true
        cancel()
        pending.delete(send)
        queued -= bytes.length
        if (!alive || to.readyState !== WebSocket.OPEN) return
        if (replaced) {
          message(direction, to, bytes, binary)
          return
        }
        counters.forwardedBytes += bytes.length
        counters.forwardedMessages++
        void (async () => {
          try {
            await new Promise((resolve, reject) => {
              to.send(bytes, { binary }, (/** @type {unknown} */ error) => {
                if (error !== undefined && error !== null)
                  reject(
                    error instanceof Error
                      ? error
                      : new Error('Native proxy send failed', { cause: error }),
                  )
                else resolve(null)
              })
            })
            updateFlows()
          } catch {
            operation.close()
          }
        })()
      }
      pending.add(send)
      if (delay > 0) {
        const alarm = deadlineWait(performance.now() + delay)
        cancel = alarm.cancel
        void (async () => {
          if (await alarm.promise) send()
        })()
      } else send()
    }
    client.on('message', (data, binary) => {
      message('up', remote, data, binary)
    })
    remote.on('message', (data, binary) => {
      message('down', client, data, binary)
    })
    client.on('close', (code, reason) => {
      closePeer(remote, code, reason)
      alive = false
      wake.wake()
      for (const send of pending) send()
      if (
        client.readyState === WebSocket.CLOSED &&
        remote.readyState === WebSocket.CLOSED
      )
        operations.delete(operation)
    })
    remote.on('close', (code, reason) => {
      closePeer(client, code, reason)
      alive = false
      wake.wake()
      for (const send of pending) send()
      if (
        client.readyState === WebSocket.CLOSED &&
        remote.readyState === WebSocket.CLOSED
      )
        operations.delete(operation)
    })
    client.on('error', operation.close)
    remote.on('error', operation.close)
    activate()
  }
  /** @param {import('node:http').IncomingMessage} request @param {import('node:stream').Duplex} socket @param {Buffer} head */
  const upgrade = (request, socket, head) => {
    if (closed) {
      socket.destroy()
      return
    }
    if (request.url !== '/') {
      socket.end(
        'HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      )
      return
    }
    const key = request.headers['sec-websocket-key']
    if (
      request.method !== 'GET' ||
      request.headers.upgrade?.toLowerCase() !== 'websocket' ||
      typeof key !== 'string' ||
      !/^[0-9A-Za-z+/]{22}==$/u.test(key) ||
      !['8', '13'].includes(request.headers['sec-websocket-version'] ?? '')
    ) {
      socket.end(
        'HTTP/1.1 400 Invalid upgrade\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      )
      return
    }
    const rule = active.rules.find(
      value => value.route === 'socket' && value.kind === 'refuse-upgrade',
    )
    if (rule?.kind === 'refuse-upgrade') {
      matched(rule)
      socket.end(
        `HTTP/1.1 ${rule.code ?? 503} Fixture refusal\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      )
      return
    }
    const address = new URL(worldTarget)
    address.protocol = 'ws:'
    const offered = request.headers['sec-websocket-protocol']
    /** @type {WebSocket} */
    let remote
    try {
      remote = new WebSocket(
        address,
        typeof offered === 'string'
          ? offered.split(',').map(value => value.trim())
          : [],
        {
          maxPayload: MAX_QUEUE,
          followRedirects: false,
          ...(request.headers.origin === undefined
            ? {}
            : { origin: request.headers.origin }),
        },
      )
    } catch {
      socket.end(
        'HTTP/1.1 400 Invalid protocols\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      )
      return
    }
    upstreamSockets.add(remote)
    const handshake = {
      timer: /** @type {ReturnType<typeof setTimeout>|undefined} */ (undefined),
    }
    let settled = false,
      bridged = false
    const operation = {
      change: () => undefined,
      close: () => {
        settled = true
        clearTimeout(handshake.timer)
        remote.terminate()
        socket.destroy()
        operations.delete(operation)
      },
    }
    operations.add(operation)
    remote.once('close', () => {
      upstreamSockets.delete(remote)
      if (!bridged && !settled) operation.close()
    })
    /** @param {number} code */
    const refuse = code => {
      if (settled) return
      settled = true
      clearTimeout(handshake.timer)
      operations.delete(operation)
      remote.terminate()
      socket.end(
        `HTTP/1.1 ${code} Fixture upstream refusal\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      )
    }
    const failed = () => {
      refuse(502)
    }
    remote.on('error', failed)
    remote.once('unexpected-response', (_request, response) => {
      refuse(response.statusCode ?? 502)
      response.resume()
    })
    handshake.timer = setTimeout(operation.close, 10_000)
    socket.once('close', () => {
      if (!settled) operation.close()
    })
    remote.once('open', () => {
      if (settled) return
      const current = active.rules.find(
        value => value.route === 'socket' && value.kind === 'refuse-upgrade',
      )
      if (current?.kind === 'refuse-upgrade') {
        matched(current)
        refuse(current.code ?? 503)
        return
      }
      protocols.set(request, remote.protocol)
      try {
        wss.handleUpgrade(request, socket, head, client => {
          bridged = true
          settled = true
          clearTimeout(handshake.timer)
          operations.delete(operation)
          remote.off('error', failed)
          bridge(client, remote)
        })
        if (!bridged) operation.close()
      } catch {
        operation.close()
      }
    })
  }
  /** @param {import('node:http').Server} server @param {number} port */
  const listen = async (server, port) => {
    servers.push(server)
    server.on('connection', socket => {
      if (closed) {
        socket.destroy()
        return
      }
      sockets.add(socket)
      socket.on('error', () => {
        socket.destroy()
      })
      socket.once('close', () => {
        sockets.delete(socket)
      })
    })
    server.on('clientError', (_error, socket) => {
      socket.destroy()
    })
    if (port !== 0) await refuseOccupiedLoopback(port)
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        resolve(null)
      })
    })
    const address = server.address()
    if (address === null || typeof address === 'string')
      throw new Error('No owned loopback listener')
    return address.port
  }
  /** @type {Promise<void>|undefined} */
  let closing
  const close = () => {
    if (closing !== undefined) return closing
    closed = true
    closing = (async () => {
      for (const operation of operations) operation.close()
      for (const socket of sockets) socket.destroy()
      const peers = [...upstreamSockets].map(peer => {
        if (peer.readyState === WebSocket.CLOSED) return Promise.resolve()
        const retired = new Promise(resolve => {
          peer.once('close', () => {
            resolve(null)
          })
        })
        peer.terminate()
        return retired
      })
      const listeners = servers.map(
        server =>
          new Promise(resolve => {
            server.close(() => {
              resolve(null)
            })
          }),
      )
      await Promise.all([...peers, ...listeners])
      await new Promise(resolve => {
        wss.close(() => {
          resolve(null)
        })
      })
      const current = lstatSync(tokenFile, { throwIfNoEntry: false })
      if (current?.ino === tokenStat.ino && current.dev === tokenStat.dev)
        unlinkSync(tokenFile)
    })()
    return closing
  }
  try {
    const page = createServer((request, response) => {
        void http(request, response, false)
      }),
      world = createServer((request, response) => {
        void http(request, response, true)
      })
    world.on('upgrade', upgrade)
    pageOrigin = `http://127.0.0.1:${await listen(page, pagePort)}`
    const worldOrigin = `http://127.0.0.1:${await listen(world, worldPort)}`
    let tlsOrigin = null
    if (tls !== undefined) {
      const secure = createTlsServer(tls, (request, response) => {
        void http(request, response, true)
      })
      secure.on('upgrade', upgrade)
      tlsOrigin = `https://127.0.0.1:${await listen(secure, tlsPort)}`
    }
    return {
      ready: {
        schema: 'chaos-proxy/1',
        pageOrigin,
        worldOrigin,
        tlsOrigin,
        controlUrl: `${pageOrigin}/__chaos`,
        tokenFile,
      },
      close,
    }
  } catch (error) {
    await close()
    throw error
  }
}
