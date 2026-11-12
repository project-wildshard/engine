/** PAGE-SIZE PZ3 (J276): the boot bank's `contentBase`, the origin a page reads its content from. Empty or absent means the
 * page's own origin. PZ4 stamps it before the service worker bakes the document; PZ3's journey stamps a built page.
 * @param {string} html @param {string} base an http(s) origin with the root path, or '' */
export function stampContentBase(html, base) {
  if (base !== '') {
    const url = new URL(base);
    if (!/^https?:$/u.test(url.protocol) || url.pathname !== '/' || url.search !== '' || url.hash !== '') throw new Error(`Invalid content base: ${base}`);
  }
  const expression = /(<script type="application\/json" id="boot-module-files">)([^<]+)(<\/script>)/u, match = expression.exec(html);
  if (match?.[2] === undefined) throw new Error('Missing boot bank');
  /** @type {unknown} */
  const bank = JSON.parse(match[2]);
  if (typeof bank !== 'object' || bank === null || Array.isArray(bank)) throw new Error('Invalid boot bank');
  const json = JSON.stringify({ ...bank, contentBase: base === '' ? '' : new URL(base).href }).replaceAll('<', String.raw`<`);
  return html.replace(expression, () => `<script type="application/json" id="boot-module-files">${json}</script>`);
}
