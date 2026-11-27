import type {CookedPartMember} from '@wildshard/engine/boot/tables';
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
const cacheOrigins = new Set<string>();
let bankRead: { readonly element: Element; readonly first: ChildNode | null; readonly text: string } | undefined;

/**
 * The boot bank's text (`#boot-module-files`), or undefined with no bank. Read once per element and text node: `textContent`
 * copies the whole bank (160 kB on Driftwood) and the fetch layers ask for it several times a request, which was 5 ms of a
 * 63 ms frame as the grid's downloads started (DRIFTWOOD-FPS DF14). Replacing the element or its text re-reads it.
 */
export function bootBankText(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const element = document.getElementById('boot-module-files');
  if (element === null) { bankRead = undefined; return undefined; }
  if (bankRead?.element !== element || bankRead.first !== element.firstChild) bankRead = { element, first: element.firstChild, text: element.textContent ?? '' };
  return bankRead.text;
}

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
  const text = bootBankText() ?? '';
  if (parsed?.text === text) return parsed.base;
  let base = '';
  if (text !== '') {
    const bank: unknown = JSON.parse(text);
    base = readContentBase(typeof bank === 'object' && bank !== null ? Reflect.get(bank, 'contentBase') : undefined);
  }
  parsed = { text, base };
  return base;
}

/** A store installed by the page can participate in Clear downloads. */
export function addContentCacheOrigin(base: string): void {
  const checked = readContentBase(base);
  if (checked !== '') cacheOrigins.add(new URL(checked).origin);
}

export function contentCacheOrigins(): readonly string[] {
  const base = contentBase();
  return base === '' ? [...cacheOrigins] : [...new Set([new URL(base).origin, ...cacheOrigins])];
}

/**
 * Fix preview PV4: a zone read from the cook (`cooked.wildshard.io`, through its index under the zone table's key) keeps its page
 * paths, as J138 wants, but each path is stored at its own object key (`shards/<slug>/<shardVersion>/common/…` or `…/cooks/<v>/…`).
 * Its index's `objects` table is installed here, page path to absolute URL, so every content read below resolves through it first.
 */
const cooked = new Map<string, string>(), cookedBack = new Map<string, string>(), cookedOrigins = new Set<string>();
/** Install page paths (with or without the leading `/`) and the absolute URLs that hold their bytes. A path already installed keeps
 *  its first URL: parts and blobs are content-named, so any zone's copy is the same bytes. */
export function installCookedObjects(objects: Iterable<readonly [string, string]>): void {
  for (const [path, url] of objects) {
    const page = path.startsWith('/') ? path : `/${path}`;
    if (cooked.has(page)) continue;
    const at = new URL(url);
    if (at.search !== '' || at.hash !== '' || (at.protocol !== 'https:' && at.protocol !== 'http:')) throw new Error(`Invalid cooked object URL: ${url}`);
    cooked.set(page, at.href); cookedBack.set(at.href, page); cookedOrigins.add(at.origin);
  }
}
const packed = new Map<string, CookedPartMember>();
export function installCookedMembers(rows: Iterable<readonly [string, CookedPartMember]>): void {
  for (const [path, member] of rows) if (!packed.has(path)) packed.set(path, member);
}
export function cookedMember(path: string): CookedPartMember | undefined { return packed.get(path); }
export function cookedMembers(): readonly (readonly [string, CookedPartMember])[] { return [...packed]; }
export function clearCookedObjects(): void { cooked.clear(); cookedBack.clear(); cookedOrigins.clear(); packed.clear(); }
/** Where the cook stores a page path (`/assets/spawn/parts/…`), with `search` kept; undefined for a path no installed zone maps. */
/** PV4: the installed table, page path to cooked URL, for a worker with no document (the in-page server). */
export function cookedObjects(): readonly (readonly [string, string])[] { return [...cooked]; }

export function cookedObjectURL(pathname: string, search = ''): string | undefined {
  const url = cooked.size === 0 ? undefined : cooked.get(pathname);
  return url === undefined ? undefined : `${url}${search}`;
}

/** A path the content base serves: shard products, programs, and `/assets/` art and books, not code or physics. */
export function isContentPath(path: string): boolean {
  if (/\.(?:js|mjs|css|map)$/u.test(path)) return false;
  return path.startsWith('/shardfiles/') || path.startsWith('/programs/') || (path.startsWith('/assets/') && !path.startsWith('/assets/physics/'));
}

/** Where to read `url` (relative to the page, or a page URL): the same path and query on the content base when it is
 *  content on the page's origin and the bank names a base. Anything else, and every URL with no base, comes back as is. */
export function contentURL(url: string, base: string = contentBase()): string {
  if (base === '' && cooked.size === 0) return url;
  const page = new URL(pageBase()), address = new URL(url, page);
  if (address.origin !== page.origin || !isContentPath(address.pathname)) return url;
  // PV4: a path a cooked zone maps is read from its object, whatever the base
  const object = cookedObjectURL(address.pathname, address.search);
  if (object !== undefined) return object;
  if (base === '') return url;
  const root = new URL(base);
  // a base on the page's own origin under a content path: a URL already in its folder is not moved again (review)
  if (root.origin === page.origin && root.pathname !== '/' && address.pathname.startsWith(root.pathname)) return url;
  return new URL(`.${address.pathname}${address.search}`, base).href;
}

/** The page URL a content URL stands for (J138: the member store keys level files by page URL). Others: as is. */
export function pageURL(url: string, base: string = contentBase()): string {
  if (base === '' && cooked.size === 0) return url;
  const address = new URL(url, pageBase());
  const back = cooked.size === 0 ? undefined : cookedBack.get(address.origin + address.pathname);
  if (back !== undefined) return new URL(back + address.search, pageBase()).href;
  if (base === '') return url;
  const root = new URL(base);
  if (address.origin !== root.origin || !address.pathname.startsWith(root.pathname)) return url;
  const path = address.pathname.slice(root.pathname.length - 1);
  if (!isContentPath(path)) return url;
  return new URL(path + address.search, pageBase()).href;
}

/** True for the page's own origin and, when the bank names one, the content origin. */
export function isContentOrigin(origin: string, base: string = contentBase()): boolean {
  return origin === new URL(pageBase()).origin || (base !== '' && origin === new URL(base).origin) || cookedOrigins.has(origin);
}
