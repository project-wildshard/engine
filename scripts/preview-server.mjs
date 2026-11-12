#!/usr/bin/env node
// D24 (G799: no Vite plugins): serve a finished build the way production does, as a plain Node server. It replaces
// `vite preview` and its two plugins (the vercel.json header replay and Rapier's brotli copy), and keeps what the
// preview server did that callers rely on: encoded files, weak ETags with 304s, byte ranges, `.html`
// rewrites, index.html for any missing path a page or fetch asks for, and localhost CORS.
//
//   node scripts/preview-server.mjs [--outDir dist] [--port 4173] [--host 127.0.0.1] [--root <repo>]
//
// It prints `Local: http://<host>:<port>/` once it listens (callers wait for `:<port>/`), and exits on SIGTERM.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, brotliDecompress, brotliDecompressSync, constants as zlib, createBrotliCompress, createGzip, gzip as gzipCallback } from 'node:zlib';
import { createEncodedFileCache } from './preview-encoded-cache.mjs';
import { readFile as readFileAsync } from 'node:fs/promises';
import { promisify } from 'node:util';
import { createPreviewTelemetrySink } from './preview-telemetry.mjs';

const args = process.argv.slice(2);
/** a `--name value` or `--name=value` argument's value */
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  if (at !== -1) return args[at + 1] ?? fallback;
  return args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
};
const root = resolve(option('root', process.cwd())), outDir = resolve(root, option('outDir', 'dist'));
const contentDir = `${outDir}-content`;
const port = Number(option('port', '4173')), host = option('host', '127.0.0.1');
if (!existsSync(outDir)) throw new Error(`preview-server: no build in ${outDir}`);
// Local anonymous telemetry is recorded outside every public build, never sent
// to production or silently acknowledged by a browser fixture.
const telemetryDirectory = resolve(option('telemetry-dir', fileURLToPath(new URL(`../tmp/preview-telemetry/${process.pid}-${Date.now()}/`, import.meta.url))));
if (telemetryDirectory === outDir || telemetryDirectory.startsWith(outDir + sep)) throw new Error('preview-server: telemetry must be outside the served build');
const receiveTelemetry = await createPreviewTelemetrySink(telemetryDirectory);

/** `vercel.json` `source` → RegExp. Only the forms the file uses: literal paths and `(.*)` groups (Vercel's
 *  path-to-regexp escapes everything else, `.` included). The rules replay in order; the last match wins per header. */
// A source's `\.` is a literal dot (vercel.json escapes it); it becomes a plain dot before the rest is escaped.
const sourceRegex = source => new RegExp(`^${source.split('(.*)').map(s => s.replaceAll(String.raw`\.`, '.').replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)).join('(.*)')}/?$`);
const vercel = join(root, 'vercel.json');
const rules = existsSync(vercel) ? (JSON.parse(readFileSync(vercel, 'utf8')).headers ?? []).map(rule => ({ re: sourceRegex(rule.source), headers: rule.headers })) : [];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.txt': 'text/plain', '.map': 'application/json', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.ktx2': 'image/ktx2', '.hdr': 'application/octet-stream' };
const type = file => TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
// Production also encodes binary scene/pack/mesh payloads, not just text.
const COMPRESSIBLE = /text|javascript|\/json|xml|svg|manifest|octet-stream|wasm|gltf|ktx2/u;
const LOCAL_ORIGIN = /^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/u;
// Vercel's CDN brotli-compresses application/wasm (~836 KB for Rapier's 3.29 MB); answer the way production does
const RAPIER = join(outDir, 'assets/physics/rapier.wasm');
const rapierBr = existsSync(RAPIER) ? brotliCompressSync(readFileSync(RAPIER), { params: { [zlib.BROTLI_PARAM_QUALITY]: 11 } }) : null;
const encodedFiles = createEncodedFileCache();
// DL5 (11-04): a part for a client that refuses br but takes gzip (Safari over http, the Simulator's preview runs) is
// re-encoded as gzip, as near to production's br as http allows; decoded, Driftwood's parts moved 53.0 MB instead of
// 21.6 MB and the packs arm read 33 s slower than the Shardfile arm, whose loose files were gzipped
const brotliDecompressAsync = promisify(brotliDecompress), gzipAsync = promisify(gzipCallback);
const gzippedParts = createEncodedFileCache({ maxBytes: 512 * 1024 * 1024, maxFileBytes: 64 * 1024 * 1024,
  encode: async file => gzipAsync(await brotliDecompressAsync(await readFileAsync(file))) });

/** An explicitly refused encoding must not be selected through the wildcard. */
function encodingQuality(header, encoding) {
  let wildcard = 0;
  for (const entry of header.split(',')) {
    const [name, ...parameters] = entry.trim().toLowerCase().split(';');
    const value = parameters.map(part => part.trim()).find(part => part.startsWith('q='));
    const quality = value === undefined ? 1 : Number(value.slice(2));
    const weight = Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0;
    if (name === encoding) return weight;
    if (name === '*') wildcard = weight;
  }
  return wildcard;
}

function varyEncoding(res) {
  const previous = res.getHeader('Vary');
  const fields = previous === undefined ? [] : String(previous).split(',').map(value => value.trim());
  if (!fields.some(field => field === '*' || field.toLowerCase() === 'accept-encoding')) fields.push('Accept-Encoding');
  res.setHeader('Vary', fields.join(', '));
}

async function streamEncoded(file, encoder, res) {
  try { await pipeline(createReadStream(file), encoder, res); }
  catch (error) { res.destroy(error instanceof Error ? error : new Error(String(error))); }
}

/** A gzipped part's whole body with its length (a HEAD: its headers alone); a part that will not decode is a 500, as the
 *  identity path's is, for a HEAD too (sp-x2's review: a HEAD left the encode's rejection unhandled). */
async function sendGzippedPart(gzipped, res, head) {
  let body;
  try { body = await gzipped; } catch { res.removeHeader('Content-Encoding'); res.statusCode = 500; res.end(); return; }
  if (res.destroyed) return;
  res.setHeader('Content-Length', String(body.length)); res.end(head ? undefined : body);
}
async function sendEncoded(encoded, res) {
  try {
    const bytes = await encoded;
    if (res.destroyed) return;
    // Preserve the existing chunked transfer and HEAD/header behavior.
    res.write(bytes); res.end();
  } catch (error) { res.destroy(error instanceof Error ? error : new Error(String(error))); }
}

/** a file in the build for a URL path, never outside it (`.html` rewrites as the preview server did) */
function lookup(pathname) {
  const candidates = pathname.endsWith('/') ? [`${pathname}index.html`] : [pathname, ...(extname(pathname) === '' ? [`${pathname}.html`] : [])];
  // PAGE-SIZE PZ4: a split build:game keeps content in dist-content/ beside the page, at the same paths
  for (const dir of [outDir, contentDir]) for (const candidate of candidates) {
    const file = resolve(dir, `.${candidate}`);
    if (file !== dir && !file.startsWith(dir + sep)) continue;
    try { const stat = statSync(file); if (stat.isFile()) return { file, stat }; } catch { /* not there */ }
  }
  return null;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.statusCode = 400; res.end(); return; }
  const worker = pathname === '/sw.js' || pathname.startsWith('/sw-core/');
  // Public files have identical bytes for every Origin. CacheStorage precache keys do not carry the module
  // request's Origin; reflecting it with Vary makes native cache routes miss an already installed entry offline.
  // Keep API and preflight reflection restricted to localhost, independently of public GET/HEAD responses.
  const origin = req.headers.origin;
  const publicRead = (req.method === 'GET' || req.method === 'HEAD') && !pathname.startsWith('/api/');
  if (worker || publicRead) res.setHeader('Access-Control-Allow-Origin', '*');
  else if (origin !== undefined && LOCAL_ORIGIN.test(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  for (const rule of rules) if (rule.re.test(pathname)) for (const header of rule.headers) res.setHeader(header.key, header.value);
  if (pathname === '/api/telemetry') { void receiveTelemetry(req, res); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.end(); return; }

  const acceptEncoding = req.headers['accept-encoding'] ?? '';
  // DL15: a spawn part is its q11 Brotli body (see below); a missing one is a 404, never the page's fallback.
  const part = /^\/assets\/spawn\/(?:parts|server)\/[a-f0-9]{16}\.pack\.br$/u.test(pathname);
  let found = lookup(pathname);
  if (found === null && part) { res.removeHeader('Content-Encoding'); res.statusCode = 404; res.end(); return; }
  if (found === null) {
    const accept = req.headers.accept;
    // the preview server's SPA fallback: index.html for a missing path a page or a fetch (`*/*`) asks for
    if (accept === undefined || accept === '' || accept.includes('text/html') || accept.includes('*/*')) found = lookup('/index.html');
    if (found === null) { res.statusCode = 404; res.end(); return; }
  }
  const { file, stat } = found, etag = `W/"${stat.size}-${stat.mtime.getTime()}"`;
  res.setHeader('Content-Type', type(file)); res.setHeader('Last-Modified', stat.mtime.toUTCString()); res.setHeader('ETag', etag);
  res.setHeader('Accept-Ranges', 'bytes');
  const compressible = COMPRESSIBLE.test(type(file)) && stat.size >= 1024;
  if (compressible) varyEncoding(res);
  if (req.headers['if-none-match'] === etag) { res.statusCode = 304; res.end(); return; }
  // Production (vercel.json) sends a part as-is with Content-Encoding: br. A client that refuses br (http Safari)
  // gets the decoded body without that header (the replayed rule set it), so local runs never see raw Brotli bytes.
  if (part) {
    varyEncoding(res);
    const accepted = encodingQuality(acceptEncoding, 'br') > 0;
    if (!accepted && encodingQuality(acceptEncoding, 'gzip') > 0) {
      const gzipped = gzippedParts.get(file, etag, stat.size, 'gzip');
      if (gzipped !== undefined) {
        res.setHeader('Content-Encoding', 'gzip');
        void sendGzippedPart(gzipped, res, req.method === 'HEAD');
        return;
      }
    }
    const encoded = readFileSync(file);
    let body = encoded;
    if (accepted) res.setHeader('Content-Encoding', 'br');
    else {
      res.removeHeader('Content-Encoding');
      try { body = brotliDecompressSync(encoded); } catch { res.statusCode = 500; res.end(); return; }
    }
    res.setHeader('Content-Length', String(body.length));
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  const range = /^bytes=(\d*)-(\d*)$/u.exec(req.headers.range ?? '');
  if (range !== null && (range[1] !== '' || range[2] !== '')) {
    const start = range[1] === '' ? Math.max(0, stat.size - Number(range[2])) : Number(range[1]);
    const end = range[1] === '' || range[2] === '' ? stat.size - 1 : Math.min(Number(range[2]), stat.size - 1);
    if (start > end || start >= stat.size) { res.statusCode = 416; res.setHeader('Content-Range', `bytes */${stat.size}`); res.end(); return; }
    res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`); res.setHeader('Content-Length', String(end - start + 1));
    if (req.method === 'HEAD') res.end(); else createReadStream(file, { start, end }).pipe(res);
    return;
  }
  const br = encodingQuality(acceptEncoding, 'br'), gzip = encodingQuality(acceptEncoding, 'gzip');
  if (compressible && (br > 0 || gzip > 0)) {
    const encoding = br >= gzip ? 'br' : 'gzip';
    res.setHeader('Content-Encoding', encoding);
    if (encoding === 'br' && file === RAPIER && rapierBr !== null) {
      res.setHeader('Content-Length', String(rapierBr.length));
      res.end(req.method === 'HEAD' ? undefined : rapierBr);
    } else if (req.method === 'HEAD') res.end();
    else {
      const identity = [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
      const encoded = encodedFiles.get(file, identity, stat.size, encoding);
      if (encoded !== undefined) {
        void sendEncoded(encoded, res);
        return;
      }
      const encoder = encoding === 'br' ? createBrotliCompress({ params: {
        [zlib.BROTLI_PARAM_QUALITY]: 3, [zlib.BROTLI_PARAM_SIZE_HINT]: stat.size,
      } }) : createGzip();
      void streamEncoded(file, encoder, res);
    }
    return;
  }
  res.setHeader('Content-Length', String(stat.size));
  if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
});
server.on('error', error => { console.error(`preview-server: ${error.message}`); process.exit(1); });
server.listen(port, host, () => {
  const address = server.address(), bound = typeof address === 'object' && address !== null ? address.port : port;
  console.log(`preview-server: local telemetry records ${telemetryDirectory}`);
  console.log(`  ➜  Local:   http://${host}:${bound}/`);
});
process.on('SIGTERM', () => { server.close(); process.exit(0); });
