// @vitest-environment node
import { expect, test } from 'vitest';
import { openPhoneBrowser, runNativePhoneCommand } from '../scripts/parity/phone-route-browser.mjs';

test('a cold content visit retains prepared Safari while clearing all game storage before bootstrap', async () => {
  const base = 'http://127.0.0.1:4400/', destination = `${base}?tier=phone`;
  const commands: string[][] = [], expressions: string[] = [], methods: string[] = [];
  let closed = 0, proxyClosed = 0;
  const page = await openPhoneBrowser('simulator', base, 'tmp', {
    udid: 'owned-native-device',
    command: args => {
      commands.push(args);
      if (args[0] === 'terminate') throw new Error('Prepared Safari was terminated');
      return args[0] === 'getenv' ? '/owned/inspector.sock' : '';
    },
    proxy: () => ({ kill: () => { proxyClosed++; return true; } }),
    targets: () => Promise.resolve([{ url: `${base}version.json`, webSocketDebuggerUrl: 'ws://127.0.0.1/owned' }]),
    close: () => { closed++; },
    inspector: () => ({
      opened: Promise.resolve(), close: () => undefined, waitForPageTarget: () => Promise.resolve(),
      send: (method, params) => {
        methods.push(method);
        const expression = typeof params?.['expression'] === 'string' ? params['expression'] : '';
        expressions.push(expression);
        if (expression === 'window.__phoneRouteEvaluation') return Promise.resolve({ result: { value: { done: true, value: true } } });
        if (expression.includes('url:location.href,boot:')) return Promise.resolve({ result: { value: { url: destination, boot: destination } } });
        return Promise.resolve({ result: { value: true } });
      },
    }),
  });
  try {
    await page.cold(destination, 'window.__paintWitness=true');
    expect(commands.map(args => args[0])).toEqual(['getenv', 'openurl']);
    expect(commands[1]).toEqual(['openurl', 'owned-native-device', `${base}version.json`]);
    const clear = expressions.findIndex(expression => expression.includes('localStorage.clear()'));
    expect(clear).toBeGreaterThanOrEqual(0);
    const clearing = expressions[clear];
    for (const operation of ['sessionStorage.clear()', 'caches.delete(key)', 'row.unregister()']) expect(clearing).toContain(operation);
    expect(methods).toContain('Page.setBootstrapScript');
    expect(expressions.findIndex(expression => expression.includes('setTimeout(()=>{location.href='))).toBeGreaterThan(clear);
    expect(closed).toBe(0);
  } finally { await page.close(); }
  expect(closed).toBe(1); expect(proxyClosed).toBe(1);
});

test('native failures retain exact argv, original cause and the unchanged ten-second limit', () => {
  const cause = new Error('spawnSync xcrun ETIMEDOUT');
  const args = ['openurl', 'owned-native-device', 'http://127.0.0.1/version.json'];
  let options: { encoding: 'utf8'; timeout: number } | undefined;
  let caught: unknown;
  try { runNativePhoneCommand(args, (_command, actual, settings) => {
    expect(actual).toEqual(['simctl', ...args]); options = settings; throw cause;
  }); } catch (error) { caught = error; }
  expect(options).toEqual({ encoding: 'utf8', timeout: 10000 });
  expect(caught).toBeInstanceOf(Error);
  if (!(caught instanceof Error)) throw new Error('Missing native refusal');
  expect(caught.cause).toBe(cause);
  expect(caught.message).toContain(JSON.stringify(['xcrun', 'simctl', ...args]));
  expect(caught.message).toContain('ETIMEDOUT');
});
