/*
 * SA37 (meta SHARD-AUTHORING-PLAN): what the page's Worker (worker.ts) says about a `/slug/<slug>` link before any script
 * runs: the link-preview tags a chat app reads, and whether the slug is a shard at all. Everything comes from the built page
 * itself, the same rows the client reads (src/client/game/shard/titleList.ts): `#ws-title-rows` (each shard's name, its
 * one-line blurb and its card art) and `#ws-catalogue` (C3: the shards the catalogue added, by name only). No fetch, no
 * binding: the page the Worker is about to send is the catalogue.
 *
 *   const meta = slugMeta(html, 'driftwood-isle', 'https://play.wildshard.io')   // undefined: no such shard, a 404
 *   const page = withSlugMeta(html, meta)                                          // the page, with og: tags in its head
 */

/** The three preview tags (og:title, og:description, og:image) and the link's own address. */
interface SlugMeta {
  readonly title: string
  readonly description: string
  /** An absolute URL: chat apps fetch it from their own servers */
  readonly image: string
  readonly url: string
}

interface TitleRow {
  readonly slug: string
  readonly name: string
  readonly biome?: string
  readonly card?: { readonly landscape?: unknown }
}
interface Catalogue {
  readonly shards?: readonly { readonly slug: string; readonly name: string }[]
  readonly placements?: readonly { readonly slug: string }[]
}

const SITE = 'Wildshard'
/** The description of a shard whose row has no blurb (a catalogue shard with no title row) */
const ON_GRID = 'A shard on the Wildshard grid. Tap to play in your browser.'
const ICON = '/apple-touch-icon.png'
const CONTENT = /^\/(?:shardfiles|assets)\//u
const BASE = /^https?:\/\/[^?#]*\/$/u
const BANK = /<script[^>]*id="boot-module-files"[^>]*>(?<body>[^<]*)<\/script>/u
const TOUCH_ICON = /<link[^>]*rel="apple-touch-icon"[^>]*href="(?<href>[^"]+)"/u
const HEAD = /<head(?:\s[^>]*)?>/iu
const TITLE = /<title>[^<]*<\/title>/u

/** Parsed JSON, or undefined for text that isn't. */
function parsed(text: string | undefined): unknown {
  if (text === undefined || text === '') {
    return undefined
  }
  try {
    const value: unknown = JSON.parse(text)
    return value
  } catch {
    return undefined
  }
}

/** The JSON inside `<script type="application/json" id="<id>">`, which the build writes with every `<` escaped. */
function inlineJson(html: string, id: string): unknown {
  return parsed(new RegExp(`<script type="application/json" id="${id}">(?<body>[^<]*)</script>`, 'u').exec(html)?.groups?.['body'])
}

/** The boot bank's content base (src/client/engine/boot/contentBase.ts, PZ3): where `/shardfiles/` art is read from. A
 *  narrower copy of its rule, for card art only: a base it can't read leaves the image on the page's origin. */
function contentBase(html: string): string {
  const bank = parsed(BANK.exec(html)?.groups?.['body'])
  const base: unknown = typeof bank === 'object' && bank !== null ? Reflect.get(bank, 'contentBase') : undefined
  return typeof base === 'string' && BASE.test(base) ? base : ''
}

/** `path` read against `origin`, or undefined for a URL that doesn't parse. */
function address(path: string, origin: string): URL | undefined {
  try {
    return new URL(path, origin)
  } catch {
    return undefined
  }
}

/** A card URL as the page reads it, made absolute: content (`/shardfiles/`, `/assets/`) on the content base when the bank
 *  names one, anything else on the page's origin. An absolute URL (a shard cooked to R2, J138) stays as written. */
function absolute(path: string, origin: string, base: string): string {
  const url = address(path, origin)
  if (url === undefined) {
    return new URL(ICON, origin).href
  }
  if (base === '' || url.origin !== new URL(origin).origin || !CONTENT.test(url.pathname)) {
    return url.href
  }
  return new URL(`.${url.pathname}${url.search}`, base).href
}

/** The page's home-screen icon, for a shard with no card art of its own. */
function siteIcon(html: string, origin: string): string {
  return new URL(TOUCH_ICON.exec(html)?.groups?.['href'] ?? ICON, origin).href
}

const isRow = (value: unknown): value is TitleRow => typeof value === 'object' && value !== null
  && typeof Reflect.get(value, 'slug') === 'string' && typeof Reflect.get(value, 'name') === 'string'
const isRows = (value: unknown): value is readonly TitleRow[] => Array.isArray(value) && value.every((row): boolean => isRow(row))
const isCatalogue = (value: unknown): value is Catalogue => typeof value === 'object' && value !== null
const bare = (slug: string): string => slug.replace(/^_/u, '')

/** A title row's tags: its landscape card (a `data:` placeholder has none: the site icon), its blurb. */
function rowMeta(html: string, row: TitleRow, origin: string): Omit<SlugMeta, 'url'> {
  const landscape = row.card?.landscape
  const image = typeof landscape === 'string' && landscape !== '' && !landscape.startsWith('data:')
    ? absolute(landscape, origin, contentBase(html)) : siteIcon(html, origin)
  const blurb = row.biome?.trim().replace(/\.$/u, '') ?? ''
  return { title: row.name, description: blurb === '' ? ON_GRID : `${blurb}. Play it in your browser on ${SITE}.`, image }
}

/** C3: a shard the catalogue added after this build, with a placement: its name, as the client's title row has it
 *  (withCatalogueHeads, the same exact-slug rule). SA30's auto-placed shards have a grid cell and no placement; the client
 *  reads them as unlisted, so they are undefined here too until the client has a row for them. */
function headMeta(html: string, slug: string, origin: string): Omit<SlugMeta, 'url'> | undefined {
  const catalogue = inlineJson(html, 'ws-catalogue')
  if (!isCatalogue(catalogue)) {
    return undefined
  }
  const placed = catalogue.placements?.find((placement): boolean => placement.slug === slug)
  const head = placed === undefined ? undefined : catalogue.shards?.find((candidate): boolean => candidate.slug === bare(placed.slug))
  return head === undefined ? undefined : { title: head.name, description: ON_GRID, image: siteIcon(html, origin) }
}

/** The preview tags for `slug`, or undefined when the page names no such shard (the Worker's 404): exactly the slugs the
 *  client's slug page finds (src/client/app/entry.ts showSlugPage, over withCatalogueHeads). */
function slugMeta(html: string, slug: string, origin: string): SlugMeta | undefined {
  const rows = inlineJson(html, 'ws-title-rows')
  const row = isRows(rows) ? rows.find((candidate): boolean => candidate.slug === slug) : undefined
  const meta = row === undefined ? headMeta(html, slug, origin) : rowMeta(html, row, origin)
  return meta === undefined ? undefined : { ...meta, url: new URL(`/slug/${slug}`, origin).href }
}

const escape = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const tag = (property: string, content: string): string => `<meta property="${property}" content="${escape(content)}">`

/** The page with the link's preview tags at the top of its head, and its tab title naming the shard. */
function withSlugMeta(html: string, meta: Readonly<SlugMeta>): string {
  const tags = [
    tag('og:type', 'website'), tag('og:site_name', SITE), tag('og:title', meta.title), tag('og:description', meta.description),
    tag('og:image', meta.image), tag('og:url', meta.url), '<meta name="twitter:card" content="summary_large_image">',
  ]
  return html.replace(HEAD, (open): string => `${open}${tags.join('')}`)
    .replace(TITLE, (): string => `<title>${escape(meta.title)} · ${SITE}</title>`)
}

export type { SlugMeta }
export { slugMeta, withSlugMeta }
