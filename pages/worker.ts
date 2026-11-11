// The game page's Worker (meta OFF-VERCEL-PLAN OV1, J272). Static assets serve everything; `run_worker_first` sends
// only `/` and `/index.html` here, where this does what vercel.json did for the page:
// - `?doctor` (any value) goes 302 to `/doctor/?sw=0`;
// - otherwise the page itself, with `Cache-Control: no-store`.
// `/index.html` is served as `/`: Vercel answered it 200, and the assets' default HTML handling would 307 it to `/`.
// A path with no asset also reaches the Worker; it goes straight back to the assets, untouched, to 404.

interface Fetcher {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the runtime's Request, only passed through
  fetch: (request: Request) => Promise<Response>
}

interface Env {
  readonly ASSETS: Fetcher
}

const DOCTOR = '/doctor/?sw=0'
const PAGE = new Set(['/', '/index.html'])

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the runtime's Request and bindings, only read
async function page(request: Request, url: URL, env: Env): Promise<Response> {
  if (url.searchParams.has('doctor')) {
    return new Response(undefined, { status: 302, headers: { location: DOCTOR, 'cache-control': 'no-store' } })
  }
  const asset = await env.ASSETS.fetch(new Request(new URL('/', url), request))
  const response = new Response(asset.body, asset)
  response.headers.set('cache-control', 'no-store')
  return response
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the runtime's Request and bindings, only read
async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  return PAGE.has(url.pathname) ? await page(request, url, env) : await env.ASSETS.fetch(request)
}

const worker = { fetch: handle }

export { DOCTOR, type Env }
// oxlint-disable-next-line import/no-default-export -- the Workers runtime loads the module's default export
export default worker
