// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import type { LoginPorts } from '../src/client/engine/net/playerLogin';
import { openSignIn, SIGN_IN_SWITCHES, takeLink } from '../src/client/engine/ui/signInCard';

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
  const note = await takeLink(api, page, url => { replaced.push(url); page.hash = new URL(url, 'http://x').hash; });
  expect(note).toBe('Signed in as ann@b.co');
  expect(replaced, 'the token leaves the address').toEqual(['/#zone=driftwood']);
  expect(await takeLink(api, page, url => { replaced.push(url); }), 'a reload spends nothing').toBeUndefined();
  expect(api.asked.filter(line => line.includes('redeem')), 'one redeem').toHaveLength(1);
  let changes = 0;
  void openSignIn(scope, { parent: document.body, ports: api, note: note ?? '', changed: () => { changes++; } });
  expect(card().dataset['signedIn']).toBe('true');
  expect(card().querySelector('.ws-signin-who')?.textContent).toBe('Signed in as ann@b.co');
  card().querySelector<HTMLButtonElement>('[data-signin="out"]')?.click();
  expect(card().dataset['signedIn'], 'signed out, the card asks again').toBe('false');
  expect(changes).toBe(1);
  scope.dispose();
});
