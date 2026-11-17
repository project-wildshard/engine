import { describe, expect, test } from 'vitest';
import { heldTicket, linkIn, redeemLink, refreshTicket, sendLink, signedIn, signOut, ticketed, type LoginPorts } from './playerLogin';

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
