// Production is humans only (J205, J209; meta QA 11-25 row 124). On 2026-11-26 a lane's marked headless boots of
// play.wildshard.io clicked ENTER THE MMO and Zone Select; nothing reached a room only because the content set 404'd.
// Every browser the marked helper (browser-playwright.mjs) starts now stops at prod's title:
//   - a Chromium start can't resolve the production rooms host (`--host-resolver-rules`), so no socket, Zone Select
//     ask or press reaches it, whoever drives the browser (agent-browser over CDP included);
//   - every page refuses `goto` to a production game URL other than the bare title page (`/`, with only `agent`,
//     `mute`, `nolock` or `sw` in its query), and once it has opened prod its context aborts navigations past the
//     title, requests to the rooms host, and closes any socket to it (WebKit and Firefox have no resolver switch).
// The routes go in only after a page opens prod: Playwright routing turns the HTTP cache off, and local and staging
// load benches need it. Staging (`rooms-staging.wildshard.io`, `staging.wildshard.io`) and local are untouched.

export const PROD_PAGE_HOST = 'play.wildshard.io';
export const PROD_ROOMS_HOST = 'rooms.wildshard.io';
const RESOLVER = '--host-resolver-rules=';
export const PROD_ROOMS_BLOCK = `${RESOLVER}MAP ${PROD_ROOMS_HOST} ~NOTFOUND`;
/** Query words the bare title may carry: the marker and the switches that keep a page quiet and still. */
const TITLE_WORDS = new Set(['agent', 'mute', 'nolock', 'sw']);
const TITLE_PATHS = new Set(['/', '/index.html']);
const REASON = 'production is humans only (J205): agents may open the bare title page of play.wildshard.io, never join';

/** @param {string | URL} url @returns {URL | undefined} */
function parsed(url) {
  try { return new URL(String(url)); } catch { return undefined; }
}

/** True for the production rooms host, over any scheme (wss, https). @param {string | URL} url */
export function prodRoomsUrl(url) {
  return parsed(url)?.hostname.toLowerCase().replace(/\.$/u, '') === PROD_ROOMS_HOST;
}

/** True for a production game page or the rooms host. @param {string | URL} url */
export function prodGameUrl(url) {
  const host = parsed(url)?.hostname.toLowerCase().replace(/\.$/u, '');
  return host === PROD_PAGE_HOST || host === PROD_ROOMS_HOST;
}

/** Why an agent may not open this URL, or undefined. Only prod's bare title page (and every non-prod URL) passes.
 * @param {string | URL} url @returns {string | undefined} */
export function prodNavigationRefusal(url) {
  const at = parsed(url);
  if (at === undefined) return undefined;
  if (prodRoomsUrl(at)) return `${REASON}: ${PROD_ROOMS_HOST} is refused`;
  if (at.hostname.toLowerCase().replace(/\.$/u, '') !== PROD_PAGE_HOST) return undefined;
  const extra = [...at.searchParams.keys()].filter(word => !TITLE_WORDS.has(word));
  if (!TITLE_PATHS.has(at.pathname) || extra.length > 0) {
    return `${REASON}: ${at.pathname}${extra.length > 0 ? ` with ${extra.join(', ')}` : ''} is past the title`;
  }
  return undefined;
}

/** Chromium args with the rooms host unresolvable, merged into a resolver rule the caller already set.
 * @param {readonly string[]} args @returns {string[]} */
export function withProdBlock(args) {
  const rule = PROD_ROOMS_BLOCK.slice(RESOLVER.length);
  const index = args.findIndex(arg => arg.startsWith(RESOLVER));
  if (index < 0) return [...args, PROD_ROOMS_BLOCK];
  const own = args[index] ?? RESOLVER;
  return own.includes(rule) ? [...args] : args.map((arg, at) => at === index ? `${own}, ${rule}` : arg);
}

/** Launch options with `withProdBlock` applied to their args.
 * @template {{ args?: string[] }} Options @param {Options | undefined} options @returns {Options} */
export function prodBlockedLaunch(options) {
  return /** @type {Options} */ ({ ...options, args: withProdBlock(options?.args ?? []) });
}

/** @typedef {{ isNavigationRequest(): boolean, url(): string }} GuardRequest */
/** @typedef {{ request(): GuardRequest, abort(code?: string): Promise<void>, fallback(): Promise<void> }} GuardRoute */
/** @typedef {{ close(options?: { code?: number, reason?: string }): Promise<void> }} GuardSocket */
/** @typedef {{
 *   route(match: (url: URL) => boolean, handle: (route: GuardRoute) => Promise<void>): Promise<void>,
 *   routeWebSocket?: (match: (url: URL) => boolean, handle: (socket: GuardSocket) => Promise<void>) => Promise<void>,
 * }} GuardContext */

const routed = new WeakSet();

/** The context's routes, once: navigations past prod's title and the rooms host's requests abort, its sockets close.
 * @param {GuardContext} context */
export async function guardProdRoutes(context) {
  if (routed.has(context)) return;
  routed.add(context);
  await context.route(url => prodGameUrl(url), async route => {
    const request = route.request();
    if (prodRoomsUrl(request.url()) || (request.isNavigationRequest() && prodNavigationRefusal(request.url()) !== undefined)) {
      console.error(`browser-prod-guard: ${prodNavigationRefusal(request.url()) ?? REASON}`);
      await route.abort('blockedbyclient');
    } else await route.fallback();
  });
  await context.routeWebSocket?.(url => prodRoomsUrl(url), async socket => { await socket.close({ code: 1008, reason: 'J205' }); });
}

/** @typedef {{ goto(url: string, options?: unknown): Promise<unknown>, context(): GuardContext }} GuardPage */
const pages = new WeakSet();

/** A page whose `goto` refuses prod past the title, and routes its context before it opens prod at all.
 * @template {GuardPage} Page @param {Page} page @returns {Page} */
export function prodGuardedPage(page) {
  if (pages.has(page) || typeof page?.goto !== 'function') return page;
  pages.add(page);
  const goto = page.goto.bind(page);
  page.goto = async (url, options) => {
    const why = prodNavigationRefusal(url);
    if (why !== undefined) throw new Error(`browser-prod-guard refused ${url}: ${why}`);
    if (prodGameUrl(url) && typeof page.context === 'function') await guardProdRoutes(page.context());
    return goto(url, options);
  };
  return page;
}

/** Guard a context's pages (those it has and every later one) or a page; anything else passes through.
 * @template T @param {T} target @returns {T} */
export function prodGuarded(target) {
  const own = /** @type {any} */ (target);
  if (typeof own?.goto === 'function') return /** @type {T} */ (prodGuardedPage(own));
  if (typeof own?.on === 'function' && typeof own?.pages === 'function') {
    for (const page of own.pages()) prodGuardedPage(page);
    own.on('page', (/** @type {GuardPage} */ page) => { prodGuardedPage(page); });
  }
  return target;
}
