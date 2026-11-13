/*
 * SA49 (meta SHARD-AUTHORING-PLAN): a `/slug/<slug>` link for a shard the API placed after this page was built (a new
 * author's upload, SA30/SA33) names no row in the page, so slug-meta.ts finds nothing. On that miss the Worker asks two
 * things, each cached at the edge for a minute: its channel's signed placement file (the box's and the page's own,
 * `releases/<channel>-placements.json`, checked under the API's placement key) for whether the slug has a cell, and the
 * API's catalogue row (`/api/catalogue/shards/<slug>`, SA46) for its name. Only a placed slug with a row unfurls; anything
 * else, a host with no channel or any failure, stays the 404 it was. No binding and no var: the addresses are the
 * channel's, as the page's own (src/shared/game/grid/placementRows.ts).
 *
 *   const name = await placedName('staging.wildshard.io', 'thin-ice')   // undefined: not placed, a 404
 */

/** The API placement key's public half, SPKI DER in hex: placementRows.ts `PLACEMENT_PUBLIC_KEY` (a test holds them equal). */
const PLACEMENT_PUBLIC_KEY = '302a300506032b65700321004afd39342aac6a4de6066cb72e9df54cbd3d4eb522e5e6e175a17954ab98f25e'
const PACKS = 'https://packs.wildshard.io'
const API = 'https://api.wildshard.io'
/** Each host's placement channel: preview's page bakes staging's cells (SA35), so it reads staging's file. */
const CHANNELS: Readonly<Record<string, 'production' | 'staging'>> = {
  'play.wildshard.io': 'production',
  'staging.wildshard.io': 'staging',
  'preview.wildshard.io': 'staging',
}
const EDGE_SECONDS = 60
const HEX_PAIR = /../gu
const HEX_RADIX = 16

// The Workers runtime's RequestInit: `cf.cacheTtl` keeps the answer at the edge whatever its own Cache-Control says.
interface EdgeInit extends RequestInit {
  readonly cf: { readonly cacheTtl: number; readonly cacheEverything: boolean }
}
const EDGE: EdgeInit = { cf: { cacheTtl: EDGE_SECONDS, cacheEverything: true } }

const bytes = (hex: string): Uint8Array<ArrayBuffer> => new Uint8Array((hex.match(HEX_PAIR) ?? []).map((pair): number => Number.parseInt(pair, HEX_RADIX)))
const record = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null

/** JSON from `url` through the edge cache, or undefined for anything but a 200 of JSON. */
async function edgeJson(url: string): Promise<unknown> {
  try {
    const response = await fetch(url, EDGE)
    if (!response.ok) {
      return undefined
    }
    const value: unknown = await response.json()
    return value
  } catch {
    return undefined
  }
}

/** The body of a signed placement file, once its Ed25519 signature holds under the placement key; else undefined. */
async function verifiedBody(file: unknown): Promise<unknown> {
  if (!record(file) || typeof file['body'] !== 'string' || typeof file['signature'] !== 'string') {
    return undefined
  }
  try {
    const key = await crypto.subtle.importKey('spki', bytes(PLACEMENT_PUBLIC_KEY), { name: 'Ed25519' }, false, ['verify'])
    const good = await crypto.subtle.verify({ name: 'Ed25519' }, key, bytes(file['signature']), new TextEncoder().encode(file['body']))
    return good ? JSON.parse(file['body']) : undefined
  } catch {
    return undefined
  }
}

/** Whether the channel's placement file gives `slug` a cell. */
async function placed(channel: 'production' | 'staging', slug: string): Promise<boolean> {
  const body = await verifiedBody(await edgeJson(`${PACKS}/releases/${channel}-placements.json`))
  if (!record(body) || body['kind'] !== 'placement' || body['channel'] !== channel || !Array.isArray(body['cells'])) {
    return false
  }
  return body['cells'].some((cell: unknown): boolean => record(cell) && cell['slug'] === slug)
}

/** A placed slug's name from the API's catalogue row, for a host that plays a channel; undefined for any other slug. */
async function placedName(host: string, slug: string): Promise<string | undefined> {
  const channel = CHANNELS[host]
  if (channel === undefined || !(await placed(channel, slug))) {
    return undefined
  }
  const row = await edgeJson(`${API}/api/catalogue/shards/${encodeURIComponent(slug)}`)
  return record(row) && row['slug'] === slug.replace(/^_/u, '') && typeof row['name'] === 'string' && row['name'] !== '' ? row['name'] : undefined
}

export { PLACEMENT_PUBLIC_KEY, placedName }
