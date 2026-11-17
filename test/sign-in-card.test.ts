// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import type { LoginPorts } from '../src/client/engine/net/playerLogin';
import { openSignIn, SIGN_IN_SWITCHES, takeLink, type LinkHold } from '../src/client/engine/ui/signInCard';

const noHold: LinkHold = { take: () => undefined };

// MMO-PLAN MP2.2e2: the title's sign-in card sends a link, takes a `#login=` link back, shows who is signed in and signs out.
// Google and X stay behind their switches (MP2.2f).
afterEach(() => { document.body.replaceChildren(); });

function ports(): LoginPorts & { readonly asked: string[] } {
  const held = new Map<string, string>(), asked: string[] = [];
  const answers: Record<string, Response> = {
    '/api/login/email': new Response('', { status: 202 }),
    '/api/login/email/redeem': Response.json({ session: 'wss_s', player: { id: 'plr_x', email: 'ann@b.co' } }),
  };
  return {
    api: '', now: () => 0, asked,
    storage: { getItem: key => held.get(key) ?? null, setItem: (key, value) => { held.set(key, value); }, removeItem: key => { held.delete(key); } },
    fetch: (input, init) => {
      const route = typeof input === 'string' ? input : '';
      asked.push(`${route} ${typeof init?.body === 'string' ? init.body : ''}`);
      return Promise.resolve(answers[route]?.clone() ?? new Response('', { status: 404 }));
    },
  };
}
const card = (): HTMLElement => { const box = document.querySelector<HTMLElement>('#ws-signin'); if (box === null) throw new Error('no card'); return box; };
const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise(resolve => { setTimeout(resolve, 0); }); };

test('signed out, the card mails a link and says so; Google and X stay off', async () => {
  const scope = new Scope('sign-in'), api = ports();
  void openSignIn(scope, { parent: document.body, ports: api });
  expect(card().dataset['signedIn']).toBe('false');
  expect(card().querySelector('[data-signin="google"]'), 'Google is behind its switch').toBeNull();
  expect(card().querySelector('[data-signin="x"]'), 'X is behind its switch').toBeNull();
  expect(SIGN_IN_SWITCHES).toEqual({ google: false, x: false });
  const email = card().querySelector<HTMLInputElement>('.ws-signin-email');
  if (email === null) throw new Error('no email field');
  email.value = ' ann@b.co ';
  card().querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  expect(api.asked).toEqual([`/api/login/email {"email":"ann@b.co","game":"${location.origin}"}`]);
  expect(card().querySelector('.ws-signin-note')?.textContent).toContain('Check your email');
  scope.dispose();
  expect(document.querySelector('#ws-signin'), 'the scope closes it').toBeNull();
});

test('a mailed link back on the page signs it in once, and the card signs out', async () => {
  const scope = new Scope('sign-in'), api = ports();
  const page = { pathname: '/', search: '', hash: '#zone=driftwood&login=wsl_abcdefgh12345678' }, replaced: string[] = [];
  const note = await takeLink(api, page, url => { replaced.push(url); page.hash = new URL(url, 'http://x').hash; }, noHold);
  expect(note, 'MP2.2g: the card says who once, in its who line, not again in its note').toBe('');
  expect(replaced, 'the token leaves the address').toEqual(['/#zone=driftwood']);
  expect(await takeLink(api, page, url => { replaced.push(url); }, noHold), 'a reload spends nothing').toBeUndefined();
  expect(api.asked.filter(line => line.includes('redeem')), 'one redeem').toHaveLength(1);
  let changes = 0;
  void openSignIn(scope, { parent: document.body, ports: api, note: note ?? '', changed: () => { changes++; } });
  expect(card().dataset['signedIn']).toBe('true');
  expect(card().querySelector('.ws-signin-who')?.textContent).toBe('Signed in as ann@b.co');
  expect(card().textContent.split('Signed in as').length - 1, 'MP2.2g: "Signed in as" shows once').toBe(1);
  card().querySelector<HTMLButtonElement>('[data-signin="out"]')?.click();
  expect(card().dataset['signedIn'], 'signed out, the card asks again').toBe('false');
  expect(changes).toBe(1);
  scope.dispose();
});

test('MP2.2g: a link the boot took off the address (index.html\'s login door) is spent from where it waits, once', async () => {
  const api = ports(), page = { pathname: '/', search: '', hash: '' }, replaced: string[] = [];
  const token = `wsl_${'abcd'.repeat(4)}`, waiting = [token], hold: LinkHold = { take: () => waiting.shift() };
  expect(await takeLink(api, page, url => { replaced.push(url); }, hold)).toBe('');
  expect(replaced, 'the address had nothing left to take').toEqual([]);
  expect(api.asked, 'the waiting token is the one spent').toEqual([`/api/login/email/redeem {"token":"${token}"}`]);
  expect(await takeLink(api, page, url => { replaced.push(url); }, hold), 'spent once').toBeUndefined();
});

// MMO-PLAN MP2.5c: signed in, the card offers the player's data as one file, and deletes the account in two taps.
function signedInPorts(answers: Record<string, () => Response>): LoginPorts & { readonly asked: string[] } {
  const held = new Map<string, string>([['wildshard.player.session', JSON.stringify({ session: 'wss_s', email: 'ann@b.co' })]]), asked: string[] = [];
  return {
    api: '', now: () => 0, asked,
    storage: { getItem: key => held.get(key) ?? null, setItem: (key, value) => { held.set(key, value); }, removeItem: key => { held.delete(key); } },
    fetch: input => {
      const route = typeof input === 'string' ? input : '';
      asked.push(route);
      if (route === '/api/players/ticket') return Promise.resolve(Response.json({ ticket: `ticket:${'a'.repeat(32)}.device:d1.9999999999.${'b'.repeat(128)}`, expiresAt: '' }));
      return Promise.resolve(answers[route]?.() ?? new Response('', { status: 404 }));
    },
  };
}
const DOOR = 'https://rooms.test';

test('Download my data saves one file with the account and the saves', async () => {
  const scope = new Scope('sign-in'), saved: { name: string; text: string }[] = [];
  const api = signedInPorts({ '/api/players/me/export': () => Response.json({ player: { email: 'ann@b.co' } }), [`${DOOR}/account/export`]: () => Response.json({ saves: [{ shard: 'driftwood-isle' }] }) });
  void openSignIn(scope, { parent: document.body, ports: api, account: { door: () => Promise.resolve(DOOR), device: () => 'device:d1', save: (name, text) => { saved.push({ name, text }); } } });
  card().querySelector<HTMLButtonElement>('[data-signin="export"]')?.click();
  await settle();
  expect(saved).toHaveLength(1);
  expect(saved[0]?.name).toMatch(/^wildshard-account-.*\.json$/u);
  expect(JSON.parse(saved[0]?.text ?? '{}')).toEqual({ api: { player: { email: 'ann@b.co' } }, game: { saves: [{ shard: 'driftwood-isle' }] } });
  scope.dispose();
});

test('Delete account takes two taps, then signs the card out; in the world it says leave first', async () => {
  const scope = new Scope('sign-in');
  const api = signedInPorts({ [`${DOOR}/account/delete`]: () => Response.json({ deleted: true }), '/api/players/me/delete': () => Response.json({ deleted: true }) });
  let changes = 0;
  void openSignIn(scope, { parent: document.body, ports: api, changed: () => { changes++; }, account: { door: () => Promise.resolve(DOOR), device: () => 'device:d1', save: () => undefined } });
  const remove = (): HTMLButtonElement | null => card().querySelector<HTMLButtonElement>('[data-signin="delete"]');
  remove()?.click();
  await settle();
  expect(api.asked.filter(route => route.includes('delete')), 'one tap deletes nothing').toEqual([]);
  expect(remove()?.textContent).toContain('Tap again');
  remove()?.click();
  await settle();
  expect(api.asked.filter(route => route.includes('delete'))).toEqual([`${DOOR}/account/delete`, '/api/players/me/delete']);
  expect(card().dataset['signedIn'], 'signed out').toBe('false');
  expect(card().querySelector('.ws-signin-note')?.textContent).toContain('Account deleted');
  expect(changes).toBe(1);
  scope.dispose();
  const playing = new Scope('sign-in'), busy = signedInPorts({ [`${DOOR}/account/delete`]: () => new Response('', { status: 409 }) });
  void openSignIn(playing, { parent: document.body, ports: busy, account: { door: () => Promise.resolve(DOOR), device: () => 'device:d1', save: () => undefined } });
  remove()?.click(); remove()?.click();
  await settle();
  expect(card().dataset['signedIn']).toBe('true');
  expect(card().querySelector('.ws-signin-note')?.textContent).toContain('Leave the world first');
  playing.dispose();
});
