// The game page's Worker (meta OFF-VERCEL-PLAN OV1, J272). Static assets serve everything; `run_worker_first` sends
// only `/`, `/index.html` and the spawn parts here, where this does what vercel.json did:
// - `?doctor` (any value) on the page goes 307 to `/doctor/?sw=0`, keeping the rest of the query as written, as Vercel's
//   `permanent: false` redirect did (`/?x=1&doctor` → `/doctor/?x=1&doctor&sw=0`; OV2's parity check against play);
// - otherwise the page itself, with `Cache-Control: no-store`;
// - a `.pack.br` spawn part goes out as its stored q11 bytes with `Content-Encoding: br` (DL15). OV2 measured that
//   `_headers` can't do it: the runtime brotli-encodes the stored bytes a second time. `encodeBody: "manual"` sends them
//   as they are. Its other headers (cache, content type) still come from `_headers` via the assets.
// `/index.html` is served as `/`: Vercel answered it 200, and the assets' default HTML handling would 307 it to `/`.
// A path with no asset also reaches the Worker; it goes straight back to the assets, untouched, to 404.

interface Fetcher {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the runtime's Request, only passed through
  fetch: (request: Request) => Promise<Response>
}

interface Env {
  readonly ASSETS: Fetcher
}

const SW = /^sw(?:=|$)/u

/** Vercel's destination: the request's query pairs as written, any `sw` dropped, then `sw=0`. */
function doctor(search: string): string {
  const kept = search.replace(/^\?/u, '').split('&').filter((pair): boolean => pair !== '' && !SW.test(pair))
  return `/doctor/?${[...kept, 'sw=0'].join('&')}`
}
const PAGE = new Set(['/', '/index.html'])
const OK = 200
const PART = /^\/assets\/spawn\/(?:parts|server)\/[^/]+\.pack\.br$/u

// The Workers runtime's ResponseInit: `manual` means the body is already encoded as its Content-Encoding says.
interface EncodedInit extends ResponseInit {
  readonly encodeBody: 'manual'
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the runtime's Request and bindings, only read
async function part(request: Request, env: Env): Promise<Response> {
  const asset = await env.ASSETS.fetch(request)
  if (asset.status !== OK) {
    return asset
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
  return response
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the runtime's Request and bindings, only read
async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (PAGE.has(url.pathname)) {
    return await page(request, url, env)
  }
  if (PART.test(url.pathname)) {
    return await part(request, env)
  }
  return await env.ASSETS.fetch(request)
}

const worker = { fetch: handle }

// Only the default export: workerd treats every named value export as an entrypoint and refuses a string.
export type { Env }
// oxlint-disable-next-line import/no-default-export -- the Workers runtime loads the module's default export
export default worker
