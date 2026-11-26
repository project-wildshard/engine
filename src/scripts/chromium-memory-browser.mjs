import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from "./browser-playwright.mjs";
import * as v from 'valibot';
import { KEYCHAIN_ARGS } from './.kit/chromium-keychain.mjs';

/** Retain Network events and cache controls, never Inspector response bodies.
 * This must cover Playwright's own sessions, not just a new diagnostic session.
 * @param {object} message */
export function memoryNetworkCommand(message) {
  if (Reflect.get(message, 'method') !== 'Network.enable') return message;
  const params = v.parse(v.optional(v.record(v.string(), v.unknown()), {}), Reflect.get(message, 'params'));
  return {...message, params: {...params, maxTotalBufferSize: 0, maxResourceBufferSize: 0, maxPostDataSize: 0}};
}

/** Chromium writes DevToolsActivePort after it binds the port, which can be after Playwright's pipe connects and
 * launchServer resolves: ENGINE-MEMORY EM12's ubuntu job read it empty once (ci-reports 44233775878). Poll until both
 * lines are whole, up to `waitMs`.
 * @param {string} file @param {number} [waitMs] @returns {Promise<[string, string]>} */
export async function devToolsEndpoint(file, waitMs = 10_000) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const [port, path] = await readFile(file, 'utf8').then(text => text.trim().split('\n'), () => []);
    if (port !== undefined && /^\d+$/u.test(port) && port !== '0' && path !== undefined && path.startsWith('/devtools/browser/')) return [port, path];
    if (Date.now() >= deadline) throw new Error('Invalid memory browser endpoint');
    await new Promise(resolve => { setTimeout(resolve, 50); });
  }
}

/** Use Playwright's normal Chromium launch/default flags, with a public CDP
 * transport that bounds every Network session before any page is created.
 * The launch connection owns no contexts; the measured connection owns all.
 * @param {readonly string[]} args */
export async function launchMemoryBrowser(args) {
  const owner = await chromium.launchServer({args: [...KEYCHAIN_ARGS, ...args, '--remote-debugging-port=0']});
  let socket;
  try {
    const directory = owner.process().spawnargs.find(arg => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
    if (directory === undefined) throw new Error('Memory browser omitted its owned profile');
    const [port, path] = await devToolsEndpoint(join(directory, 'DevToolsActivePort'));
    const connected = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    socket = connected;
    await new Promise((resolve, reject) => {
      connected.addEventListener('open', resolve, {once: true});
      connected.addEventListener('error', reject, {once: true});
    });
    /** @type {import('playwright').ConnectOverCDPTransport} */
    const transport = {
      send: message => { connected.send(JSON.stringify(memoryNetworkCommand(message))); },
      close: () => { connected.close(); },
    };
    connected.addEventListener('message', event => { transport.onmessage?.(JSON.parse(v.parse(v.string(), event.data))); });
    connected.addEventListener('close', () => { transport.onclose?.(); });
    const browser = await chromium.connectOverCDP(transport);
    /** @type {Promise<void> | undefined} */
    let closing;
    const close = () => {
      closing ??= (async () => {
        try { await browser.close(); } finally { await owner.close(); }
      })();
      return closing;
    };
    return {browser, close};
  } catch (error) { socket?.close(); await owner.close(); throw error; }
}
