// oxlint-disable-next-line import/no-nodejs-modules -- A loopback server stands in for Sentry's ingest.
import { createServer, type IncomingMessage, type Server } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { once } from 'node:events';
import { afterEach, expect, test } from 'vitest';
import { ServerReports } from '../src/server/host/dedicated/serverReports';
import { FLUSH_MS, sendSentryTest, serverSentry, serverSentryRelease } from '../src/server/host/dedicated/serverSentry';

// SENTRY-TRIAGE S8: the server's errors reach Sentry with the client's release name and the channel as environment, carry
// no request or host, and a Sentry that is away or slow never holds the server past FLUSH_MS.
interface Ingest { readonly dsn: string; readonly envelopes: string[]; readonly server: Server }
let open: Server[] = [];
afterEach(async () => { await Promise.all(open.map(async server => { server.closeAllConnections(); server.close(); await once(server, 'close'); })); open = []; });

async function ingest(answer: (request: IncomingMessage) => number | 'hang' = () => 200): Promise<Ingest> {
  const envelopes: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => { chunks.push(chunk); });
    request.on('end', () => {
      envelopes.push(Buffer.concat(chunks).toString('utf8'));
      const status = answer(request);
      if (status !== 'hang') response.writeHead(status).end('{}');
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); open.push(server);
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return { dsn: `http://publickey@127.0.0.1:${String(address.port)}/7`, envelopes, server };
}
const event = (envelope: string): Record<string, unknown> => JSON.parse(envelope.split('\n')[2] ?? '{}') as Record<string, unknown>;

test('no DSN, no Sentry: a blank env row is unset', () => {
  expect(serverSentry({ dsn: undefined, version: '0.1.7', build: 'b1', channel: 'staging' })).toBeUndefined();
  expect(serverSentry({ dsn: '  ', version: '0.1.7', build: 'b1', channel: 'staging' })).toBeUndefined();
  expect(serverSentryRelease('0.1.7')).toBe('wildshard@0.1.7');
  expect(serverSentryRelease(undefined)).toBeUndefined();
});

test('a server error lands with the release, the channel and the build, and nothing about the host or a player', async () => {
  const sentry = await ingest(), build = 'a'.repeat(40);
  const client = serverSentry({ dsn: sentry.dsn, version: '0.1.7', build, channel: 'staging' });
  const reports = new ServerReports({ build, channel: 'staging', telemetryUrl: undefined, errorsUrl: undefined, tag: undefined, log: () => {}, sentry: client });
  reports.error(new Error('the door fell over', { cause: new Error('a worker exited') }));
  await reports.settled();
  reports.dispose();
  expect(sentry.envelopes).toHaveLength(1);
  const sent = event(sentry.envelopes[0] ?? '');
  expect(sent).toMatchObject({ release: 'wildshard@0.1.7', environment: 'staging', dist: build, platform: 'node', tags: { system: 'server', fatal: true, build } });
  const values = (sent['exception'] as { values: { value: string }[] }).values.map(value => value.value);
  expect(values, 'the cause rides along').toEqual(['a worker exited', 'the door fell over']);
  for (const key of ['request', 'user', 'server_name', 'breadcrumbs']) expect(sent, key).not.toHaveProperty(key);
});

test('a Sentry that refuses or hangs costs a capture nothing and an ending process at most FLUSH_MS', async () => {
  const refusing = await ingest(() => 500);
  const refused = serverSentry({ dsn: refusing.dsn, version: '0.1.7', build: 'b1', channel: 'production' });
  expect(() => { refused?.capture('a string, not an Error', { system: 'server', fatal: true }); }).not.toThrow();
  await refused?.flush();
  expect(refusing.envelopes).toHaveLength(1);

  const hanging = await ingest(() => 'hang');
  const slow = serverSentry({ dsn: hanging.dsn, version: '0.1.7', build: 'b1', channel: 'production' });
  const started = performance.now();
  slow?.capture(new Error('nobody hears this'), { system: 'server', fatal: true });
  await slow?.flush();
  expect(performance.now() - started, 'one deadline for the whole flush').toBeLessThan(FLUSH_MS + 500);
}, 10_000);

test('a capture only queues: the SDK and the send run on a later turn, and a flood past the queue is dropped', async () => {
  const sentry = await ingest();
  let sends = 0;
  const counted: typeof fetch = async (input, init) => { sends += 1; return fetch(input, init); };
  const client = serverSentry({ dsn: sentry.dsn, version: '0.1.7', build: 'b1', channel: 'staging', fetch: counted });
  for (let index = 0; index < 40; index += 1) client?.capture(new Error(`flood ${String(index)}`), { system: 'server', fatal: true });
  expect(sends, 'nothing ran in the caller\'s turn').toBe(0);
  await client?.flush();
  expect(sentry.envelopes).toHaveLength(32);
});

test('a thrown plain object keeps its fields out of the event', async () => {
  const sentry = await ingest();
  const client = serverSentry({ dsn: sentry.dsn, version: '0.1.7', build: 'b1', channel: 'staging' });
  client?.capture({ user: { email: 'someone@example.com' }, request: { url: 'https://x' }, server_name: 'box' }, { system: 'server', fatal: true });
  await client?.flush();
  expect(sentry.envelopes).toHaveLength(1);
  expect(sentry.envelopes[0]).not.toContain('someone@example.com');
  expect(event(sentry.envelopes[0] ?? '')).not.toHaveProperty('extra');
});

test('the --sentry-test check sends one event on staging and refuses every other channel', async () => {
  const sentry = await ingest(), lines: Record<string, unknown>[] = [];
  const run = (env: Record<string, string | undefined>): Promise<number> => sendSentryTest({ env, build: 'b1', version: '0.1.7', log: line => { lines.push(line); } });
  expect(await run({ RELEASE_CHANNEL: 'production', SENTRY_DSN: sentry.dsn })).toBe(2);
  expect(await run({ SENTRY_DSN: sentry.dsn }), 'the unit default is production').toBe(2);
  expect(await run({ RELEASE_CHANNEL: 'staging', SENTRY_DSN: '' })).toBe(1);
  expect(sentry.envelopes).toHaveLength(0);
  expect(await run({ RELEASE_CHANNEL: 'staging', SENTRY_DSN: sentry.dsn })).toBe(0);
  expect(sentry.envelopes).toHaveLength(1);
  expect(event(sentry.envelopes[0] ?? '')).toMatchObject({ environment: 'staging', release: 'wildshard@0.1.7', tags: { system: 'sentry-test' } });
  expect(lines.at(-1)).toMatchObject({ at: 'sentry.test.sent', statuses: [200] });
});
