// DL10: a served preview seen through the phone link, for the iPhone Simulator. Safari on the Simulator uses the Mac's
// network settings, so a machine-wide throttle (Network Link Conditioner) would slow every lane, the push and CI on this
// shared Mac; this throttles one preview port only. A reverse proxy in front of it: every response body shares ONE
// downlink (scripts/phone-loading/link.ts's bucket, as phone-loading's Chromium link does) and each request waits the
// profile's latency before it is forwarded. Default: phone-loading's `phone` profile (10 Mb/s down, 100 ms).
//   node scripts/phone-loading/shaped-preview.ts --target http://127.0.0.1:<preview port> [--mbps 10] [--latency 100]
// Prints the shaped base URL (a free port on 127.0.0.1); pass it as run.sh --base. Stops on SIGINT / SIGTERM.
import {createServer, request as forward, Agent} from 'node:http';
import {pipeline} from 'node:stream';
import {pipeline as flow} from 'node:stream/promises';
import {setTimeout as sleep} from 'node:timers/promises';
import {parseArgs} from 'node:util';
import {bucket, shaped} from './link.ts';

const {values} = parseArgs({options: {target: {type: 'string'}, mbps: {type: 'string', default: '10'}, latency: {type: 'string', default: '100'}}});
const target = new URL(values.target ?? ''), bytesPerSecond = Number(values.mbps) * 1_000_000 / 8, latency = Number(values.latency);
if (!(bytesPerSecond > 0) || !(latency >= 0) || target.protocol !== 'http:') throw new Error('usage: shaped-preview.ts --target http://127.0.0.1:<port> [--mbps 10] [--latency 100]');
const link = bucket(bytesPerSecond), agent = new Agent({keepAlive: true});
const server = createServer((request, response) => {
  void (async () => {
    await sleep(latency);
    const upstream = forward({agent, host: target.hostname, port: target.port, method: request.method, path: request.url,
      headers: {...request.headers, host: target.host}}, answer => {
      response.writeHead(answer.statusCode ?? 502, answer.headers);
      flow(answer, shaped(link), response).catch(() => { response.destroy(); });
    });
    upstream.once('error', () => { if (!response.headersSent) response.writeHead(502).end(); else response.destroy(); });
    pipeline(request, upstream, () => undefined);
  })();
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  console.log(`http://127.0.0.1:${address.port}`);
});
const stop = (): void => { server.close(); agent.destroy(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
