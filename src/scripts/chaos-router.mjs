import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'

const LIMIT = 2 * 1024 * 1024
/** Discover only URLs declared by the real build's root book/manifests. */
export function chaosRouter() {
  const packs = new Set(),
    doctors = new Set()
  /** @param {unknown} value @param {string} path */
  const add = (value, path) => {
    if (typeof value !== 'string') return
    const url = new URL(value, `http://127.0.0.1${path}`)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return
    if (packs.size >= 100_000) throw new Error('Declared URL bound exceeded')
    packs.add(url.pathname)
  }
  /** @param {unknown} value @param {string} path */
  const definitions = (value, path) => {
    if (typeof value !== 'object' || value === null) return
    for (const child of Object.values(value)) {
      if (typeof child === 'object' && child !== null && 'url' in child)
        add(child.url, path)
      else definitions(child, path)
    }
  }
  /** @param {string} path */
  const route = path =>
    path === '/__release.json'
      ? 'release'
      : path === '/version.json'
        ? 'version'
        : /(?:^|\/)assets\/spawn\/packs-[^/]+\.json$/u.test(path)
          ? 'book'
          : path.startsWith('/api/')
            ? 'api'
            : path.includes('/doctor/') || doctors.has(path)
              ? 'doctor'
              : packs.has(path)
                ? 'packs'
                : 'page'
  /** Learn metadata from the unmodified upstream bytes, including compressed
   * JSON. Never guess that every static asset is a pack.
   * @param {string} path @param {import('node:http').IncomingHttpHeaders} headers @param {Buffer} encoded */
  const observe = (path, headers, encoded) => {
    if (encoded.length > LIMIT) return false
    const classification = route(path)
    if (!['book', 'packs', 'doctor'].includes(classification)) return true
    try {
      const encoding = headers['content-encoding']
      const bytes =
        encoding === 'br'
          ? brotliDecompressSync(encoded, { maxOutputLength: LIMIT })
          : encoding === 'gzip'
            ? gunzipSync(encoded, { maxOutputLength: LIMIT })
            : encoding === 'deflate'
              ? inflateSync(encoded, { maxOutputLength: LIMIT })
              : encoded
      if (bytes.length > LIMIT) return false
      if (classification === 'doctor') {
        if (headers['content-type']?.includes('text/html'))
          for (const match of bytes
            .toString()
            .matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/giu)) {
            const url = new URL(match[1] ?? '', `http://127.0.0.1${path}`)
            if (url.origin === 'http://127.0.0.1') doctors.add(url.pathname)
          }
        return true
      }
      if (!path.endsWith('.json') && !headers['content-type']?.includes('json'))
        return true
      const value = /** @type {unknown} */ (JSON.parse(bytes.toString()))
      if (typeof value !== 'object' || value === null) return true
      if (classification === 'book') {
        if ('client' in value) definitions(value.client, path)
        if ('grid' in value) definitions(value.grid, path)
      } else {
        for (const key of ['files', 'parts']) {
          const members = Reflect.get(value, key)
          if (Array.isArray(members))
            for (const member of members)
              add(
                typeof member === 'string'
                  ? member
                  : typeof member === 'object' &&
                      member !== null &&
                      'url' in member
                    ? member.url
                    : undefined,
                path,
              )
        }
      }
      return true
    } catch {
      return false
    }
  }
  return {
    route,
    observe,
    /** Corruption targets a declared binary member, never the JSON book/index.
     * @param {string} path @param {import('node:http').IncomingHttpHeaders} headers */
    binary: (path, headers) =>
      route(path) === 'packs' &&
      !path.endsWith('.json') &&
      !headers['content-type']?.includes('json'),
  }
}
