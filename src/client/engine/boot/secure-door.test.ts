// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real first script of the shipped document.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- runs the inline script in its own context, exactly as index.html ships it.
import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';

// QA 2026-11-13 (Jake, Chrome on iOS): http://staging.wildshard.io/ painted WILDSHARD and the hero, then nothing. Plain http
// is not a secure context: no crypto.randomUUID, crypto.subtle or service worker, so the title threw before its buttons.
const html = readFileSync('index.html', 'utf8');
const door = /<script data-secure-door>([\s\S]*?)<\/script>/u.exec(html)?.[1];
const doctor = /<script data-doctor-door>([\s\S]*?)<\/script>/u.exec(html)?.[1];

interface Run { replaced: string[]; insecure: boolean; ready: (() => void) | undefined; body: string[] }
function run(href: string, secure: boolean, scripts: (string | undefined)[] = [door]): Run {
  const url = new URL(href);
  const out: Run = { replaced: [], insecure: false, ready: undefined, body: [] };
  const location = { href, protocol: url.protocol, host: url.host, hostname: url.hostname, port: url.port, pathname: url.pathname,
    search: url.search, hash: url.hash, replace: (to: string) => { out.replaced.push(to); } };
  const element = (): { style: Record<string, string>; textContent: string; setAttribute: () => void } => ({ style: {}, textContent: '', setAttribute: () => undefined });
  const document = {
    documentElement: { dataset: new Proxy<Record<string | symbol, unknown>>({}, { set: (data, key, value) => { if (key === 'insecure') out.insecure = true; data[key] = value; return true; } }) },
    readyState: 'loading',
    addEventListener: (_type: string, listener: () => void) => { out.ready = listener; },
    createElement: element,
    body: { append: (node: { textContent: string }) => { out.body.push(node.textContent); } },
  };
  const context = { window: { isSecureContext: secure }, location, document, URLSearchParams };
  for (const script of scripts) runInNewContext(script ?? '', context);
  return out;
}

test('the secure door is the first script in the document', () => {
  expect(door).toBeDefined();
  expect(html.indexOf('<script data-secure-door>')).toBe(html.indexOf('<script'));
});

test('plain http on a named host moves to the same address on https before anything loads', () => {
  expect(run('http://staging.wildshard.io/?chunk=driftwood-isle#x', false).replaced).toEqual(['https://staging.wildshard.io/?chunk=driftwood-isle#x']);
  expect(run('http://play.wildshard.io/', false).replaced).toEqual(['https://play.wildshard.io/']);
});

test('a secure page and localhost are left alone', () => {
  const secure = run('https://staging.wildshard.io/', true);
  expect(secure.replaced).toEqual([]); expect(secure.insecure).toBe(false); expect(secure.ready).toBeUndefined();
  expect(run('http://localhost:5173/', false).replaced).toEqual([]);
  expect(run('http://127.0.0.1:5173/', false).insecure).toBe(false);
});

test('an insecure address with no https twin (a LAN dev server) shows a plain line instead of a silent title', () => {
  const lan = run('http://192.168.1.20:5173/', false);
  expect(lan.replaced).toEqual([]);
  expect(lan.insecure).toBe(true);
  lan.ready?.();
  expect(lan.body.join(' ')).toMatch(/https/u);
});

test('the doctor door does not override the move to https', () => {
  expect(doctor).toBeDefined();
  expect(run('http://staging.wildshard.io/?doctor', false, [door, doctor]).replaced).toEqual(['https://staging.wildshard.io/?doctor']);
});

test('a LAN name with no public https twin is not sent to https', () => {
  expect(run('http://devbox/', false).replaced).toEqual([]);
  expect(run('http://pi.local/', false).replaced).toEqual([]);
});
