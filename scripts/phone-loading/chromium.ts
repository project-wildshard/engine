import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {setImmediate} from 'node:timers/promises';
import {chromium, type Browser, type Request, type Response} from 'playwright';
import {nativeBodyBytes} from './native-body.ts';
import {NativeSizeLedger, type NativeSizeObservation} from './native-sizes.ts';
import {record, type Profile} from './model.ts';
import {startSharedLink, type SharedLink} from './link.ts';

export interface ChromiumRun {browser: Browser; close: () => Promise<void>; workerNetwork: () => boolean; errors: string[]; nativeSizes: (request: Request, response?: Response | null) => Promise<NativeSizeObservation>;
  /** The one downlink page and worker share; null when the preset is unthrottled. */
  link: SharedLink | null;
  /** CDP emulation for every target: its latency and upload, never its own download rate when the link carries that. */
  conditions: {offline: false; latency: number; downloadThroughput: number; uploadThroughput: number}}
/** Browser-level auto-attach catches the worker before its first network request. */
export async function launchChromium(directory: string, profile: Profile): Promise<ChromiumRun> {
  await mkdir(directory, {recursive: true});
  const link = profile.down > 0 ? await startSharedLink(profile.down) : null;
  const conditions = {offline: false as const, latency: profile.latency, downloadThroughput: link === null ? profile.down : -1, uploadThroughput: profile.up};
  // <-loopback> drops Chromium's implicit loopback bypass, so 127.0.0.1 previews take the link too.
  const child = spawn(chromium.executablePath(), ['--headless=new', '--remote-debugging-port=0',
    `--user-data-dir=${directory}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist',
    ...link === null ? [] : [`--proxy-server=${link.proxy}`, '--proxy-bypass-list=<-loopback>'], 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
  let socket: WebSocket | undefined;
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Chromium CDP endpoint deadline')), 15_000);
      child.once('error', error => {clearTimeout(timer); reject(error);});
      child.once('exit', code => {clearTimeout(timer); reject(new Error(`Chromium exited ${code}`));});
      child.stderr.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        const match = /DevTools listening on (ws:\/\/[^\s]+)/u.exec(output)?.[1];
        if (match !== undefined) {clearTimeout(timer); resolve(match);}
      });
    });
    const ws = new WebSocket(endpoint); socket = ws;
    await new Promise<void>((resolve, reject) => {ws.addEventListener('open', () => resolve(), {once: true});
      ws.addEventListener('error', () => reject(new Error('CDP socket error')), {once: true});});
    let serial = 0, workers = 0;
    const errors: string[] = [];
    const sessions = new Map<string, boolean>(), contexts = new Map<string, string>(), pages = new Set<string>();
    const pending = new Map<number, {resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; sessionId?: string}>();
    const send = (method: string, params: object, sessionId?: string): Promise<unknown> => new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => {pending.delete(id); reject(new Error(`CDP deadline: ${method}`));}, 15_000);
      pending.set(id, {resolve, reject, timer, ...(sessionId === undefined ? {} : {sessionId})}); ws.send(JSON.stringify({id, method, params, sessionId}));
    });
    const native = new NativeSizeLedger((session, id, url, headers) => {
      const context = contexts.get(session);
      const cacheSession = context === undefined ? session : [...pages].find(page => contexts.get(page) === context) ?? session;
      return nativeBodyBytes(send, session, id, url, headers, cacheSession);
    });
    ws.addEventListener('message', event => {
      const message = record(JSON.parse(String(event.data)));
      if (typeof message['id'] === 'number') {
        const command = pending.get(message['id']);
        if (command === undefined) return;
        pending.delete(message['id']); clearTimeout(command.timer);
        if (message['error'] !== undefined) command.reject(new Error(JSON.stringify(message['error'])));
        else command.resolve(message['result']);
        return;
      }
      if (typeof message['sessionId'] === 'string' && typeof message['method'] === 'string')
        native.event(message['sessionId'], sessions.get(message['sessionId']) ?? false, message['method'], message['params']);
      if (message['method'] === 'Target.detachedFromTarget') {
        const ended = record(message['params'])['sessionId'];
        if (typeof ended === 'string') {
          sessions.delete(ended); contexts.delete(ended); pages.delete(ended);
          for (const [id, command] of pending) if (command.sessionId === ended) {pending.delete(id); clearTimeout(command.timer); command.reject(new Error('Native target ended'));}
        }
        return;
      }
      if (message['method'] !== 'Target.attachedToTarget') return;
      const params = record(message['params']), info = record(params['targetInfo']);
      const sessionId = params['sessionId'];
      if (typeof sessionId !== 'string') return;
      sessions.set(sessionId, info['type'] === 'service_worker');
      if (typeof info['browserContextId'] === 'string') contexts.set(sessionId, info['browserContextId']);
      if (info['type'] === 'page') pages.add(sessionId);
      void (async () => {
        let resumed = false;
        try {
          if (info['type'] === 'worker' || info['type'] === 'shared_worker') {
            await send('Runtime.runIfWaitingForDebugger', {}, sessionId); resumed = true;
          }
          if (['page', 'iframe', 'service_worker'].includes(String(info['type']))) await send('Network.enable', {}, sessionId);
          if (info['type'] === 'service_worker') {
            await send('Network.emulateNetworkConditions', conditions, sessionId);
            workers++;
          }
        } catch (error) {if (sessions.has(sessionId)) errors.push(`Native network setup: ${String(error)}`);}
        finally {if (!resumed && sessions.has(sessionId)) await send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch((error: unknown) => {errors.push(String(error));});}
      })();
    });
    await send('Target.setAutoAttach', {autoAttach: true, waitForDebuggerOnStart: true, flatten: true});
    const browser = await chromium.connectOverCDP(endpoint);
    return {browser, errors, nativeSizes: async (request, response) => {
      // Playwright and the passive ledger use separate sockets. Let queued
      // native completion events arrive before asking for their bytes.
      await setImmediate();
      return native.observe(request, response);
    }, workerNetwork: () => workers > 0, link, conditions, close: async () => {
      try {await browser.close();} finally {
        ws.close(); child.kill();
        for (const command of pending.values()) {clearTimeout(command.timer); command.reject(new Error('CDP closed'));}
        await link?.close();
      }
    }};
  } catch (error) {socket?.close(); child.kill(); await link?.close(); throw error;}
}
