import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import * as v from 'valibot';

/** Retain Network events and cache controls, never Inspector response bodies.
 * This must cover Playwright's own sessions, not just a new diagnostic session.
 * @param {object} message */
export function memoryNetworkCommand(message) {
  if (Reflect.get(message, 'method') !== 'Network.enable') return message;
  const params = v.parse(v.optional(v.record(v.string(), v.unknown()), {}), Reflect.get(message, 'params'));
  return {...message, params: {...params, maxTotalBufferSize: 0, maxResourceBufferSize: 0, maxPostDataSize: 0}};
}

/** Use Playwright's normal Chromium launch/default flags, with a public CDP
 * transport that bounds every Network session before any page is created.
 * The launch connection owns no contexts; the measured connection owns all.
 * @param {readonly string[]} args */
export async function launchMemoryBrowser(args) {
  const owner = await chromium.launchServer({args: [...args, '--remote-debugging-port=0']});
  let socket;
  try {
    const directory = owner.process().spawnargs.find(arg => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
    if (directory === undefined) throw new Error('Memory browser omitted its owned profile');
    const [port, path] = (await readFile(join(directory, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
    if (port === undefined || !/^\d+$/u.test(port) || path === undefined || !path.startsWith('/devtools/browser/')) throw new Error('Invalid memory browser endpoint');
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
