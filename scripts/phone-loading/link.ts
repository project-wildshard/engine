import {Agent, createServer, request as httpRequest} from 'node:http';
import {connect, type Socket} from 'node:net';
import {pipeline as flow} from 'node:stream/promises';
import {pipeline} from 'node:stream';

/** One downlink for the whole browser (DL0). CDP's network emulation throttles
 * each target on its own, so the service worker's precache had a second
 * full-rate link beside the page's and never showed in a cold run. Every
 * response body through this proxy, page or worker, plain HTTP or a CONNECT
 * tunnel, waits its turn in one bucket: concurrent flows share the rate in
 * GRAIN-sized turns (processor sharing, as scripts/download-bench/link.mjs
 * models it). Latency stays per request in CDP; upload is not shaped here. */
const GRAIN = 16_384;
export interface Bucket {take: (bytes: number) => Promise<void>; readonly granted: number}
export function bucket(bytesPerSecond: number, now: () => number = () => performance.now(),
  granted: (bytes: number) => void = () => undefined): Bucket {
  const waiting: {bytes: number; resolve: () => void}[] = [];
  let tokens = 0, last = now(), total = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const pump = (): void => {
    timer = undefined;
    const at = now();
    // An idle link banks at most one grain: no burst above the rate.
    tokens = Math.min(tokens + (at - last) * bytesPerSecond / 1000, GRAIN); last = at;
    for (let head = waiting[0]; head !== undefined && tokens >= head.bytes; head = waiting[0]) {
      waiting.shift(); tokens -= head.bytes; total += head.bytes; granted(head.bytes); head.resolve();
    }
    const head = waiting[0];
    if (head !== undefined) timer = setTimeout(pump, Math.max(1, (head.bytes - tokens) * 1000 / bytesPerSecond));
  };
  return {take: bytes => new Promise(resolve => {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > GRAIN) throw new Error(`Link grant must be 0..${GRAIN} bytes: ${bytes}`);
    waiting.push({bytes, resolve}); if (timer === undefined) pump();
  }), get granted() {return total;}};
}
/** A body stream cut into grains, each released only when the link grants it (a pipeline stage). */
export function shaped(link: Bucket): (source: AsyncIterable<Buffer>) => AsyncGenerator<Buffer> {
  return async function* grains(source) {
    for await (const chunk of source) for (let at = 0; at < chunk.byteLength; at += GRAIN) {
      const part = chunk.subarray(at, at + GRAIN);
      await link.take(part.byteLength); yield part;
    }
  };
}
export interface SharedLink {
  /** Chromium's `--proxy-server` value. */
  proxy: string; bytesPerSecond: number; errors: string[];
  /** Transport bytes the link delivered in [from, to] (epoch ms, the run's clock): response bodies on plain HTTP
   * (local previews), everything the server sent on a CONNECT tunnel (HTTPS: TLS records, headers included). */
  bytes: (from: number, to: number) => number;
  /** The most bytes delivered in any one-second window of [from, to]: at most the rate when shared. */
  peak: (from: number, to: number) => number;
  close: () => Promise<void>;
}
export async function startSharedLink(bytesPerSecond: number): Promise<SharedLink> {
  const grants: {at: number; bytes: number}[] = [], errors: string[] = [], sockets = new Set<Socket>();
  const link = bucket(bytesPerSecond, undefined, bytes => {grants.push({at: Date.now(), bytes});});
  const agent = new Agent({keepAlive: true});
  const failed = (where: string) => (error: Error | null | undefined): void => {
    if (error && !/ECONNRESET|EPIPE|ERR_STREAM_PREMATURE_CLOSE|aborted/u.test(String(error))) errors.push(`${where}: ${String(error)}`);
  };
  const server = createServer((request, response) => {
    let target: URL;
    try {target = new URL(request.url ?? '');} catch {response.writeHead(400).end(); return;}
    const headers = {...request.headers}; delete headers['proxy-connection'];
    const upstream = httpRequest({agent, host: target.hostname, port: target.port || 80, method: request.method,
      path: `${target.pathname}${target.search}`, headers}, answer => {
      response.writeHead(answer.statusCode ?? 502, answer.statusMessage, answer.rawHeaders);
      flow(answer, shaped(link), response).catch(failed(`body ${target.pathname}`));
    });
    upstream.once('error', error => {failed(`request ${target.pathname}`)(error); if (!response.headersSent) response.writeHead(502).end(); else response.destroy();});
    pipeline(request, upstream, failed(`upload ${target.pathname}`));
  });
  server.on('connection', (socket: Socket) => {sockets.add(socket); socket.once('close', () => {sockets.delete(socket);});});
  server.on('connect', (request, client: Socket, head: Buffer) => {
    const address = /^\[?([^\]]+)\]?:(\d+)$/u.exec(request.url ?? '');
    if (address === null) {client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return;}
    const [, host = '', port = '443'] = address;
    const upstream = connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.byteLength > 0) upstream.write(head);
      flow(upstream, shaped(link), client).catch(failed(`tunnel ${host}`));
      // Not a pipeline: the origin closing its side must not destroy the client
      // before the shaped tail of the body has been delivered.
      client.pipe(upstream);
    });
    upstream.once('error', error => {failed(`tunnel ${host}`)(error); client.destroy();});
    client.once('error', error => {failed(`tunnel upload ${host}`)(error); upstream.destroy();});
    // A tunnel lives and dies with both ends, and close() ends it: an idle browser tunnel (e.g. Chrome's background
    // push connection) must never keep the run's process alive (sp-x6).
    // (The origin closing ends the client only through the shaped flow, after its tail is delivered.)
    sockets.add(upstream); upstream.once('close', () => {sockets.delete(upstream);});
    client.once('close', () => {upstream.destroy();});
  });
  await new Promise<void>((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', () => {resolve();});});
  const bound = server.address();
  if (bound === null || typeof bound === 'string') throw new Error('Shared link has no port');
  const within = (from: number, to: number) => grants.filter(grant => grant.at >= from && grant.at <= to);
  return {proxy: `http://127.0.0.1:${bound.port}`, bytesPerSecond, errors,
    bytes: (from, to) => within(from, to).reduce((sum, grant) => sum + grant.bytes, 0),
    peak: (from, to) => {
      const rows = within(from, to);
      let best = 0, sum = 0, tail = 0;
      for (const row of rows) {
        sum += row.bytes;
        for (let first = rows[tail]; first !== undefined && first.at <= row.at - 1000; first = rows[tail]) {sum -= first.bytes; tail++;}
        best = Math.max(best, sum);
      }
      return best;
    },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      agent.destroy();
      await new Promise<void>(resolve => {server.close(() => {resolve();});});
    }};
}
