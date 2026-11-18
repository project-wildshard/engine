// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import type { LoginPorts } from '../src/client/engine/net/playerLogin';
import { openSignIn, SIGN_IN_SWITCHES, takeLink, takeLinkOutcome, type LinkHold } from '../src/client/engine/ui/signInCard';
import { listenTap } from '../src/client/engine/input/dom';

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

test('a sign-in opening tap cannot close its new card through the retargeted mobile click', () => {
  const scope = new Scope('sign-in-touch'), opener = document.createElement('button');
  document.body.append(opener);
  listenTap(scope, opener, () => { void openSignIn(scope, { parent: document.body, ports: ports() }); });
  opener.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 20, clientY: 800 }));
  opener.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 20, clientY: 800 }));
  const box = card();
  box.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: 20, clientY: 800 }));
  expect(document.querySelector('#ws-signin'), 'the same touch now hit-tests the backdrop').toBe(box);
  box.querySelector('.ws-signin-close')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: 20, clientY: 800 }));
  expect(document.querySelector('#ws-signin'), 'a retarget to the new close button is not a second press either').toBe(box);
  box.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 20, clientY: 800 }));
  box.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 20, clientY: 800 }));
  expect(document.querySelector('#ws-signin'), 'a new outside press still closes it').toBeNull();
  scope.dispose();
});

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

// FM8b modes 28 and 29: sign-in that can't finish says why inside the card; the player stays on the login, or plays as a guest.
function failingPorts(answers: Record<string, () => Response>): LoginPorts & { readonly asked: string[] } {
  const held = new Map<string, string>(), asked: string[] = [];
  return {
    api: '', now: () => 0, asked,
    storage: { getItem: key => held.get(key) ?? null, setItem: (key, value) => { held.set(key, value); }, removeItem: key => { held.delete(key); } },
    fetch: input => { const route = typeof input === 'string' ? input : ''; asked.push(route); return Promise.resolve(answers[route]?.() ?? new Response('', { status: 404 })); },
  };
}
const failShown = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`#ws-signin [data-failmode="${id}"]:not([hidden])`);
const tap = (root: HTMLElement | null, label: string): void => { [...root?.querySelectorAll('button') ?? []].find(node => node.textContent === label)?.click(); };

test('FM8b mode 29: a link request the API fails names its status, Try now asks again, and Play as a guest closes the card', async () => {
  let status = 502;
  const scope = new Scope('sign-in'), api = failingPorts({ '/api/login/email': () => new Response('', { status }) });
  void openSignIn(scope, { parent: document.body, ports: api });
  expect(failShown('api-5xx'), 'nothing before a request').toBeNull();
  const email = card().querySelector<HTMLInputElement>('.ws-signin-email');
  if (email === null) throw new Error('no email field');
  email.value = 'ann@b.co';
  card().querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  const box = failShown('api-5xx');
  expect(box?.textContent).toContain('Accounts are down');
  expect(box?.querySelector('.ws-signin-fail-body')?.textContent, 'no status in the words a player reads').not.toMatch(/\d{3}/u);
  expect(box?.querySelector('details')?.textContent, 'the status is a Details fact').toContain('answered 502');
  expect(card().querySelector('.ws-signin-email'), 'the login stays under it').not.toBeNull();
  status = 202;
  tap(box, 'Try now');
  await settle();
  expect(api.asked, 'the player\'s tap asked once more').toEqual(['/api/login/email', '/api/login/email']);
  expect(failShown('api-5xx'), 'answered: the box goes').toBeNull();
  expect(card().querySelector('.ws-signin-note')?.textContent).toContain('Check your email');
  status = 503;
  card().querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  tap(failShown('api-5xx'), 'Play as a guest');
  expect(document.querySelector('#ws-signin'), 'the guest way out closes the card').toBeNull();
  scope.dispose();
});

test('FM8b mode 28: a mailed link the API refuses opens the card on Sign-in didn\'t work; a new link from the form signs in', async () => {
  const api = failingPorts({ '/api/login/email/redeem': () => Response.json({ error: 'link not valid' }, { status: 401 }), '/api/login/email': () => new Response('', { status: 202 }) });
  const page = { pathname: '/', search: '', hash: '#login=wsl_abcdefgh12345678' };
  const taken = await takeLinkOutcome(api, page, () => undefined, noHold);
  expect(taken).toEqual({ note: '', failure: { kind: 'auth-failed' } });
  const scope = new Scope('sign-in');
  void openSignIn(scope, { parent: document.body, ports: api, note: taken?.note ?? '', ...taken?.failure === undefined ? {} : { failure: taken.failure } });
  const box = failShown('auth-failed');
  expect(box?.textContent).toContain('Sign-in didn\'t work');
  expect([...box?.querySelectorAll('button') ?? []].map(node => node.textContent)).toEqual(['Email me a new link', 'Play as a guest']);
  tap(box, 'Email me a new link');
  expect(failShown('auth-failed')).toBeNull();
  expect(document.activeElement?.className, 'the email field takes the focus').toBe('ws-signin-email');
  scope.dispose();
  expect(await takeLink(failingPorts({ '/api/login/email/redeem': () => new Response('', { status: 401 }) }), { pathname: '/', search: '', hash: '#login=wsl_abcdefgh12345678' }, () => undefined, noHold),
    'the note alone still says the link was used').toContain('expired or was used');
});

test('FM8b mode 29: a mailed link the API couldn\'t take keeps its token, and Try now spends it once the API is back', async () => {
  let status = 503;
  const api = failingPorts({ '/api/login/email/redeem': () => status === 200 ? Response.json({ session: 'wss_s', player: { id: 'plr_x', email: 'ann@b.co' } }) : new Response('', { status }) });
  const taken = await takeLinkOutcome(api, { pathname: '/', search: '', hash: '#login=wsl_abcdefgh12345678' }, () => undefined, noHold);
  expect(taken?.failure).toEqual({ kind: 'api-5xx', status: 503, token: 'wsl_abcdefgh12345678' });
  const scope = new Scope('sign-in');
  void openSignIn(scope, { parent: document.body, ports: api, ...taken?.failure === undefined ? {} : { failure: taken.failure } });
  expect(failShown('api-5xx')?.querySelector('details')?.textContent).toContain('answered 503');
  status = 200;
  tap(failShown('api-5xx'), 'Try now');
  await settle();
  expect(failShown('api-5xx')).toBeNull();
  expect(card().dataset['signedIn']).toBe('true');
  scope.dispose();
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
      if (route === '/api/players/me/confirm') return Promise.resolve(Response.json({ ticket: `confirm:${'a'.repeat(32)}.9999999999.${'b'.repeat(128)}`, expiresAt: '' }));
      return Promise.resolve(answers[route]?.() ?? new Response('', { status: 404 }));
    },
  };
}
const DOOR = 'https://rooms.test';

test('Download my data saves one file with the account and the saves', async () => {
  const scope = new Scope('sign-in'), saved: { name: string; text: string }[] = [];
  const api = signedInPorts({ '/api/players/me/export': () => Response.json({ player: { email: 'ann@b.co' } }), [`${DOOR}/account/export`]: () => Response.json({ saves: [{ shard: 'driftwood-isle' }] }) });
  void openSignIn(scope, { parent: document.body, ports: api, account: { door: () => Promise.resolve(DOOR), save: (name, text) => { saved.push({ name, text }); } } });
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
  void openSignIn(scope, { parent: document.body, ports: api, changed: () => { changes++; }, account: { door: () => Promise.resolve(DOOR), save: () => undefined } });
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
  void openSignIn(playing, { parent: document.body, ports: busy, account: { door: () => Promise.resolve(DOOR), save: () => undefined } });
  remove()?.click(); remove()?.click();
  await settle();
  expect(card().dataset['signedIn']).toBe('true');
  expect(card().querySelector('.ws-signin-note')?.textContent).toContain('Leave the world first');
  playing.dispose();
});

test('review M2: a door that can\'t be read says try again, and neither button sticks', async () => {
  const scope = new Scope('sign-in'), api = signedInPorts({ '/api/players/me/export': () => Response.json({ player: {} }) });
  void openSignIn(scope, { parent: document.body, ports: api, account: { door: () => Promise.reject(new Error('bad signature')), save: () => undefined } });
  const download = (): HTMLButtonElement | null => card().querySelector<HTMLButtonElement>('[data-signin="export"]'), remove = (): HTMLButtonElement | null => card().querySelector<HTMLButtonElement>('[data-signin="delete"]');
  download()?.click();
  await settle();
  expect(card().querySelector('.ws-signin-note')?.textContent).toContain('Try again later');
  expect(download()?.disabled).toBe(false);
  remove()?.click(); remove()?.click();
  await settle();
  expect(remove()?.disabled).toBe(false);
  expect(remove()?.textContent, 'disarmed').toBe('Delete account');
  expect(api.asked.filter(route => route.includes('delete')), 'nothing deleted').toEqual([]);
  scope.dispose();
});
