import { describe, expect, test } from 'vitest';
import { askForLink, deleteMine, doorOf, exportMine, heldTicket, linkIn, redeemLink, refreshTicket, sendLink, signedIn, signOut, spendLink, ticketed, type LoginPorts } from './playerLogin';

// MMO-PLAN MP2.2e1: the page's sign-in client against a stand-in for api-server's player routes.
const DEVICE = 'device:0b6f1a52-7f4e-4d7a-9a1c-3c2b1d0e9f87', NOW = 1_800_000_000_000, API = 'https://api.test';
const ticketOf = (device: string, expiresS: number): string => `ticket:${'a'.repeat(32)}.${device}.${String(expiresS)}.${'b'.repeat(128)}`;

interface Asked { readonly url: string; readonly body: unknown; readonly authorization: string | undefined }
function rig(answers: Record<string, (body: Record<string, unknown>) => Response>): LoginPorts & { readonly asked: Asked[]; readonly held: Map<string, string> } {
  const held = new Map<string, string>(), asked: Asked[] = [];
  return {
    api: API, now: () => NOW, held, asked,
    storage: { getItem: key => held.get(key) ?? null, setItem: (key, value) => { held.set(key, value); }, removeItem: key => { held.delete(key); } },
    fetch: (input, init) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input, body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>;
      asked.push({ url, body, authorization: (init?.headers as Record<string, string> | undefined)?.['authorization'] });
      const route = answers[url.slice(API.length)];
      return Promise.resolve(route === undefined ? new Response('', { status: 404 }) : route(body));
    },
  };
}
const ok = (body: unknown, status = 200): Response => Response.json(body, { status });
const signedInRig = (ticket: (body: Record<string, unknown>) => Response): ReturnType<typeof rig> =>
  rig({ '/api/login/email/redeem': () => ok({ session: 'wss_s', player: { id: 'plr_x', email: 'a@b.co' } }), '/api/players/ticket': ticket });

describe('FM8b: sign-in that can\'t finish says why, from the status the page got', () => {
  test('mode 29: a server error from the API is down, with its status; mail off, a refusal or no answer is not', async () => {
    for (const status of [500, 502, 503, 504]) {
      expect(await askForLink(rig({ '/api/login/email': () => new Response('', { status }) }), 'a@b.co', 'g'), String(status)).toEqual({ said: 'down', status });
    }
    expect(await askForLink(rig({ '/api/login/email': () => ok({ error: 'sign-in mail is off' }, 503) }), 'a@b.co', 'g')).toEqual({ said: 'off' });
    expect(await askForLink(rig({ '/api/login/email': () => new Response('', { status: 501 }) }), 'a@b.co', 'g'), 'not a status the API fails with').toEqual({ said: 'failed' });
    const offline: LoginPorts = { ...rig({}), fetch: () => Promise.reject(new TypeError('offline')) };
    expect(await askForLink(offline, 'a@b.co', 'g'), 'no answer says nothing of the API').toEqual({ said: 'failed' });
  });

  test('modes 28 and 29: a spent link is refused, a server error is down with its status, and neither signs the page in', async () => {
    const refused = rig({ '/api/login/email/redeem': () => ok({ error: 'link not valid' }, 401) });
    expect(await spendLink(refused, 'wsl_abcdefgh12345678')).toEqual({ kind: 'refused' });
    expect(signedIn(refused)).toBeUndefined();
    const down = rig({ '/api/login/email/redeem': () => new Response('', { status: 502 }) });
    expect(await spendLink(down, 'wsl_abcdefgh12345678')).toEqual({ kind: 'down', status: 502 });
    expect(signedIn(down)).toBeUndefined();
    const offline: LoginPorts = { ...rig({}), fetch: () => Promise.reject(new TypeError('offline')) };
    expect(await spendLink(offline, 'wsl_abcdefgh12345678')).toEqual({ kind: 'failed' });
    expect(await spendLink(signedInRig(() => ok({})), 'wsl_abcdefgh12345678')).toEqual({ kind: 'in', who: { session: 'wss_s', email: 'a@b.co' } });
  });

  test('mode 27: only the API\'s 401 ends the session and is heard; no answer or a server error ends nothing', async () => {
    let answer = (): Response => new Response('', { status: 503 });
    const ended: string[] = [], ports = { ...signedInRig(() => answer()), ended: () => { ended.push('ended'); } };
    await redeemLink(ports, 'wsl_abcdefgh12345678');
    expect(await refreshTicket(ports, DEVICE)).toBeUndefined();
    expect(signedIn(ports), 'a 503 keeps the session').toBeDefined();
    answer = () => { throw new TypeError('offline'); };
    expect(await refreshTicket(ports, DEVICE)).toBeUndefined();
    expect(signedIn(ports), 'no answer keeps it').toBeDefined();
    expect(ended, 'nothing heard yet').toEqual([]);
    answer = () => new Response('', { status: 401 });
    expect(await refreshTicket(ports, DEVICE)).toBeUndefined();
    expect(signedIn(ports), 'the 401 signs out').toBeUndefined();
    expect(ended, 'and is heard once').toEqual(['ended']);
    expect(await refreshTicket(ports, DEVICE), 'signed out: nothing is asked').toBeUndefined();
    expect(ended).toEqual(['ended']);
  });
});

describe('player sign-in on the page', () => {
  test('a link is asked for, and a mailed link redeemed signs the page in', async () => {
    const ports = rig({ '/api/login/email': () => new Response('', { status: 202 }) });
    expect(await sendLink(ports, 'a@b.co', 'https://play.wildshard.io')).toBe('sent');
    expect(ports.asked[0]?.body, 'the address and the page to come back to').toEqual({ email: 'a@b.co', game: 'https://play.wildshard.io' });
    expect(linkIn('#login=wsl_abcdefgh12345678')).toBe('wsl_abcdefgh12345678');
    expect(linkIn('#zone=driftwood&login=wsl_abcdefgh12345678')).toBe('wsl_abcdefgh12345678');
    expect(linkIn('#zone=driftwood')).toBeUndefined();
    const again = signedInRig(() => ok({}));
    expect(await redeemLink(again, 'wsl_abcdefgh12345678')).toEqual({ session: 'wss_s', email: 'a@b.co' });
    expect(signedIn(again), 'the session is kept').toEqual({ session: 'wss_s', email: 'a@b.co' });
  });

  test('a refused link, too many asks or mail off say so', async () => {
    for (const [status, said] of [[429, 'busy'], [400, 'failed']] as const) {
      expect(await sendLink(rig({ '/api/login/email': () => new Response('', { status }) }), 'a@b.co', 'g')).toBe(said);
    }
    // api-server's own 503 for a deployment with no mailer (player-login.ts) says so in its body
    expect(await sendLink(rig({ '/api/login/email': () => ok({ error: 'sign-in mail is off' }, 503) }), 'a@b.co', 'g')).toBe('off');
    const ports = rig({ '/api/login/email/redeem': () => new Response('', { status: 401 }) });
    expect(await redeemLink(ports, 'wsl_abcdefgh12345678')).toBeUndefined();
    expect(signedIn(ports)).toBeUndefined();
  });

  test('the identity sends a live ticket for this device, and the device id without one', async () => {
    const live = ticketOf(DEVICE, NOW / 1000 + 3600);
    const ports = signedInRig(body => ok({ ticket: body['device'] === DEVICE ? live : ticketOf('device:other', NOW / 1000 + 3600), expiresAt: '' }));
    const identity = ticketed(ports, { player: DEVICE, name: 'Ann' });
    expect(identity.player, 'a guest: the device').toBe(DEVICE);
    await redeemLink(ports, 'wsl_abcdefgh12345678');
    expect(identity.player, 'signed in, no ticket yet: the device').toBe(DEVICE);
    expect(await refreshTicket(ports, DEVICE)).toBe(live);
    expect(ports.asked.at(-1)?.authorization, 'the session asks').toBe('Bearer wss_s');
    expect(identity.player, 'read at each hello: now the ticket').toBe(live);
    expect(identity.name).toBe('Ann');
    expect(heldTicket(ports, 'device:other'), 'never another device\'s').toBeUndefined();
    signOut(ports);
    expect(identity.player, 'signed out: the device again').toBe(DEVICE);
  });

  test('a ticket near its end is not sent; a refused session signs the page out', async () => {
    const ports = signedInRig(() => ok({ ticket: ticketOf(DEVICE, NOW / 1000 + 60), expiresAt: '' }));
    await redeemLink(ports, 'wsl_abcdefgh12345678');
    await refreshTicket(ports, DEVICE);
    expect(heldTicket(ports, DEVICE), 'a minute left is too little for a join').toBeUndefined();
    const refused = signedInRig(() => new Response('', { status: 401 }));
    await redeemLink(refused, 'wsl_abcdefgh12345678');
    expect(await refreshTicket(refused, DEVICE)).toBeUndefined();
    expect(signedIn(refused), 'a 401 signs out').toBeUndefined();
  });
});

// MMO-PLAN MP2.5c: a signed-in page takes its data away, or deletes it: the door's saves (with a join ticket) and the API's account
// (with the session). Delete asks the door first, so a player still in the world keeps everything, then the API, then signs out.
describe('a player\'s own data', () => {
  const DOOR = 'https://rooms.test', live = `confirm:${'a'.repeat(32)}.${String(NOW / 1000 + 300)}.${'b'.repeat(128)}`;
  interface Heard { readonly url: string; readonly authorization: string | undefined; readonly method: string | undefined }
  function account(answers: Record<string, () => Response>): LoginPorts & { readonly heard: Heard[] } {
    const held = new Map<string, string>([['wildshard.player.session', JSON.stringify({ session: 'wss_s', email: 'a@b.co' })]]), heard: Heard[] = [];
    return {
      api: API, now: () => NOW, heard,
      storage: { getItem: key => held.get(key) ?? null, setItem: (key, value) => { held.set(key, value); }, removeItem: key => { held.delete(key); } },
      fetch: (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        heard.push({ url, authorization: (init?.headers as Record<string, string> | undefined)?.['authorization'], method: init?.method });
        const route = answers[url] ?? (url.endsWith('/api/players/me/confirm') ? (): Response => ok({ ticket: live, expiresAt: '' }) : undefined);
        return Promise.resolve(route === undefined ? new Response('', { status: 404 }) : route());
      },
    };
  }

  test('doorOf: the rooms socket\'s own host, over https', () => {
    expect(doorOf('wss://rooms-staging.wildshard.io/')).toBe('https://rooms-staging.wildshard.io');
    expect(doorOf('ws://127.0.0.1:8790')).toBe('http://127.0.0.1:8790');
    expect(doorOf('nonsense')).toBeUndefined();
  });

  test('export: both halves in one file, the door asked with a session-bound confirm and the API with the session', async () => {
    const ports = account({ [`${DOOR}/account/export`]: () => ok({ player: { id: 'account:plr_x' } }), [`${API}/api/players/me/export`]: () => ok({ player: { email: 'a@b.co' } }) });
    expect(await exportMine(ports, DOOR)).toEqual({ api: { player: { email: 'a@b.co' } }, game: { player: { id: 'account:plr_x' } } });
    expect(ports.heard.find(row => row.url === `${DOOR}/account/export`)?.authorization).toBe(`Ticket ${live}`);
    expect(ports.heard.find(row => row.url === `${API}/api/players/me/export`)?.authorization).toBe('Bearer wss_s');
    expect(ports.heard.find(row => row.url === `${API}/api/players/me/confirm`)?.authorization, 'MP2.5e: the confirm is the session\'s').toBe('Bearer wss_s');
    expect(ports.heard.some(row => row.url.endsWith('/api/players/ticket')), 'MP2.5e: no join ticket goes to the door').toBe(false);
    const unconfirmed = account({ [`${API}/api/players/me/export`]: () => ok({ player: {} }), [`${API}/api/players/me/confirm`]: () => new Response('', { status: 503 }), [`${DOOR}/account/export`]: () => ok({}) });
    expect(await exportMine(unconfirmed, DOOR), 'MP2.5e: no confirm, no door asked').toBeUndefined();
    expect(unconfirmed.heard.some(row => row.url.startsWith(DOOR))).toBe(false);
    const nothing = account({ [`${API}/api/players/me/export`]: () => ok({ player: {} }), [`${DOOR}/account/export`]: () => Response.json({ error: 'nothing saved' }, { status: 404 }) });
    expect(await exportMine(nothing, DOOR), 'nothing saved on the server yet').toEqual({ api: { player: {} }, game: null });
    expect(await exportMine(account({}), DOOR), 'the API refused: no file').toBeUndefined();
    const doorDown = account({ [`${API}/api/players/me/export`]: () => ok({ player: {} }), [`${DOOR}/account/export`]: () => new Response('', { status: 503 }) });
    expect(await exportMine(doorDown, DOOR), 'review S1: a door that failed gives no file missing the saves').toBeUndefined();
    const oldDoor = account({ [`${API}/api/players/me/export`]: () => ok({ player: {} }), [`${DOOR}/account/export`]: () => new Response('404 Not Found', { status: 404 }) });
    expect(await exportMine(oldDoor, DOOR), 'review 2: a door without the routes is not "nothing saved"').toBeUndefined();
  });

  test('delete: the door, then the API, then the page signs out; a player in the world is told to leave first', async () => {
    const order: string[] = [];
    const ports = account({ [`${DOOR}/account/delete`]: () => { order.push('door'); return ok({ deleted: true }); }, [`${API}/api/players/me/delete`]: () => { order.push('api'); return ok({ deleted: true }); } });
    expect(await deleteMine(ports, DOOR)).toBe('deleted');
    expect(order).toEqual(['door', 'api']);
    expect(signedIn(ports), 'signed out').toBeUndefined();
    const playing = account({ [`${DOOR}/account/delete`]: () => new Response('', { status: 409 }), [`${API}/api/players/me/delete`]: () => ok({ deleted: true }) });
    expect(await deleteMine(playing, DOOR)).toBe('playing');
    expect(playing.heard.some(row => row.url.endsWith('/api/players/me/delete')), 'the API is never asked').toBe(false);
    expect(signedIn(playing), 'still signed in').toBeDefined();
    const down = account({ [`${API}/api/players/me/delete`]: () => ok({ deleted: true }) });
    expect(await deleteMine(down, DOOR), 'a door that fails stops it').toBe('failed');
    const half = account({ [`${DOOR}/account/delete`]: () => ok({ deleted: true }), [`${API}/api/players/me/delete`]: () => new Response('', { status: 503 }) });
    expect(await deleteMine(half, DOOR), 'review S4: saves gone, the account not yet').toBe('saves-gone');
    expect(signedIn(half), 'still signed in, to try again').toBeDefined();
    const solo = account({ [`${API}/api/players/me/delete`]: () => ok({ deleted: true }) });
    expect(await deleteMine(solo, undefined), 'a build with no world deletes the account only').toBe('deleted');
  });
});
