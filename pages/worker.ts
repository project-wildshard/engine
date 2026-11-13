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
// file gives it a cell and the API names it (placed-slug.ts), a new author's shard placed after the build.

import { placedName } from './placed-slug.ts'
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
const SLUG = /^\/slug\/(?<slug>[\w-]+)\/?$/u
const NOT_FOUND = 404
const PLAIN = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
const DROPPED = ['content-length', 'etag', 'last-modified']
const OK = 200
const PART = /^\/assets\/spawn\/(?:parts|server)\/[^/]+\.pack\.br$/u
const NOT_MODIFIED = 304

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
  return headers
}

interface SlugRequest {
  readonly request: Request
  readonly url: URL
  readonly slug: string
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the runtime's Request and bindings, only read
async function slugPage({ request, url, slug }: SlugRequest, env: Env): Promise<Response> {
  // The page itself, whole: a HEAD's empty body or a conditional request's 304 would hide which shards it names (review)
  const asset = await env.ASSETS.fetch(new Request(new URL('/', url), { method: 'GET' }))
  if (!asset.ok) {
    return uncachedMiss(asset)
  }
  const html = await asset.text()
  const found = slugMeta(html, slug, url.origin)
  const name = found === undefined ? await placedName(url.hostname, slug) : undefined
  const meta = found ?? (name === undefined ? undefined : placedMeta(html, slug, url.origin, name))
  const head = request.method === 'HEAD'
  if (meta === undefined) {
    return new Response(head ? undefined : `No shard is named ${slug}.\n`, { status: NOT_FOUND, headers: PLAIN })
  }
  return new Response(head ? undefined : withSlugMeta(html, meta), { status: OK, headers: pageHeaders(asset) })
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the runtime's Request and bindings, only read
async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const slug = SLUG.exec(url.pathname)?.groups?.['slug']
  // A slug link's `?doctor` goes to the doctor as the page's does
  if (PAGE.has(url.pathname) || (slug !== undefined && url.searchParams.has('doctor'))) {
    return await page(request, url, env)
  }
  if (slug !== undefined) {
    return await slugPage({ request, url, slug }, env)
  }
  if (PART.test(url.pathname)) {
    return await part(request, env)
  }
  return uncachedMiss(await env.ASSETS.fetch(request))
}

const worker = { fetch: handle }

// Only the default export: workerd treats every named value export as an entrypoint and refuses a string.
export type { Env }
// oxlint-disable-next-line import/no-default-export -- the Workers runtime loads the module's default export
export default worker
