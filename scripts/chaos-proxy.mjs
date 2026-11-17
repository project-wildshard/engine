#!/usr/bin/env node
// FM2 is a loopback fault instrument, not a production/open proxy.
import { openChaosProxy } from './chaos-proxy-core.mjs'

/** @type {Map<string,string>} */
const values = new Map()
const args = process.argv.slice(2)
for (let index = 0; index < args.length; index++) {
  const arg = args[index] === '--port' ? `--port=${args[++index] ?? ''}` : args[index] ?? ''
  const match = /^--([\w-]+)=(.+)$/u.exec(arg)
  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    values.has(match[1])
  )
    throw new Error('Use unique --name=value options')
  values.set(match[1], match[2])
}
if (
  [...values.keys()].some(
    key =>
      ![
        'work',
        'port',
        'page-upstream',
        'release-upstream',
        'world-upstream',
        'api-upstream',
        'page-port',
        'world-port',
        'tls-port',
        'tls-cert',
        'tls-key',
      ].includes(key),
  ) ||
  !values.has('work')
)
  throw new Error('Explicit --work and known fixture options are required')
if (values.has('port')) {
  if (values.get('port') !== '0' || ['page-port', 'world-port', 'tls-port'].some(key => values.has(key) && values.get(key) !== '0'))
    throw new Error('--port 0 requests OS-assigned listeners; use explicit named port options for fixed ports')
  values.delete('port')
  for (const key of ['page-port', 'world-port', 'tls-port']) values.set(key, '0')
}
const options = {
  work: values.get('work') ?? '',
  ...Object.fromEntries(
    [...values]
      .filter(([key]) => key !== 'work')
      .map(([key, value]) => [
        key.replaceAll(/-([a-z])/gu, (_match, letter) => letter.toUpperCase()),
        key.endsWith('-port') ? Number(value) : value,
      ]),
  ),
}
const proxy = await openChaosProxy(options)
let closing = false
const close = () => {
  if (closing) return
  closing = true
  void (async () => {
    try {
      await proxy.close()
      process.exitCode = 0
    } catch (error) {
      console.error(String(error))
      process.exitCode = 1
    } finally {
      process.stdin.destroy()
    }
  })()
}
process.once('SIGTERM', close)
process.once('SIGINT', close)
process.stdin.once('end', close)
process.stdin.resume()
console.log(JSON.stringify(proxy.ready))
