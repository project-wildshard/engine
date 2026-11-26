/** PAGE-SIZE PZ3 (J276): the boot bank's `contentBase`, the base a page reads its content from: an origin, or one with PZ2's
 * `content/<set>/` folder (PZ13). Empty or absent means the page's own origin. PZ8 stamps it before the service worker bakes
 * the document; PZ3's journey stamps a built page. PZ13: the document's own title art (the launch hero, the loading
 * portrait, the iOS startup image) is content too, so a base moves those URLs with it; the logical names stay.
 * @param {string} html @param {string} base an http(s) URL with a folder path, or '' */
export function stampContentBase(html, base) {
  if (base !== '') {
    if (/[?#]/u.test(base)) throw new Error(`Invalid content base: ${base}`);
    let url;
    try { url = new URL(base); } catch { throw new Error(`Invalid content base: ${base}`); }
    if (!/^https?:$/u.test(url.protocol) || !url.pathname.endsWith('/') || url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') throw new Error(`Invalid content base: ${base}`);
  }
  const expression = /(<script type="application\/json" id="boot-module-files">)([^<]+)(<\/script>)/u, match = expression.exec(html);
  if (match?.[2] === undefined) throw new Error('Missing boot bank');
  /** @type {unknown} */
  const bank = JSON.parse(match[2]);
  if (typeof bank !== 'object' || bank === null || Array.isArray(bank)) throw new Error('Invalid boot bank');
  const json = JSON.stringify({ ...bank, contentBase: base === '' ? '' : new URL(base).href }).replaceAll('<', String.raw`<`);
  const stamped = html.replace(expression, () => `<script type="application/json" id="boot-module-files">${json}</script>`);
  return base === '' ? stamped : preconnect(titleArtOn(stamped, new URL(base).href), new URL(base).origin);
}

/** QA 11-19 row 19: a Home Screen launch keeps iOS's still image up until `load`, and the first hero on the content origin is
 * the last read `load` waits for. Open that origin's connections with the head: a plain one for the hero image (a no-cors
 * read) and an anonymous one for the CORS reads that follow. Once only, however often a document is stamped.
 * @param {string} html @param {string} origin */
function preconnect(html, origin) {
  if (html.includes(`<link rel="preconnect" href="${origin}"`)) return html;
  return html.replace(/<head(\s[^>]*)?>/u, head => `${head}<link rel="preconnect" href="${origin}" /><link rel="preconnect" href="${origin}" crossorigin />`);
}

/** The document's title art on the base: `href="/assets/title/…"`, CSS URLs (quoted or minified) and the values of the
 * `BEGIN TITLE URLS` table. Its keys, and the scripts' lookups by them, keep the logical page paths.
 * @param {string} html @param {string} base */
function titleArtOn(html, base) {
  const on = (/** @type {string} */ path) => `${base}${path.slice(1)}`;
  const block = /(\/\/ BEGIN TITLE URLS\n\s*const titleAssetURLs = )(\{[^\n]*\})(;\n\s*\/\/ END TITLE URLS)/u;
  const tabled = html.replace(block, (_all, /** @type {string} */ head, /** @type {string} */ table, /** @type {string} */ tail) => {
    /** @type {Record<string, string>} */ const urls = JSON.parse(table);
    return `${head}${JSON.stringify(Object.fromEntries(Object.entries(urls).map(([key, url]) => [key, url.startsWith('/assets/title/') ? on(url) : url])))}${tail}`;
  });
  return tabled.replaceAll(/(href="|url\(\s*["']?)(\/assets\/title\/[^"'()\s<>]+)/gu, (_all, /** @type {string} */ lead, /** @type {string} */ path) => `${lead}${on(path)}`);
}
