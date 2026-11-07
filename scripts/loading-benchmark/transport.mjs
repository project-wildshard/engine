// Observe served asset bytes unchanged; optional HTML recorder fixtures retain both content hashes.
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { createGunzip, createBrotliDecompress, createInflate } from 'node:zlib';

// Retain only static compiler metadata already in the observed HTML. Missing,
// malformed or oversized facts stay explicit; none changes the served page.
/** @param {string} html */
function moduleInventory(html) {
  const matches = [...html.matchAll(/<script\b[^>]*\sid=["']boot-module-files["'][^>]*>([\s\S]*?)<\/script\s*>/gu)];
  if (matches.length !== 1) return { error: matches.length === 0 ? 'missing' : 'duplicate' };
  const json = matches[0]?.[1] ?? '';
  if (Buffer.byteLength(json) > 1024 * 1024) return { error: 'over 1 MiB' };
  try {
    /** @type {unknown} */
    const value = JSON.parse(json);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return { error: 'not an object' };
  } catch { return { error: 'invalid JSON' }; }
  return { json, sha256: createHash('sha256').update(json).digest('hex') };
}

/** Proof-only streaming count: HTTP content and encoded wire bodies have
 * different units. No application body is retained or consumed a second time. */
export function decodedBodyCounter(encoding) {
  const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'br' ? createBrotliDecompress()
    : encoding === 'deflate' ? createInflate() : null;
  let bytes = 0;
  if (decoder === null) return {
    write: chunk => { bytes += chunk.length; },
    finish: () => Promise.resolve(encoding === undefined || encoding === 'identity' ? bytes : null),
  };
  const result = new Promise(resolve => {
    decoder.on('data', chunk => { bytes += chunk.length; });
    decoder.on('end', () => { resolve(bytes); });
    decoder.on('error', () => { resolve(null); });
  });
  return { write: chunk => { decoder.write(chunk); }, finish: () => { decoder.end(); return result; } };
}

export async function observeTransport(upstream, fixture = {}) {
  const receipts = [], htmlFixtures = [];
  const server = http.createServer((request, response) => {
    // Proof-only offline boundary: fail the wire, retaining the browser's real worker/content caches.
    if (fixture.offline?.() === true) { request.socket.destroy(); return; }
    if (request.url === '/sf67-start.html' && fixture.start !== undefined) {
      response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
      response.end(fixture.start); return;
    }
    const target = new URL(request.url ?? '/', typeof upstream === 'function' ? upstream() : upstream);
    const startedAt = Date.now();
    const transfer = fixture.transfer?.({ url: target.href, startedAt });
    if (target.protocol !== 'http:' && target.protocol !== 'https:') { response.writeHead(502); response.end(); return; }
    const inject = fixture.recorder !== undefined && (target.pathname === '/' || target.pathname === '/index.html');
    const requestHeaders = { ...request.headers, host: target.host };
    if (inject) {
      requestHeaders['accept-encoding'] = 'identity';
      delete requestHeaders['if-none-match']; delete requestHeaders['if-modified-since'];
    }
    const forwarded = (target.protocol === 'https:' ? https : http).request(target, { method: request.method, headers: requestHeaders }, incoming => {
      // Fixed-length replies preserve the upstream wire length; unknown lengths use chunked framing.
      const headers = { ...incoming.headers, connection: 'close' };
      delete headers['keep-alive'];
      const chunks = [];
      if (!inject) response.writeHead(incoming.statusCode ?? 502, headers);
      let body = 0;
      const digest = fixture.bodyHashes ? createHash('sha256') : null;
      const decoded = decodedBodyCounter(incoming.headers['content-encoding']);
      incoming.on('data', chunk => { body += chunk.length; digest?.update(chunk); decoded.write(chunk); if (inject) chunks.push(chunk); else { response.write(chunk); transfer?.(chunk.length, Date.now()); } });
      incoming.on('end', () => {
        if (inject) {
          const original = Buffer.concat(chunks).toString('utf8');
          const patched = original.replace('<head>', `<head><script>${fixture.prelude ?? ''}(${fixture.recorder.toString()})();</script>`);
          htmlFixtures.push({ originalSHA256: createHash('sha256').update(original).digest('hex'),
            injectedSHA256: createHash('sha256').update(patched).digest('hex'), moduleInventory: moduleInventory(original) });
          body = Buffer.byteLength(patched);
          delete headers['transfer-encoding'];
          headers['content-length'] = String(body);
          headers['cache-control'] = 'no-store';
          response.writeHead(incoming.statusCode ?? 502, headers); response.write(patched); transfer?.(body, Date.now());
        }
        response.end();
        const endedAt = Date.now();
        void decoded.finish().then(contentBytes => receipts.push({ url: target.href, status: incoming.statusCode ?? 502, startedAt, endedAt, bodyBytes: body,
          // Wire identity is comparable only with the same encoding. HTML is
          // intentionally injected, so its upstream digest is not a served-body receipt.
          ...(digest !== null && !inject ? { bodySHA256: digest.digest('hex'), bodyEncoding: incoming.headers['content-encoding'] ?? 'identity' } : {}),
          decodedBodyBytes: inject ? body : contentBytes,
          requestCache: { cacheControl: request.headers['cache-control'], ifNoneMatch: request.headers['if-none-match'],
            ifModifiedSince: request.headers['if-modified-since'], acceptEncoding: request.headers['accept-encoding'],
            serviceWorker: request.headers['service-worker'], origin: request.headers.origin,
            destination: request.headers['sec-fetch-dest'], mode: request.headers['sec-fetch-mode'], accept: request.headers.accept },
          responseCache: { etag: incoming.headers.etag, cacheControl: incoming.headers['cache-control'],
            vary: incoming.headers.vary, contentEncoding: incoming.headers['content-encoding'] },
          // Resource Timing's transferSize charges a fixed 300-byte header estimate.
          // Keep the independent observed payload and actual response headers separate.
          headerBytes: Buffer.byteLength(`HTTP/1.1 ${incoming.statusCode} ${incoming.statusMessage}\r\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}\r\n`).join('')}\r\n`) })).catch(() => { response.destroy(); });
      });
      incoming.on('error', () => { response.destroy(); });
    });
    forwarded.on('error', () => { response.writeHead(502); response.end(); });
    request.pipe(forwarded);
  });
  await new Promise(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No observer port');
  return { base: `http://127.0.0.1:${address.port}/`, receipts, htmlFixtures,
    close: () => new Promise(resolve => { server.close(resolve); }) };
}
