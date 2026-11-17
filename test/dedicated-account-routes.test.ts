import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, expect, test } from 'vitest';
import { accountRoutes, type AccountRoutes } from '../src/server/host/dedicated/accountRoutes';

// MMO-PLAN MP2.5a: a signed-in page asks the door for its saves (export) or to delete them, with a live join ticket as its proof
// (the same ticket the hello sends, checked offline against the pinned key). A guest, a dead ticket or another site's page gets
// nothing; an account still in the world can't be deleted from under its body.
const PLAYER = 'plr_0123456789abcdef0123456789abcdef', ACCOUNT = `account:${PLAYER}`, GAME = 'https://staging.wildshard.io';
let server: Server | undefined;
afterEach(async () => { await new Promise(resolve => { server?.close(resolve); if (server === undefined) resolve(undefined); }); server = undefined; });

function keys(): { privateKey: KeyObject; spkiHex: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, spkiHex: publicKey.export({ type: 'spki', format: 'der' }).toString('hex') };
}
function ticket(key: KeyObject, expires = Math.floor(Date.now() / 1000) + 600): string {
  const signed = `ticket:${PLAYER.slice(4)}.device:phone.${String(expires)}`;
  return `${signed}.${sign(null, Buffer.from(signed), key).toString('hex')}`;
}
async function serve(options: Partial<AccountRoutes> & Pick<AccountRoutes, 'ticketKey'>): Promise<{ url: string; calls: string[] }> {
  const calls: string[] = [];
  const routes = accountRoutes({
    allowedOrigins: [GAME], playing: () => false, log: () => undefined,
    exportAccount: account => { calls.push(`export ${account}`); return Promise.resolve({ player: { id: account }, saves: [], receipts: [], places: [] }); },
    deleteAccount: account => { calls.push(`delete ${account}`); return Promise.resolve(true); },
    ...options,
  });
  server = createServer((request, response) => { if (!routes(request, response)) response.writeHead(404).end(); });
  await new Promise<void>(resolve => { server?.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return { url: `http://127.0.0.1:${String(address.port)}`, calls };
}
const ask = (url: string, path: string, init: { ticket?: string; origin?: string; method?: string } = {}): Promise<Response> => fetch(`${url}${path}`, {
  method: init.method ?? 'POST',
  headers: { ...(init.ticket === undefined ? {} : { authorization: `Ticket ${init.ticket}` }), ...(init.origin === undefined ? {} : { origin: init.origin }) },
});

test('a live ticket exports its account\'s data, to the game\'s pages only', async () => {
  const key = keys(), { url, calls } = await serve({ ticketKey: key.spkiHex });
  const got = await ask(url, '/account/export', { ticket: ticket(key.privateKey), origin: GAME });
  expect(got.status).toBe(200);
  expect(got.headers.get('access-control-allow-origin')).toBe(GAME);
  expect(await got.json()).toEqual({ player: { id: ACCOUNT }, saves: [], receipts: [], places: [] });
  const preflight = await ask(url, '/account/delete', { origin: GAME, method: 'OPTIONS' });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get('access-control-allow-headers')).toContain('authorization');
  expect((await ask(url, '/account/export', { ticket: ticket(key.privateKey), origin: 'https://evil.example' })).status, 'another site').toBe(403);
  expect((await ask(url, '/account/export', { ticket: ticket(keys().privateKey), origin: GAME })).status, 'another key').toBe(401);
  expect((await ask(url, '/account/export', { ticket: ticket(key.privateKey, Math.floor(Date.now() / 1000) - 1), origin: GAME })).status, 'expired').toBe(401);
  expect((await ask(url, '/account/export', { origin: GAME })).status, 'no ticket').toBe(401);
  expect((await ask(url, '/account/export', { ticket: 'device:phone', origin: GAME })).status, 'a guest id').toBe(401);
  expect((await ask(url, '/account/export', { ticket: ticket(key.privateKey), origin: GAME, method: 'GET' })).status, 'only POST').toBe(405);
  expect(calls).toEqual([`export ${ACCOUNT}`]);
});

test('delete takes the account away, never while it is in the world', async () => {
  const key = keys();
  let inWorld = true;
  const { url, calls } = await serve({ ticketKey: key.spkiHex, playing: seat => inWorld && seat === ACCOUNT });
  const busy = await ask(url, '/account/delete', { ticket: ticket(key.privateKey), origin: GAME });
  expect(busy.status, 'still playing').toBe(409);
  inWorld = false;
  const done = await ask(url, '/account/delete', { ticket: ticket(key.privateKey), origin: GAME });
  expect(done.status).toBe(200);
  expect(await done.json()).toEqual({ deleted: true });
  expect(calls).toEqual([`delete ${ACCOUNT}`]);
});

test('a database that fails answers 503 and logs no ticket', async () => {
  const key = keys(), lines: string[] = [];
  const { url } = await serve({ ticketKey: key.spkiHex, log: line => { lines.push(JSON.stringify(line)); }, exportAccount: () => Promise.reject(new Error('db down')) });
  const raw = ticket(key.privateKey);
  expect((await ask(url, '/account/export', { ticket: raw, origin: GAME })).status).toBe(503);
  expect(lines.join('\n')).toContain('account.failed');
  expect(lines.join('\n')).not.toContain(raw.slice(-32));
});
