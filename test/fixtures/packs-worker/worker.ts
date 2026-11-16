// Public reads of cooked packs (J138). The bucket has no public route and
// wildshard.io isn't on this Cloudflare account, so a Worker with an R2
// binding serves them on workers.dev. Read-only: the cook writes through the
// S3 API with its own token. Parts are stored as Brotli and pass through
// untouched, so the bytes on the wire are the bytes the cook wrote.

const START = 0
const LAST = 1
const OK = 200
const PARTIAL = 206
const SIZE = 1
const NO_CONTENT = 204
const NOT_MODIFIED = 304
const NOT_FOUND = 404
const NOT_ALLOWED = 405
const RANGE_NOT_SATISFIABLE = 416
const CORS_MAX_AGE = '86400'
// The cook names every row's cache. A row put by hand may be an index, and
// a year is too long to be wrong: only a row that says so is immutable.
const NO_RULE_CACHE = 'public, max-age=300'
const KEY = /^[\da-z][\w.-]*(?:\/[\w.-]+)*$/iu

// The bucket's CORS rule, `packs-cors` in P0-SETUP, which R2 only applies to
// its own S3 and public routes.
const ORIGINS = new Set([
  'https://wildshard.io',
  'https://play.wildshard.io',
  'https://staging.wildshard.io',
  'https://preview.wildshard.io',
  'http://localhost:4402',
  'https://wildshard-singleplayer.vercel.app',
])

interface PackHttpMetadata {
  readonly contentType?: string
  readonly contentEncoding?: string
  readonly cacheControl?: string
}

interface PackRange {
  readonly offset?: number
  readonly length?: number
  readonly suffix?: number
}

/** What R2's `head` and a `get` that didn't match its conditions return. */
interface PackHead {
  readonly size: number
  readonly httpEtag: string
  readonly httpMetadata?: PackHttpMetadata
  readonly range?: PackRange
}

interface PackBody extends PackHead {
  readonly body: ReadableStream<Uint8Array>
}

interface PackOptions {
  readonly range: Headers
  readonly onlyIf: Headers
}

interface PackBucket {
  readonly head: (key: string) => Promise<PackHead | null>
  readonly get: (
    key: string,
    options: PackOptions,
  ) => Promise<PackBody | PackHead | null>
}

interface PackEnv {
  readonly PACKS: PackBucket
}

/** Sets `encodeBody`: without it the runtime re-encodes a `br` response. */
interface ManualInit extends ResponseInit {
  readonly encodeBody: 'manual'
}

function hasBody(found: PackBody | PackHead): found is PackBody {
  return 'body' in found
}

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers({
    vary: 'Origin',
    // Cross-origin parts stay measurable and loadable: DL15's wire accounting
    // reads Resource Timing, and a page may be cross-origin isolated.
    'timing-allow-origin': '*',
    'cross-origin-resource-policy': 'cross-origin',
  })
  if (origin !== null && ORIGINS.has(origin)) {
    headers.set('access-control-allow-origin', origin)
    headers.set(
      'access-control-expose-headers',
      'ETag, Content-Length, Content-Range',
    )
  }
  return headers
}

function objectHeaders(found: PackHead, origin: string | null): Headers {
  const headers = corsHeaders(origin)
  const metadata = found.httpMetadata
  headers.set('accept-ranges', 'bytes')
  headers.set('etag', found.httpEtag)
  headers.set('cache-control', metadata?.cacheControl ?? NO_RULE_CACHE)
  headers.set(
    'content-type',
    metadata?.contentType ?? 'application/octet-stream',
  )
  if (metadata?.contentEncoding !== undefined) {
    headers.set('content-encoding', metadata.contentEncoding)
  }
  return headers
}

/** The slice R2 served, as `Content-Range` and its length. */
function slice(found: PackHead): readonly [string, number] | undefined {
  const { range, size } = found
  if (range === undefined) {
    return undefined
  }
  const start =
    range.suffix === undefined ? (range.offset ?? START) : size - range.suffix
  const length = range.suffix ?? range.length ?? size - start
  return [`bytes ${start}-${start + length - LAST}/${size}`, length]
}

/** No body: 204 and 304 refuse an empty string, so it can't be `''`. */
function empty(status: number, headers: Headers): Response {
  // oxlint-disable-next-line unicorn/no-null -- `Response` spells no body this way
  return new Response(null, { status, headers })
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a request is the runtime's
function preflight(request: Request): Response {
  const headers = corsHeaders(request.headers.get('origin'))
  headers.set('access-control-allow-methods', 'GET, HEAD, OPTIONS')
  headers.set('access-control-allow-headers', 'Range')
  headers.set('access-control-max-age', CORS_MAX_AGE)
  return empty(NO_CONTENT, headers)
}

function refusal(status: number, origin: string | null): Response {
  const headers = corsHeaders(origin)
  headers.set('cache-control', 'no-store')
  if (status === NOT_ALLOWED) {
    headers.set('allow', 'GET, HEAD, OPTIONS')
  }
  return empty(status, headers)
}

async function head(
  bucket: PackBucket,
  key: string,
  origin: string | null,
): Promise<Response> {
  const found = await bucket.head(key)
  if (found === null) {
    return refusal(NOT_FOUND, origin)
  }
  const headers = objectHeaders(found, origin)
  headers.set('content-length', String(found.size))
  return empty(OK, headers)
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a request is the runtime's
function servedBody(found: PackBody, request: Request): Response {
  const headers = objectHeaders(found, request.headers.get('origin'))
  // R2 reports a range for a whole-object read too.
  const part = request.headers.has('range') ? slice(found) : undefined
  headers.set('content-length', String(part?.[SIZE] ?? found.size))
  if (part !== undefined) {
    headers.set('content-range', part[START])
  }
  const init: ManualInit = {
    status: part === undefined ? OK : PARTIAL,
    headers,
    encodeBody: 'manual',
  }
  return new Response(found.body, init)
}

/** A range past the end: R2 throws, and HTTP answers with the size. */
async function unsatisfiable(
  bucket: PackBucket,
  key: string,
  origin: string | null,
): Promise<Response> {
  const found = await bucket.head(key)
  if (found === null) {
    return refusal(NOT_FOUND, origin)
  }
  const reply = refusal(RANGE_NOT_SATISFIABLE, origin)
  reply.headers.set('content-range', `bytes */${found.size}`)
  return reply
}

async function get(
  bucket: PackBucket,
  key: string,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a request is the runtime's
  request: Request,
): Promise<Response> {
  const origin = request.headers.get('origin')
  const options = { range: request.headers, onlyIf: request.headers }
  try {
    const found = await bucket.get(key, options)
    if (found === null) {
      return refusal(NOT_FOUND, origin)
    }
    return hasBody(found)
      ? servedBody(found, request)
      : empty(NOT_MODIFIED, objectHeaders(found, origin))
  } catch (error: unknown) {
    if (request.headers.has('range')) {
      return await unsatisfiable(bucket, key, origin)
    }
    throw error
  }
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a request is the runtime's
async function serve(request: Request, env: PackEnv): Promise<Response> {
  const origin = request.headers.get('origin')
  if (request.method === 'OPTIONS') {
    return preflight(request)
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return refusal(NOT_ALLOWED, origin)
  }
  const key = decodeURIComponent(new URL(request.url).pathname).slice(LAST)
  if (!KEY.test(key) || key.split('/').includes('..')) {
    return refusal(NOT_FOUND, origin)
  }
  return request.method === 'HEAD'
    ? await head(env.PACKS, key, origin)
    : await get(env.PACKS, key, request)
}

const worker = { fetch: serve }

export {
  type PackBody,
  type PackBucket,
  type PackEnv,
  type PackHead,
  type PackOptions,
  serve,
}
// oxlint-disable-next-line import/no-default-export -- a Worker's module shape
export default worker
