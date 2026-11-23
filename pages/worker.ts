// The game page's Worker (meta OFF-VERCEL-PLAN OV1, J272). Static assets serve everything; `run_worker_first` sends
// only `/`, `/index.html` and the spawn parts here, where this does what the old host's config did:
// - `?doctor` (any value) on the page goes 307 to `/doctor/?sw=0`, keeping the rest of the query as written, as the old
//   host's `permanent: false` redirect did (`/?x=1&doctor` → `/doctor/?x=1&doctor&sw=0`; OV2's parity check against play);
// - otherwise the page itself, with `Cache-Control: no-store`;
// - a `.pack.br` spawn part goes out as its stored q11 bytes with `Content-Encoding: br` (DL15). OV2 measured that
//   `_headers` can't do it: the runtime brotli-encodes the stored bytes a second time. `encodeBody: "manual"` sends them
//   as they are. Its other headers (cache, content type) still come from `_headers` via the assets.
// `/index.html` is served as `/`: the old host answered it 200, and the assets' default HTML handling would 307 it to `/`.
// A path with no asset also reaches the Worker; the assets answer it 404, and the Worker makes that miss `no-store`
// (AUDIO AU4, J299): the assets would send the path's year-long `immutable` from `_headers`, so one miss during a
// deploy would stay on phones and at the edge for a year. Any answer but a 2xx or a 304 is no-store; those keep theirs.
// SA37: `/slug/<slug>` on every host is the page too, with its link-preview tags (og:title, og:description, og:image) from
// the catalogue the page carries (slug-meta.ts); a slug that names no shard answers 404. SA49: unless the channel's placement
// file gives it a cell and the API names it (placed-slug.ts), a new author's shard placed after the build. TC-B12, OF31i4: a
// retired slug the page doesn't name goes 302 to the slug that replaced it, from the same file's `aliases`.

import { placedName, retiredName } from './placed-slug.ts'
import { placedMeta, slugMeta, withSlugMeta } from './slug-meta.ts'

interface Fetcher {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the runtime's Request, only passed through
  fetch: (request: Request) => Promise<Response>
}

interface Env {
  readonly ASSETS: Fetcher
}

const SW = /^sw(?:=|$)/u

/** The doctor's destination: the request's query pairs as written, any `sw` dropped, then `sw=0`. */
function doctor(search: string): string {
  const kept = search.replace(/^\?/u, '').split('&').filter((pair): boolean => pair !== '' && !SW.test(pair))
  return `/doctor/?${[...kept, 'sw=0'].join('&')}`
}
const PAGE = new Set(['/', '/index.html'])
// SA36: the one-shard page a sharddev author shares (src/client/app/slugPath.ts reads the same paths)
const EXPLORE_HOST = 'explore.wildshard.io'
const EXPLORE_SLUG = /^\/(?<slug>[a-z0-9-]{1,80})\/?$/u
const MMO_ORIGINS = new Set(['https://play.wildshard.io', 'https://staging.wildshard.io'])
const SLUG = /^\/slug\/(?<slug>[\w-]+)\/?$/u
const NOT_FOUND = 404
const PLAIN = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
const DROPPED = ['content-length', 'etag', 'last-modified']
const OK = 200
const FOUND = 302
const PART = /^\/assets\/spawn\/(?:parts|server)\/[^/]+\.pack\.br$/u
const NOT_MODIFIED = 304
// Meta IPHONE13-DRIFTWOOD DW12: the game's document, and only it, says COOP `same-origin` (scripts/app-build/isolation.mjs
// DOCUMENT_OPENER; a named value export would be a workerd entrypoint). WebKit starts a navigation whose opener policy
// changes in a new WebContent, so a boot after a COOP-less page never inherits the last boot's heap.
const OPENER = 'same-origin'
// DW12: the leave page between two game documents, with no opener policy (scripts/app-build/isolation.mjs LEAVE_PAGE, the
// same bytes; test/page-headers.test.ts pins them): the next game document starts in a new WebContent.
const LEAVE_PATH = '/leave'
const LEAVE_PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="dark"><meta name="robots" content="noindex"><style>html,body{margin:0;background:#050810}i{position:fixed;left:0;top:50%;width:30%;height:2px;background:#7fd8ff;animation:s 1s linear infinite}@keyframes s{from{transform:translateX(-100%)}to{transform:translateX(340%)}}</style><script>(()=>{let to="/",gone=0;try{const u=new URL(new URLSearchParams(location.search).get("to")||"/",location.origin);if(u.origin===location.origin&&u.pathname!=="/leave")to=u.pathname+u.search+u.hash}catch{}const go=()=>{if(!gone){gone=1;location.replace(to)}};requestAnimationFrame(()=>requestAnimationFrame(go));setTimeout(go,150)})()</script></head><body><i></i></body></html>'
const LEAVE_HEADERS = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }

/** Where a host's slug links live: Explore's at the root, every other host's under `/slug/`. */
function slugAt(url: Readonly<URL>): string {
  return url.hostname === EXPLORE_HOST ? '/' : '/slug/'
}

/** TC-B12, OF31i4: a slug the page doesn't name: 302 to the slug that replaced it (the name may still move), else a 404. */
async function unnamedSlug(url: Readonly<URL>, slug: string, head: boolean): Promise<Response> {
  const now = await retiredName(url.hostname, slug)
  if (now !== undefined) {
    return new Response(undefined, { status: FOUND, headers: { location: new URL(`${slugAt(url)}${now}${url.search}`, url).href, 'cache-control': 'no-store' } })
  }
  return new Response(head ? undefined : `No shard is named ${slug}.\n`, { status: NOT_FOUND, headers: PLAIN })
}

/** A 2xx or a 304 as the assets sent it; any other answer (a 404 above all) with `Cache-Control: no-store`. */
function uncachedMiss(asset: Response): Response {
  if (asset.ok || asset.status === NOT_MODIFIED) {
    return asset
  }
  const response = new Response(asset.body, asset)
  response.headers.set('cache-control', 'no-store')
  return response
}

// The Workers runtime's ResponseInit: `manual` means the body is already encoded as its Content-Encoding says.
interface EncodedInit extends ResponseInit {
  readonly encodeBody: 'manual'
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the runtime's Request and bindings, only read
async function part(request: Request, env: Env): Promise<Response> {
  const asset = await env.ASSETS.fetch(request)
  if (asset.status !== OK) {
    return uncachedMiss(asset)
  }
  const headers = new Headers(asset.headers)
  headers.set('content-encoding', 'br')
  const init: EncodedInit = { status: OK, headers, encodeBody: 'manual' }
  return new Response(asset.body, init)
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the runtime's Request and bindings, only read
async function page(request: Request, url: URL, env: Env): Promise<Response> {
  if (url.searchParams.has('doctor')) {
    return new Response(undefined, { status: 307, headers: { location: doctor(url.search), 'cache-control': 'public, max-age=0, must-revalidate' } })
  }
  const asset = await env.ASSETS.fetch(new Request(new URL('/', url), request))
  const response = new Response(asset.body, asset)
  response.headers.set('cache-control', 'no-store')
  // OV6: the Cloudflare edge's assets say `text/html` (local wrangler dev adds the charset); the old host said this.
  response.headers.set('content-type', 'text/html; charset=utf-8')
  response.headers.set('cross-origin-opener-policy', OPENER)
  return response
}

/** The page's headers for a rewritten body: no-store, HTML, and none that describe the stored bytes. */
function pageHeaders(asset: Response): Headers {
  const headers = new Headers(asset.headers)
  for (const name of DROPPED) {
    headers.delete(name)
  }
  headers.set('cache-control', 'no-store')
  headers.set('content-type', 'text/html; charset=utf-8')
  headers.set('cross-origin-opener-policy', OPENER)
  return headers
}

interface SlugRequest {
  readonly request: Request
  readonly url: URL
  readonly slug: string
}

/** The page's own tags for `slug`, else SA49's for a slug the API placed after this build, else undefined (a 404). */
async function pageMeta(html: string, slug: string, url: Readonly<URL>): Promise<ReturnType<typeof slugMeta>> {
  const found = slugMeta(html, slug, url.origin)
  if (found !== undefined) {
    return found
  }
  const name = await placedName(url.hostname, slug)
  return name === undefined ? undefined : placedMeta(html, url.origin, { slug, name })
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the runtime's Request and bindings, only read
async function slugPage({ request, url, slug }: SlugRequest, env: Env): Promise<Response> {
  // The page itself, whole: a HEAD's empty body or a conditional request's 304 would hide which shards it names (review)
  const asset = await env.ASSETS.fetch(new Request(new URL('/', url), { method: 'GET' }))
  if (!asset.ok) {
    return uncachedMiss(asset)
  }
  const html = await asset.text()
  const meta = await pageMeta(html, slug, url)
  const head = request.method === 'HEAD'
  if (meta === undefined) {
    return await unnamedSlug(url, slug, head)
  }
  const shared = { ...meta, url: new URL(`${slugAt(url)}${slug}`, url.origin).href }
  return new Response(head ? undefined : withSlugMeta(html, shared), { status: OK, headers: pageHeaders(asset) })
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the runtime's Request and bindings, only read
async function namedSlug({ request, url, slug }: SlugRequest, env: Env): Promise<Response> {
  return await slugPage({ request, url, slug }, env)
}

function redirectToExplore(url: Readonly<URL>, slug: string): Response {
  const destination = new URL(`/${slug}`, `https://${EXPLORE_HOST}`)
  for (const key of ['explore', 'cam', 'model']) {
    for (const value of url.searchParams.getAll(key)) {
      destination.searchParams.append(key, value)
    }
  }
  return new Response(undefined, { status: FOUND, headers: { location: destination.href, 'cache-control': 'no-store' } })
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the runtime's Request and bindings, only read
function exploreRequest(request: Request, { url, slug }: SlugAddress, env: Env): Response | Promise<Response> | undefined {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return undefined
  }
  if (url.hostname === EXPLORE_HOST) {
    const name = EXPLORE_SLUG.exec(url.pathname)?.groups?.['slug']
    return name === undefined ? undefined : slugPage({ request, url, slug: name }, env)
  }
  return slug !== undefined && url.searchParams.has('explore') && MMO_ORIGINS.has(url.origin)
    ? redirectToExplore(url, slug) : undefined
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the runtime's Request and bindings, only read
async function normalPage(request: Request, { url, slug }: SlugAddress, env: Env): Promise<Response> {
  // A slug link's `?doctor` goes to the doctor as the page's does
  if (PAGE.has(url.pathname) || (slug !== undefined && url.searchParams.has('doctor'))) {
    return await page(request, url, env)
  }
  if (slug !== undefined) {
    return await namedSlug({ request, url, slug }, env)
  }
  if (PART.test(url.pathname)) {
    return await part(request, env)
  }
  if (url.pathname === LEAVE_PATH) {
    return new Response(request.method === 'HEAD' ? undefined : LEAVE_PAGE, { status: OK, headers: LEAVE_HEADERS })
  }
  return uncachedMiss(await env.ASSETS.fetch(request))
}

interface SlugAddress {
  readonly url: URL
  readonly slug: string | undefined
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the runtime's Request and bindings, only read
async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const address = { url, slug: SLUG.exec(url.pathname)?.groups?.['slug'] }
  return await (exploreRequest(request, address, env) ?? normalPage(request, address, env))
}

const worker = { fetch: handle }

// Only the default export: workerd treats every named value export as an entrypoint and refuses a string.
export type { Env }
// oxlint-disable-next-line import/no-default-export -- the Workers runtime loads the module's default export
export default worker
