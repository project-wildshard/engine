// meta IPHONE13-REAL-TEST (mini-phone-13b): the Web Inspector driver's script wrapping and page choice, and serve-local's
// tailnet check. The device half is proved on the iPhone 13 (meta iphone13/device-2026-11-19.md).
import { expect, test } from 'vitest';
import { asyncExpression, pickPage, syncExpression } from '../scripts/memory/iphone/inspector.mjs';
import { tailnetName } from '../scripts/memory/iphone/serve-local.mjs';

test('a WebDriver body runs with its arguments and returns elements as handles', () => {
  const window = globalThis as unknown as { __wsInspectorElements?: unknown[] };
  class Element {}
  Object.assign(globalThis, { Element, window });
  try {
    const el = new Element();
    Object.assign(globalThis, { el });
    expect(eval(syncExpression('return [arguments[0] + 1, { el, label: arguments[1] }]', [41, 'play']))).toEqual([42, { el: { __wsElement: 0 }, label: 'play' }]);
    expect(window.__wsInspectorElements?.[0]).toBe(el);
  } finally {
    Reflect.deleteProperty(globalThis, 'Element'); Reflect.deleteProperty(globalThis, 'window'); Reflect.deleteProperty(globalThis, 'el');
  }
});

test('an async body gets its callback last', async () => {
  await expect(eval(asyncExpression('const done = arguments[arguments.length - 1]; done(arguments[0] * 2)', [21]))).resolves.toBe(42);
});

test("Safari's tab is attached, never an extension page", () => {
  const extension = { url: 'safari-web-extension://x/_generated_background_page.html', webSocketDebuggerUrl: 'ws://a/2' };
  const tab = { url: 'https://staging.wildshard.io/', webSocketDebuggerUrl: 'ws://a/1' };
  expect(pickPage([extension, tab])).toBe(tab);
  expect(pickPage([extension])).toBeNull();
});

test('serve-local needs a tailnet name with an HTTPS certificate', () => {
  const name = 'mini.example.ts.net';
  expect(tailnetName(JSON.stringify({ Self: { DNSName: `${name}.` }, CertDomains: [name] }))).toBe(name);
  expect(() => tailnetName(JSON.stringify({ Self: { DNSName: `${name}.` }, CertDomains: null }))).toThrow('no HTTPS certificate');
  expect(() => tailnetName(JSON.stringify({ Self: { DNSName: '' } }))).toThrow('no tailnet name');
});
