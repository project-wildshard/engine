// The game page's Worker (meta OFF-VERCEL-PLAN OV1, J272). Static assets serve everything; `run_worker_first` sends
// only `/` and `/index.html` here, where this does what vercel.json did for the page:
// - `?doctor` (any value) goes 302 to `/doctor/?sw=0`;
// - otherwise the page itself, with `Cache-Control: no-store`.
// `/index.html` is served as `/`: Vercel answered it 200, and the assets' default HTML handling would 307 it to `/`.

interface Fetcher {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the runtime's Request, only passed through
  fetch: (request: Request) => Promise<Response>
}

interface Env {
  readonly ASSETS: Fetcher
}

const DOCTOR = '/doctor/?sw=0'

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the runtime's Request and bindings, only read
async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (url.searchParams.has('doctor')) {
    return new Response(undefined, { status: 302, headers: { location: DOCTOR, 'cache-control': 'no-store' } })
  }
  if (url.pathname === '/index.html') {
    url.pathname = '/'
  }
  const asset = await env.ASSETS.fetch(new Request(url, request))
  const response = new Response(asset.body, asset)
  response.headers.set('cache-control', 'no-store')
  return response
}

const worker = { fetch: handle }

export { DOCTOR, type Env }
// oxlint-disable-next-line import/no-default-export -- the Workers runtime loads the module's default export
export default worker
