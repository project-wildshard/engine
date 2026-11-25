// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real inline script of the shipped document.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- runs the inline script in its own context, exactly as index.html ships it.
import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';

// MMO-PLAN MP2.2g: a mailed sign-in link lands as `#login=wsl_…`, a one-time bearer token. Before any module or the boot-timing
// collector reads the address (it posts `location.href` to the service worker, and a stale-build reload keeps it), the login
// door takes the token off the address into this tab's session storage, where the title spends it (`ui/signInCard.ts` `takeLink`).
const html = readFileSync('index.html', 'utf8');
const door = /<script data-login-door>([\s\S]*?)<\/script>/u.exec(html)?.[1];

interface Run { readonly replaced: string[]; readonly held: Map<string, string> }
function run(href: string, moving = false): Run {
  const url = new URL(href), out: Run = { replaced: [], held: new Map() };
  const location = { href, pathname: url.pathname, search: url.search, hash: url.hash };
  const context = {
    location, document: { documentElement: { dataset: moving ? { secureDoor: 'moving' } : {} } },
    history: { state: { kept: true }, replaceState: (_state: unknown, _title: string, to: string) => { out.replaced.push(to); } },
    sessionStorage: { setItem: (key: string, value: string) => { out.held.set(key, value); } },
  };
  runInNewContext(door ?? '', context);
  return out;
}

test('the login door runs before the boot-timing collector and any module', () => {
  expect(door).toBeDefined();
  const at = html.indexOf('<script data-login-door>');
  expect(at).toBeLessThan(html.indexOf('<script data-boot-timing>'));
  expect(at).toBeLessThan(html.indexOf('<script type="module"'));
});

test('a mailed link leaves the address at boot and waits in session storage', () => {
  const token = `wsl_${'abcd'.repeat(4)}`; // a made-up token
  const alone = run(`https://play.wildshard.io/#login=${token}`);
  expect(alone.replaced).toEqual(['/']);
  expect(alone.held.get('wildshard.player.link')).toBe(token);
  expect(run(`https://play.wildshard.io/?tier=phone#zone=driftwood&login=${token}`).replaced, 'the rest of the address stays').toEqual(['/?tier=phone#zone=driftwood']);
  expect(run(`https://play.wildshard.io/#login=${token}&zone=driftwood`).replaced).toEqual(['/#zone=driftwood']);
});

test('an address with no link, or one moving to https, is left alone', () => {
  expect(run('https://play.wildshard.io/#zone=driftwood').replaced).toEqual([]);
  expect(run(`http://play.wildshard.io/#login=wsl_${'abcd'.repeat(4)}`, true).replaced, 'the https page takes it').toEqual([]);
});
