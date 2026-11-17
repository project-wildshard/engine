import { describe, expect, test } from 'vitest';
import { deleteMine, doorOf, exportMine, heldTicket, linkIn, redeemLink, refreshTicket, sendLink, signedIn, signOut, ticketed, type LoginPorts } from './playerLogin';

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
    for (const [status, said] of [[429, 'busy'], [503, 'off'], [400, 'failed']] as const) {
      expect(await sendLink(rig({ '/api/login/email': () => new Response('', { status }) }), 'a@b.co', 'g')).toBe(said);
    }
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
  const DOOR = 'https://rooms.test', live = ticketOf(DEVICE, NOW / 1000 + 3600);
  interface Heard { readonly url: string; readonly authorization: string | undefined; readonly method: string | undefined }
  function account(answers: Record<string, () => Response>): LoginPorts & { readonly heard: Heard[] } {
    const held = new Map<string, string>([['wildshard.player.session', JSON.stringify({ session: 'wss_s', email: 'a@b.co' })]]), heard: Heard[] = [];
    return {
      api: API, now: () => NOW, heard,
      storage: { getItem: key => held.get(key) ?? null, setItem: (key, value) => { held.set(key, value); }, removeItem: key => { held.delete(key); } },
      fetch: (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        heard.push({ url, authorization: (init?.headers as Record<string, string> | undefined)?.['authorization'], method: init?.method });
        const route = answers[url] ?? (url.endsWith('/api/players/ticket') ? (): Response => ok({ ticket: live, expiresAt: '' }) : undefined);
        return Promise.resolve(route === undefined ? new Response('', { status: 404 }) : route());
      },
    };
  }

  test('doorOf: the rooms socket\'s own host, over https', () => {
    expect(doorOf('wss://rooms-staging.wildshard.io/')).toBe('https://rooms-staging.wildshard.io');
    expect(doorOf('ws://127.0.0.1:8790')).toBe('http://127.0.0.1:8790');
    expect(doorOf('nonsense')).toBeUndefined();
  });

  test('export: both halves in one file, the door asked with a join ticket and the API with the session', async () => {
    const ports = account({ [`${DOOR}/account/export`]: () => ok({ player: { id: 'account:plr_x' } }), [`${API}/api/players/me/export`]: () => ok({ player: { email: 'a@b.co' } }) });
    expect(await exportMine(ports, DOOR, DEVICE)).toEqual({ api: { player: { email: 'a@b.co' } }, game: { player: { id: 'account:plr_x' } } });
    expect(ports.heard.find(row => row.url === `${DOOR}/account/export`)?.authorization).toBe(`Ticket ${live}`);
    expect(ports.heard.find(row => row.url === `${API}/api/players/me/export`)?.authorization).toBe('Bearer wss_s');
    const nothing = account({ [`${API}/api/players/me/export`]: () => ok({ player: {} }), [`${DOOR}/account/export`]: () => Response.json({ error: 'nothing saved' }, { status: 404 }) });
    expect(await exportMine(nothing, DOOR, DEVICE), 'nothing saved on the server yet').toEqual({ api: { player: {} }, game: null });
    expect(await exportMine(account({}), DOOR, DEVICE), 'the API refused: no file').toBeUndefined();
    const doorDown = account({ [`${API}/api/players/me/export`]: () => ok({ player: {} }), [`${DOOR}/account/export`]: () => new Response('', { status: 503 }) });
    expect(await exportMine(doorDown, DOOR, DEVICE), 'review S1: a door that failed gives no file missing the saves').toBeUndefined();
    const oldDoor = account({ [`${API}/api/players/me/export`]: () => ok({ player: {} }), [`${DOOR}/account/export`]: () => new Response('404 Not Found', { status: 404 }) });
    expect(await exportMine(oldDoor, DOOR, DEVICE), 'review 2: a door without the routes is not "nothing saved"').toBeUndefined();
  });

  test('delete: the door, then the API, then the page signs out; a player in the world is told to leave first', async () => {
    const order: string[] = [];
    const ports = account({ [`${DOOR}/account/delete`]: () => { order.push('door'); return ok({ deleted: true }); }, [`${API}/api/players/me/delete`]: () => { order.push('api'); return ok({ deleted: true }); } });
    expect(await deleteMine(ports, DOOR, DEVICE)).toBe('deleted');
    expect(order).toEqual(['door', 'api']);
    expect(signedIn(ports), 'signed out').toBeUndefined();
    const playing = account({ [`${DOOR}/account/delete`]: () => new Response('', { status: 409 }), [`${API}/api/players/me/delete`]: () => ok({ deleted: true }) });
    expect(await deleteMine(playing, DOOR, DEVICE)).toBe('playing');
    expect(playing.heard.some(row => row.url.endsWith('/api/players/me/delete')), 'the API is never asked').toBe(false);
    expect(signedIn(playing), 'still signed in').toBeDefined();
    const down = account({ [`${API}/api/players/me/delete`]: () => ok({ deleted: true }) });
    expect(await deleteMine(down, DOOR, DEVICE), 'a door that fails stops it').toBe('failed');
    const half = account({ [`${DOOR}/account/delete`]: () => ok({ deleted: true }), [`${API}/api/players/me/delete`]: () => new Response('', { status: 503 }) });
    expect(await deleteMine(half, DOOR, DEVICE), 'review S4: saves gone, the account not yet').toBe('saves-gone');
    expect(signedIn(half), 'still signed in, to try again').toBeDefined();
    const solo = account({ [`${API}/api/players/me/delete`]: () => ok({ deleted: true }) });
    expect(await deleteMine(solo, undefined, DEVICE), 'a build with no world deletes the account only').toBe('deleted');
  });
});
