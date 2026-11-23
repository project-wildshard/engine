import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * PAGE-SIZE PZ12 (J274, preview first): cross-origin isolation per channel. An isolated channel's page origin answers every
 * path with COOP `same-origin` and COEP `require-corp` (its build appends one `/*` rule to `dist/_headers`), so the
 * document, its module workers and the standalone server worker's script all carry them. The service worker answers a
 * navigation with its baked document; it sends the same two headers, read from that rule, so a load it serves is isolated
 * like one the network serves. Content on packs.wildshard.io passes: every read there is CORS, and PC1 sends CORP.
 * Staging and production join as J274 rolls out: add them here.
 */
export const ISOLATED_CHANNELS = new Set(['preview']);
export const ISOLATION_HEADERS = Object.freeze({ 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
const MARK = '# PAGE-SIZE PZ12 (J274): this channel is cross-origin isolated';

/** @param {string | undefined} channel */
export const isolated = channel => channel !== undefined && ISOLATED_CHANNELS.has(channel);

/** The `_headers` text with the isolation rule appended (once) for an isolated channel; unchanged for any other.
 * @param {string} text @param {string | undefined} channel */
export function withIsolationRule(text, channel) {
  if (!isolated(channel) || text.includes(MARK)) return text;
  const rule = Object.entries(ISOLATION_HEADERS).map(([name, value]) => `  ${name}: ${value}`).join('\n');
  return `${text.endsWith('\n') ? text : `${text}\n`}\n${MARK}\n/*\n${rule}\n`;
}

/** Append the rule to a build's `_headers`. @param {string} outDir @param {string | undefined} channel @returns {boolean} isolated */
export function writeIsolationRule(outDir, channel) {
  const file = join(outDir, '_headers'), text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const next = withIsolationRule(text, channel);
  if (next !== text) appendFileSync(file, next.slice(text.length));
  return isolated(channel);
}

/**
 * Meta IPHONE13-DRIFTWOOD DW12 (mini-dw12e): the game's document says COOP `same-origin` on every channel, and nothing
 * else on the origin does. On the iPhone 13 a second Driftwood boot in the WebContent that held the first one is
 * jetsammed; WebKit starts a navigation in a new WebContent when the opener policy changes between documents, so a page
 * with none in between (robots.txt, a 404) and this one give every boot a clean process. COEP stays per channel (above):
 * without it the page is not cross-origin isolated, so nothing it loads changes. pages/worker.ts sends the same value on
 * its page answers, scripts/preview-server.mjs on these routes, and the service worker on its baked document.
 */
export const DOCUMENT_OPENER = 'same-origin';
const DOCUMENT_ROUTE = /^\/(?:index\.html)?$|^\/slug\/[\w-]+\/?$/u;
/** Whether a path is the game's document (`/`, `/index.html`, `/slug/<slug>`). @param {string} pathname */
export const isDocumentRoute = pathname => DOCUMENT_ROUTE.test(pathname);

/** The service worker's document headers: DW12's opener policy, then the channel's isolation from `_headers`.
 * @param {string} text @returns {Record<string, string>} */
export const documentHeaders = text => ({ 'cross-origin-opener-policy': DOCUMENT_OPENER, ...documentIsolation(text) });

/** The COOP and COEP a `_headers` text sends on `/` (from its `/*` rules), lower-cased, for the service worker's document.
 * @param {string} text @returns {Record<string, string>} */
export function documentIsolation(text) {
  /** @type {Record<string, string>} */ const out = {};
  let all = false;
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!/^\s/u.test(line)) { all = line.trim() === '/*'; continue; }
    const match = /^\s+(Cross-Origin-(?:Opener|Embedder)-Policy):\s*(.+?)\s*$/iu.exec(line);
    if (all && match?.[1] !== undefined && match[2] !== undefined) out[match[1].toLowerCase()] = match[2];
  }
  return out;
}

/**
 * Meta IPHONE13-DRIFTWOOD DW12 (mini-dw12e): the leave page. A navigation the game chooses (a shard switch, a reload, the
 * title) goes `location.replace('/leave?to=<path>')` first: a page with no opener policy, so WebKit moves the next game
 * document into a new WebContent instead of booting it in the process that held the last world (on the iPhone 13 that
 * second boot is jetsammed at the 1536 MB limit). It sends itself on with `location.replace`, so history keeps one entry; a
 * `to` that is not this origin's, or is the leave page, goes to `/`. pages/worker.ts and the service worker serve the same
 * bytes (a test pins them); src/client/engine/boot/freshPage.ts builds the address. QA 11-23 row 8: it draws a sweeping bar and
 * leaves two frames later (a timer covers a page that draws none): an inline replace left WebKit's screen still and blank.
 */
export const LEAVE_PATH = '/leave';
export const LEAVE_PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="dark">'
  + '<meta name="robots" content="noindex"><style>html,body{margin:0;background:#050810}i{position:fixed;left:0;top:50%;width:30%;'
  + 'height:2px;background:#7fd8ff;animation:s 1s linear infinite}@keyframes s{from{transform:translateX(-100%)}to{transform:translateX(340%)}}'
  + '</style><script>(()=>{let to="/",gone=0;'
  + 'try{const u=new URL(new URLSearchParams(location.search).get("to")||"/",location.origin);'
  + 'if(u.origin===location.origin&&u.pathname!=="/leave")to=u.pathname+u.search+u.hash}catch{}'
  + 'const go=()=>{if(!gone){gone=1;location.replace(to)}};requestAnimationFrame(()=>requestAnimationFrame(go));setTimeout(go,150)})()'
  + '</script></head><body><i></i></body></html>';
/** The leave page's headers: no opener policy, and never stored. */
export const LEAVE_HEADERS = Object.freeze({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
