// oxlint-disable-next-line import/no-nodejs-modules -- A local origin and plain proxy client for the owned shared-link fixture.
import {createServer, request as httpRequest, type Server} from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- A raw CONNECT tunnel client, as Chromium sends HTTPS through the link.
import {connect} from 'node:net';
import {afterEach, expect, test} from 'vitest';
import {bucket, startSharedLink, type SharedLink} from '../scripts/phone-loading/link';

const BODY = 200_000, RATE = 1_000_000;
let origin: Server | undefined, link: SharedLink | undefined;
afterEach(async () => {
  await link?.close(); link = undefined;
  await new Promise<void>(resolve => {if (origin === undefined) resolve(); else origin.close(() => {resolve();});}); origin = undefined;
});
async function serve(): Promise<number> {
  origin = createServer((_request, response) => {response.writeHead(200, {'content-length': String(BODY)}).end(Buffer.alloc(BODY, 7));});
  await new Promise<void>(resolve => {origin?.listen(0, '127.0.0.1', () => {resolve();});});
  const address = origin.address();
  if (address === null || typeof address === 'string') throw new Error('No origin port');
  return address.port;
}
/** A page-style request: absolute-form through the proxy. */
function plain(proxy: URL, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    httpRequest({host: proxy.hostname, port: proxy.port, path: `http://127.0.0.1:${port}/plain`, headers: {host: `127.0.0.1:${port}`}}, response => {
      let size = 0; response.on('data', (chunk: Buffer) => {size += chunk.byteLength;}); response.once('end', () => {resolve(size);});
    }).once('error', reject).end();
  });
}
/** A worker-style request over a CONNECT tunnel (how HTTPS travels): body bytes counted after the headers. */
function tunnel(proxy: URL, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect(Number(proxy.port), proxy.hostname, () => {socket.write(`CONNECT 127.0.0.1:${port} HTTP/1.1\r\nhost: 127.0.0.1:${port}\r\n\r\n`);});
    let stage = 0, text = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      text = Buffer.concat([text, chunk]);
      if (stage === 0 && text.includes('\r\n\r\n')) {stage = 1; text = Buffer.alloc(0); socket.write(`GET /tunnel HTTP/1.1\r\nhost: 127.0.0.1:${port}\r\nconnection: close\r\n\r\n`);}
    });
    socket.once('end', () => {const at = text.indexOf('\r\n\r\n'); resolve(at === -1 ? 0 : text.byteLength - at - 4);});
    socket.once('error', reject);
  });
}

test('a page flow and a tunnelled worker flow share one link rate', async () => {
  const port = await serve();
  link = await startSharedLink(RATE);
  const proxy = new URL(link.proxy), started = Date.now();
  const sizes = await Promise.all([plain(proxy, port), tunnel(proxy, port)]);
  const elapsed = Date.now() - started;
  expect(sizes).toEqual([BODY, BODY]);
  // Two bodies on one 1 MB/s link: ~400 ms together (two per-target links would take ~200 ms).
  expect(elapsed).toBeGreaterThanOrEqual(2 * BODY / RATE * 1000 * 0.9);
  expect(link.bytes(started, Date.now())).toBeGreaterThanOrEqual(2 * BODY);
  expect(link.peak(started, Date.now())).toBeLessThanOrEqual(RATE + 16_384);
  expect(link.errors).toEqual([]);
});

test('waiting flows take turns in grain order', async () => {
  const shared = bucket(1_000_000), order: string[] = [];
  await Promise.all([
    (async () => {for (let i = 0; i < 3; i++) {await shared.take(16_384); order.push('a');}})(),
    (async () => {for (let i = 0; i < 3; i++) {await shared.take(16_384); order.push('b');}})(),
  ]);
  expect(order).toEqual(['a', 'b', 'a', 'b', 'a', 'b']);
  expect(shared.granted).toBe(6 * 16_384);
});
