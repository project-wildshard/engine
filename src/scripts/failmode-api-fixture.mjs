// FM8b (meta docs/plans/MMO-FAILURE-MODES-PLAN.md, modes 27 to 29): an owned stand-in for api-server's player sign-in routes, on
// loopback, behind the failure proof's chaos proxy (its `api` route). It answers exactly as api-server's routes do (api-server
// `src/server/routes/player-login.ts`, `player-ticket.ts`), so the page's real sign-in client (`net/playerLogin.ts`) and the door's real
// ticket check (`server/host/dedicated/ticket.ts`) are what the proof drives; only the provider is ours:
//   POST /api/login/email {email, game}         202 {sent: true}; the link `<game>/#login=wsl_…` goes to this fixture's outbox
//   POST /api/login/email/redeem {token}        200 {session: 'wss_…', player: {id, email}}; a spent or unknown link 401
//   POST /api/players/ticket {device} + Bearer  200 {ticket, expiresAt} (an hour, Ed25519 over everything before the last dot); no
//                                               session or an ended one 401; a device id that isn't one 400
// `expireSessions()` ends every open session (api-server's 30 days running out, or a deletion elsewhere): the next ticket ask is a
// 401, the provider's own verdict. Any other `/api/` path answers 503 as the proxy does with no API behind it, so the proof's other
// cases see what they always saw. The ticket key is made per run and lives only in this process and the rig door's environment.
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createServer } from 'node:http';

const TICKET_MS = 3_600_000, MAX_BODY = 16_384;
const DEVICE = /^device:[A-Za-z0-9-]{1,64}$/u;
const token = (/** @type {string} */ prefix) => `${prefix}${randomBytes(32).toString('hex')}`;

/**
 * @param {{ port: number }} options
 * @returns {Promise<{ origin: string, publicKey: string, outbox: { email: string, link: string }[], counts: Record<string, number>,
 *   playerOf: (email: string) => string | undefined, expireSessions: () => number, close: () => Promise<void> }>}
 */
export async function openApiFixture({ port }) {
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  /** @type {Map<string, string>} link token -> email */
  const links = new Map();
  /** @type {Map<string, { player: string, email: string, live: boolean }>} */
  const sessions = new Map();
  /** @type {Map<string, string>} email -> 32 hex player id */
  const players = new Map();
  /** @type {{ email: string, link: string }[]} */
  const outbox = [];
  const counts = { sent: 0, redeemed: 0, linkRefused: 0, tickets: 0, ticketRefused: 0, other: 0 };

  /** @param {import('node:http').ServerResponse} response @param {number} status @param {unknown} [body] */
  const answer = (response, status, body) => {
    const text = body === undefined ? '' : JSON.stringify(body);
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(text);
  };
  /** @param {import('node:http').IncomingMessage} request @returns {Promise<Record<string, unknown> | undefined>} */
  const bodyOf = request => new Promise(resolve => {
    /** @type {Buffer[]} */
    const parts = [];
    let size = 0;
    request.on('data', chunk => { size += chunk.length; if (size <= MAX_BODY) parts.push(chunk); });
    request.on('end', () => {
      /** @type {unknown} */
      let value;
      try { value = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { value = undefined; }
      resolve(size <= MAX_BODY && typeof value === 'object' && value !== null ? /** @type {Record<string, unknown>} */ (value) : undefined);
    });
    request.on('error', () => { resolve(undefined); });
  });

  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', 'http://fixture').pathname;
      if (request.method !== 'POST') { counts.other++; answer(response, 503, { error: 'not this fixture\'s route' }); return; }
      if (path === '/api/login/email') {
        const body = await bodyOf(request), email = body?.email, game = body?.game;
        if (typeof email !== 'string' || !email.includes('@') || typeof game !== 'string') { answer(response, 400, { error: 'bad email' }); return; }
        const link = token('wsl_');
        links.set(link, email); outbox.push({ email, link: `${game}/#login=${link}` }); counts.sent++;
        answer(response, 202, { sent: true });
      } else if (path === '/api/login/email/redeem') {
        const body = await bodyOf(request), link = body?.token, email = typeof link === 'string' ? links.get(link) : undefined;
        if (typeof link !== 'string' || email === undefined) { counts.linkRefused++; answer(response, 401, { error: 'link not valid' }); return; }
        links.delete(link);
        const player = players.get(email) ?? randomBytes(16).toString('hex');
        players.set(email, player);
        const session = token('wss_');
        sessions.set(session, { player, email, live: true }); counts.redeemed++;
        answer(response, 200, { session, player: { id: `plr_${player}`, email } });
      } else if (path === '/api/players/ticket') {
        const bearer = /^Bearer (wss_[A-Za-z0-9_-]{1,64})$/u.exec(request.headers.authorization ?? '')?.[1];
        const held = bearer === undefined ? undefined : sessions.get(bearer);
        const body = await bodyOf(request), device = body?.device;
        if (held?.live !== true) { counts.ticketRefused++; answer(response, 401, { error: 'not signed in' }); return; }
        if (typeof device !== 'string' || !DEVICE.test(device)) { answer(response, 400, { error: 'bad device' }); return; }
        const expiresAt = new Date(Date.now() + TICKET_MS), signed = `ticket:${held.player}.${device}.${String(Math.floor(expiresAt.getTime() / 1000))}`;
        counts.tickets++;
        answer(response, 200, { ticket: `${signed}.${sign(null, Buffer.from(signed), pair.privateKey).toString('hex')}`, expiresAt: expiresAt.toISOString() });
      } else { counts.other++; answer(response, 503, { error: 'not this fixture\'s route' }); }
    })().catch(() => { if (!response.headersSent) answer(response, 500); });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { resolve(undefined); }); });
  return {
    origin: `http://127.0.0.1:${String(port)}`, publicKey, outbox, counts,
    playerOf: email => players.get(email),
    expireSessions: () => { let ended = 0; for (const held of sessions.values()) if (held.live) { held.live = false; ended++; } return ended; },
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(() => { resolve(); }); }),
  };
}
