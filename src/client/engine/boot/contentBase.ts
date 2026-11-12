/**
 * PAGE-SIZE PZ3 (J276): where a page reads shard content and engine art. The boot bank (`#boot-module-files`) carries one
 * field, `contentBase`: an origin such as `https://packs.wildshard.io/`, or one with a folder path such as PZ2's
 * `https://packs.wildshard.io/content/<set>/` (PZ13), or empty (or absent) for the page's own origin, so the dev server, the
 * tests and today's builds read exactly as before. The base mirrors page paths: page `/a/b` is `<base>a/b`.
 *
 * Content is every `/shardfiles/`, `/programs/` and `/assets/` file except code and `/assets/physics/` (rapier stays in the
 * page with the other runtime files). A content read goes to the base, as a plain CORS GET with no credentials: a
 * cross-origin `fetch` sends none by default, and nothing here adds a header, so there is no preflight.
 *
 * Level files keep their page URLs (J138): the spawn download's member store is keyed by them, so a reader that asks with a
 * content URL is looked up by `pageURL()` of it. This leaf imports nothing; the spawn download and the engine both use it.
 */
let parsed: { readonly text: string; readonly base: string } | undefined;

const pageBase = (): string => typeof document === 'undefined' ? location.href : document.baseURI || location.href;

/** The bank's `contentBase`, checked: an http(s) origin with a folder path (`/` or `/content/<set>/`), or empty. A query, a
 *  hash, credentials, a relative base, another scheme or a path not ending in `/` is a broken build. */
export function readContentBase(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  // a bare `?` or `#` parses to an empty search or hash, and a path joined after it would land in the query (review)
  if (typeof value !== 'string') throw new Error('Invalid contentBase in the boot bank');
  if (/[?#]/u.test(value)) throw new Error(`Invalid contentBase in the boot bank: ${value}`);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`Invalid contentBase in the boot bank: ${value}`); }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.pathname.endsWith('/') || url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
    throw new Error(`Invalid contentBase in the boot bank: ${value}`);
  }
  return url.href;
}

/** The content base (`https://packs.wildshard.io/content/<set>/`), or '' when content is on the page's own origin. */
export function contentBase(): string {
  if (typeof document === 'undefined') return '';
  const text = document.getElementById('boot-module-files')?.textContent ?? '';
  if (parsed?.text === text) return parsed.base;
  let base = '';
  if (text !== '') {
    const bank: unknown = JSON.parse(text);
    base = readContentBase(typeof bank === 'object' && bank !== null ? Reflect.get(bank, 'contentBase') : undefined);
  }
  parsed = { text, base };
  return base;
}

/** A path the content base serves: shard products, programs, and `/assets/` art and books, not code or physics. */
export function isContentPath(path: string): boolean {
  if (/\.(?:js|mjs|css|map)$/u.test(path)) return false;
  return path.startsWith('/shardfiles/') || path.startsWith('/programs/') || (path.startsWith('/assets/') && !path.startsWith('/assets/physics/'));
}

/** Where to read `url` (relative to the page, or a page URL): the same path and query on the content base when it is
 *  content on the page's origin and the bank names a base. Anything else, and every URL with no base, comes back as is. */
export function contentURL(url: string, base: string = contentBase()): string {
  if (base === '') return url;
  const page = new URL(pageBase()), address = new URL(url, page), root = new URL(base);
  if (address.origin !== page.origin || !isContentPath(address.pathname)) return url;
  // a base on the page's own origin under a content path: a URL already in its folder is not moved again (review)
  if (root.origin === page.origin && root.pathname !== '/' && address.pathname.startsWith(root.pathname)) return url;
  return new URL(`.${address.pathname}${address.search}`, base).href;
}

/** The page URL a content URL stands for (J138: the member store keys level files by page URL). Others: as is. */
export function pageURL(url: string, base: string = contentBase()): string {
  if (base === '') return url;
  const address = new URL(url, pageBase()), root = new URL(base);
  if (address.origin !== root.origin || !address.pathname.startsWith(root.pathname)) return url;
  const path = address.pathname.slice(root.pathname.length - 1);
  if (!isContentPath(path)) return url;
  return new URL(path + address.search, pageBase()).href;
}

/** True for the page's own origin and, when the bank names one, the content origin. */
export function isContentOrigin(origin: string, base: string = contentBase()): boolean {
  return origin === new URL(pageBase()).origin || (base !== '' && origin === new URL(base).origin);
}
