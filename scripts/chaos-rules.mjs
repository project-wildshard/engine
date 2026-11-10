// FM2's public fault vocabulary. This module knows no game UI or scenario ids.
/** @typedef {{route:string,kind:string,direction?:'up'|'down'|'both',ms?:number,jitterMs?:number,seed?:number,code?:number,retryAfter?:string,bytesPerSecond?:number,bytes?:number,text?:string,contentType?:string,afterMs?:number,reason?:string,fraction?:number}} ChaosRule */
const ROUTES = new Set([
  'release',
  'version',
  'book',
  'packs',
  'doctor',
  'api',
  'page',
  'health',
  'socket',
])
const HTTP = [
  'latency',
  'status',
  'stall',
  'reset',
  'bandwidth',
  'truncate',
  'body',
]
const SOCKET = [
  'refuse-upgrade',
  'drop-after',
  'half-open',
  'close',
  'loss',
  'delay-frames',
  'bandwidth',
]
const FIELDS = {
  latency: ['ms', 'jitterMs', 'seed'],
  status: ['code', 'retryAfter'],
  stall: [],
  reset: [],
  bandwidth: ['bytesPerSecond'],
  truncate: ['bytes'],
  body: ['text', 'contentType'],
  'refuse-upgrade': ['code'],
  'drop-after': ['afterMs'],
  'half-open': [],
  close: ['code', 'reason'],
  loss: ['fraction', 'seed'],
  'delay-frames': ['ms', 'jitterMs', 'seed'],
}
/** @param {Record<string,unknown>} value @param {string} field @param {number} min @param {number} max @param {boolean} [integer] */
function number(value, field, min, max, integer = true) {
  const item = value[field]
  if (
    typeof item !== 'number' ||
    !Number.isFinite(item) ||
    item < min ||
    item > max ||
    (integer && !Number.isSafeInteger(item))
  )
    throw new Error(`Invalid ${field}`)
  return item
}
/** A complete valid replacement is constructed before touching active rules.
 * @param {unknown} input @returns {{scenario:string,rules:ChaosRule[]}} */
export function chaosRules(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new Error('Expected a chaos control object')
  const value = /** @type {Record<string,unknown>} */ (input)
  if (
    Object.keys(value).some(key => !['scenario', 'rules'].includes(key)) ||
    typeof value.scenario !== 'string' ||
    !/^[\w-]{1,80}$/u.test(value.scenario) ||
    !Array.isArray(value.rules) ||
    value.rules.length > 32
  )
    throw new Error('Invalid scenario or rule count')
  /** @type {ChaosRule[]} */
  const rules = []
  for (const unknownRule of value.rules) {
    if (
      typeof unknownRule !== 'object' ||
      unknownRule === null ||
      Array.isArray(unknownRule)
    )
      throw new Error('Invalid rule')
    const rule = /** @type {Record<string,unknown>} */ (unknownRule),
      route = rule.route,
      kind = rule.kind
    if (
      typeof route !== 'string' ||
      !ROUTES.has(route) ||
      typeof kind !== 'string' ||
      !(route === 'socket' ? SOCKET : HTTP).includes(kind)
    )
      throw new Error('Unknown route/fault combination')
    const allowed = Reflect.get(FIELDS, kind)
    if (
      !Array.isArray(allowed) ||
      Object.keys(rule).some(
        key =>
          ![
            'route',
            'kind',
            ...(route === 'socket' ? ['direction'] : []),
            ...allowed,
          ].includes(key),
      )
    )
      throw new Error('Unknown rule parameter')
    const direction = rule.direction === undefined ? 'down' : rule.direction
    if (
      route === 'socket' &&
      (typeof direction !== 'string' ||
        !['up', 'down', 'both'].includes(direction))
    )
      throw new Error('Invalid direction')
    const same = rules.filter(old => old.route === route)
    if (
      same.some(
        old =>
          route !== 'socket' ||
          old.direction === direction ||
          old.direction === 'both' ||
          direction === 'both',
      )
    )
      throw new Error('Overlapping route/direction rules')
    if (kind === 'latency' || kind === 'delay-frames') {
      number(rule, 'ms', 0, 120_000)
      if (rule.jitterMs !== undefined) number(rule, 'jitterMs', 0, 120_000)
      if (rule.seed !== undefined) number(rule, 'seed', 0, 0xffffffff)
    }
    if (kind === 'status' || kind === 'refuse-upgrade') {
      number(rule, 'code', 400, 599)
      if (
        rule.retryAfter !== undefined &&
        (typeof rule.retryAfter !== 'string' ||
          rule.retryAfter.length > 80 ||
          /[\r\n]/u.test(rule.retryAfter))
      )
        throw new Error('Invalid Retry-After')
    }
    if (kind === 'bandwidth')
      number(rule, 'bytesPerSecond', 1, 1024 * 1024 * 1024)
    if (kind === 'truncate') number(rule, 'bytes', 0, 16 * 1024 * 1024)
    if (kind === 'drop-after') number(rule, 'afterMs', 0, 120_000)
    if (kind === 'loss') {
      number(rule, 'fraction', 0, 1, false)
      if (rule.seed !== undefined) number(rule, 'seed', 0, 0xffffffff)
    }
    if (
      kind === 'body' &&
      (typeof rule.text !== 'string' ||
        Buffer.byteLength(rule.text) > 64 * 1024 ||
        typeof rule.contentType !== 'string' ||
        rule.contentType.length > 120 ||
        /[\r\n]/u.test(rule.contentType))
    )
      throw new Error('Invalid body replacement')
    if (kind === 'close') {
      const code = number(rule, 'code', 1000, 4999)
      if (
        !(
          code >= 3000 ||
          [
            1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013,
            1014,
          ].includes(code)
        ) ||
        typeof rule.reason !== 'string' ||
        Buffer.byteLength(rule.reason) > 123
      )
        throw new Error('Invalid WebSocket close code/reason')
    }
    rules.push({
      .../** @type {ChaosRule} */ (rule),
      ...(route === 'socket'
        ? { direction: /** @type {'up'|'down'|'both'} */ (direction) }
        : {}),
    })
  }
  return { scenario: value.scenario, rules }
}
/** @param {number} [seed] */
export function chaosRandom(seed = 1) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}
/** @param {ChaosRule} rule @param {()=>number} random */
export function chaosDelay(rule, random) {
  return Math.max(0, (rule.ms ?? 0) + (random() * 2 - 1) * (rule.jitterMs ?? 0))
}
