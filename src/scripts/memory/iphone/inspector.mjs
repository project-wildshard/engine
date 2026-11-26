// Safari Web Inspector driver for an iPhone, over ios_webkit_debug_proxy: the same Safari shape as safari.mjs's W3C client.
// meta IPHONE13-REAL-TEST (mini-phone-13b, 2026-11-19): Remote Automation could not open a session while Guided Access stayed
// held by an orphaned one ("Guided Access active"; Safari: "Unable to start Guided Access session used for WebDriver"), yet Web
// Inspector still reached the page. An inspector attachment also outlives a tab loss: the next page is attached again, where a
// lost tab ended the WebDriver session (IP7). `bench.mjs --driver inspector` uses it.
//
// Differences from WebDriver: a click is pointer and mouse events then the element's own `click()`, `freshTab` opens
// about:blank in the same tab (the zone's WebContent may predate the trial; record.mjs takes the dominant one), and
// `overrides` answer matching requests with local bodies (Web Inspector's local overrides).
// Caution, measured on the iPhone 13: overrides need the Network agent on, which keeps response bodies for the inspector.
// Two Nine boots with a service-worker override lost their tab at texture upload, so a memory or frame comparison runs
// without overrides; they are for functional checks. WS_INSPECTOR_DEBUG=1 prints target events.
import { agentUrl } from '../../agent-marker.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { WebDriverError } from './safari.mjs';

/** @typedef {{ pattern: string, body: string, mimeType?: string }} Override */

/** Wrap a WebDriver-style function body (`arguments`, `return`) so DOM elements come back as handles.
 * @param {string} script @param {unknown[]} args */
export function syncExpression(script, args) {
  return `(() => {
    const pack = (v) => {
      if (v instanceof Element) { const s = (window.__wsInspectorElements ??= []); s.push(v); return { __wsElement: s.length - 1 }; }
      if (Array.isArray(v)) return v.map(pack);
      if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, pack(x)]));
      return v;
    };
    return pack((function () {\n${script}\n}).apply(null, ${JSON.stringify(args)}));
  })()`;
}

/** DF18 (mini-dw3): a JavaScriptCore heap snapshot (Inspector type: id, size, class name index, flags per node; the
 *  GCDebugging type adds three more) summed by class name: object count and bytes, the internal cells apart.
 * @param {string} text */
export function summarizeJscSnapshot(text) {
  const snap = JSON.parse(text);
  const nodes = snap.nodes ?? [], names = snap.nodeClassNames ?? [], width = snap.type === 'GCDebugging' ? 7 : 4;
  /** @type {Map<string, { count: number, bytes: number }>} */ const classes = new Map();
  let count = 0, bytes = 0;
  for (let i = 0; i + width <= nodes.length; i += width) {
    const size = Number(nodes[i + 1]), internal = (Number(nodes[i + 3]) & 1) === 1;
    const name = `${internal ? '(internal) ' : ''}${String(names[nodes[i + 2]] ?? '?')}`;
    const row = classes.get(name) ?? { count: 0, bytes: 0 };
    row.count++; row.bytes += size; classes.set(name, row); count++; bytes += size;
  }
  const top = [...classes.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 60).map(([name, row]) => ({ name, count: row.count, bytes: row.bytes }));
  return { version: snap.version ?? null, type: snap.type ?? null, nodes: count, bytes, edges: Math.floor((snap.edges?.length ?? 0) / 4), top };
}

/** An async WebDriver body takes its callback as the last argument. @param {string} script @param {unknown[]} args */
export function asyncExpression(script, args) {
  return `new Promise((done) => { (function () {\n${script}\n}).apply(null, [...${JSON.stringify(args)}, done]); })`;
}

/** The page to attach: Safari's tab, not an extension's background page. @param {{url: string, webSocketDebuggerUrl: string}[]} pages */
export function pickPage(pages, want = '') {
  const open = pages.filter((page) => !page.url.startsWith('safari-web-extension:') && page.webSocketDebuggerUrl);
  return (want === '' ? open[0] : open.find((page) => page.url === want)) ?? null;
}

/** @param {number} port @param {number} timeout @param {string} [want] a page at exactly this URL */
async function listPages(port, timeout, want = '') {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/json`, { signal: AbortSignal.timeout(3_000) });
      const page = pickPage(await response.json(), want);
      if (page !== null) return page;
    } catch { /* the proxy or the page is not up yet */ }
    if (Date.now() >= deadline) throw new WebDriverError('no such window', 'Web Inspector lists no Safari page');
    await pause(500);
  }
}

/** @param {string} socketUrl @param {{ overrides?: Override[] }} options */
async function attach(socketUrl, { overrides = [] }) {
  const ws = new WebSocket(socketUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new WebDriverError('no such window', 'Web Inspector socket failed')); });
  let id = 0, closed = false;
  /** @type {string | null} */
  let target = null;
  let bootstrapScript = '';
  /** @type {Map<number, {resolve: (value: any) => void, reject: (error: Error) => void}>} */
  const waiting = new Map();
  const fail = (/** @type {string} */ why) => {
    for (const { reject } of waiting.values()) reject(new WebDriverError('no such window', why));
    waiting.clear();
  };
  /** @param {string | null} to @param {string} method @param {object} params */
  const post = (to, method, params) => {
    const inner = { id: ++id, method, params };
    if (to === null) ws.send(JSON.stringify(inner));
    else ws.send(JSON.stringify({ id: ++id, method: 'Target.sendMessageToTarget', params: { targetId: to, message: JSON.stringify(inner) } }));
    return inner.id;
  };
  /** @param {string} method @param {object} [params] @param {number} [timeout] @param {string | null} [to] */
  const send = (method, params = {}, timeout = 60_000, to = target) => new Promise((resolve, reject) => {
    if (closed) { reject(new WebDriverError('no such window', 'Web Inspector socket closed')); return; }
    const sent = post(to, method, params);
    const timer = setTimeout(() => { if (waiting.delete(sent)) reject(new WebDriverError('timeout', `Web Inspector ${method} timed out (${String(to)}: ${JSON.stringify(params).slice(0, 80)})`)); }, timeout);
    waiting.set(sent, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
  });
  /** Overrides and resumption for a page target, before it runs. @param {string} to @param {boolean} paused */
  const prepare = async (to, paused) => {
    // Sent in order without waiting: a paused target answers only once resumed, and it queues these first
    /** @type {Promise<unknown>[]} */
    const sent = [];
    if (bootstrapScript !== '') {
      // WebKit dispatches the new-global bootstrap hook only to an enabled Page agent.
      sent.push(send('Page.enable', {}, 15_000, to));
      sent.push(send('Page.setBootstrapScript', { source: bootstrapScript }, 15_000, to));
    }
    if (overrides.length > 0) {
      // Interception needs the Network agent on, which also keeps response bodies for the inspector. Resource caching
      // stays on: a Nine boot with it off lost its tab at texture upload. A cached response never reaches the interception,
      // so an override belongs on a request that bypasses the HTTP cache (a service worker script) or a fresh URL.
      sent.push(send('Network.enable', {}, 15_000, to));
      sent.push(send('Network.setInterceptionEnabled', { enabled: true }, 15_000, to));
      for (const { pattern } of overrides) {
        sent.push(send('Network.addInterception', { url: pattern.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`), isRegex: true, stage: 'request' }, 15_000, to));
      }
    }
    if (paused) post(null, 'Target.resume', { targetId: to });
    await Promise.allSettled(sent);
  };
  /** @type {Promise<void>} */
  let ready = Promise.resolve();
  let firstTarget = /** @type {(value?: unknown) => void} */ (() => undefined);
  const firstSeen = new Promise((resolve) => { firstTarget = resolve; });
  /** @type {{ url: string, at: number }[]} */
  const served = [];
  const debug = process.env.WS_INSPECTOR_DEBUG === '1';
  /** @type {Set<(message: any) => void>} */
  const listeners = new Set();
  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (debug && String(message.method ?? '').startsWith('Target.') && message.method !== 'Target.dispatchMessageFromTarget') console.error('inspector', Date.now(), JSON.stringify(message).slice(0, 300));
    if (message.method === 'Target.targetCreated') {
      const info = message.params.targetInfo;
      if (info.type !== 'page') return;
      if (!info.isProvisional) target = info.targetId;
      ready = prepare(info.targetId, info.isPaused === true).catch(() => undefined);
      firstTarget();
      return;
    }
    if (message.method === 'Target.didCommitProvisionalTarget') { target = message.params.newTargetId; return; }
    if (message.method === 'Target.targetDestroyed' && message.params.targetId === target) { fail('the inspected page went away'); return; }
    let inner = message, from = null;
    if (message.method === 'Target.dispatchMessageFromTarget') { inner = JSON.parse(message.params.message); from = message.params.targetId; }
    if (typeof inner.method === 'string') for (const listener of listeners) listener(inner);
    if (inner.method === 'Network.requestIntercepted') {
      const url = String(inner.params.request?.url ?? '');
      const hit = overrides.find(({ pattern }) => url.includes(pattern));
      if (hit === undefined) { post(from, 'Network.interceptContinue', { requestId: inner.params.requestId, stage: 'request' }); return; }
      served.push({ url, at: Date.now() });
      post(from, 'Network.interceptRequestWithResponse', { requestId: inner.params.requestId, content: hit.body, base64Encoded: false,
        mimeType: hit.mimeType ?? 'text/javascript', status: 200, statusText: 'OK',
        headers: { 'Content-Type': hit.mimeType ?? 'text/javascript', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
      return;
    }
    if (typeof inner.id === 'number' && waiting.has(inner.id)) {
      const pending = waiting.get(inner.id);
      waiting.delete(inner.id);
      if (inner.error) pending?.reject(new WebDriverError('javascript error', JSON.stringify(inner.error)));
      else pending?.resolve(inner.result);
    }
  };
  ws.onclose = () => { closed = true; fail('Web Inspector socket closed'); };
  // a new document's target waits for its overrides before it loads anything (a Nine boot opens one at +1 s)
  if (overrides.length > 0) await send('Target.setPauseOnStart', { pauseOnStart: true }, 5_000, null).catch(() => undefined);
  await Promise.race([firstSeen, pause(3_000)]);
  await ready;

  let asyncId = 0;
  /** @param {string} expression @param {boolean} awaitPromise @param {number} timeout @returns {Promise<any>} */
  const run = async (expression, awaitPromise, timeout) => {
    await ready;
    if (awaitPromise) {
      // WebKit's evaluate has no awaitPromise, and Runtime.awaitPromise once never answered for a 30 s frame sample on the
      // phone; the page keeps the settled value under a key and is asked for it every half second
      const key = `a${String(++asyncId)}`, deadline = Date.now() + timeout;
      await run(`((window.__wsAsync ??= {}), Promise.resolve(${expression}).then(
        (v) => { window.__wsAsync[${JSON.stringify(key)}] = { ok: true, v }; },
        (e) => { window.__wsAsync[${JSON.stringify(key)}] = { ok: false, e: String(e?.message ?? e) }; }), true)`, false, 10_000);
      while (Date.now() < deadline) {
        await pause(500);
        // a busy page (a Nine frame sample with the Network agent on) can take over 10 s to answer one poll: ask again
        const settled = await run(`(() => { const r = window.__wsAsync?.[${JSON.stringify(key)}]; if (r) delete window.__wsAsync[${JSON.stringify(key)}]; return r ?? null; })()`, false, 20_000)
          .catch((/** @type {unknown} */ error) => { if (error instanceof WebDriverError && error.code === 'timeout' && Date.now() < deadline) return null; throw error; });
        if (settled !== null) {
          if (!settled.ok) throw new WebDriverError('javascript error', settled.e);
          return settled.v;
        }
      }
      throw new WebDriverError('timeout', 'the page did not settle an async script in time');
    }
    const result = await send('Runtime.evaluate', { expression, returnByValue: true }, timeout);
    if (result?.wasThrown) throw new WebDriverError('javascript error', String(result.result?.description ?? JSON.stringify(result.result)));
    return result?.result?.value ?? null;
  };
  /** DF8: the Heap agent's collections since heapStart, in the inspector's stopwatch seconds. */
  /** @type {{ type: string, startTime: number, endTime: number }[]} */
  const heapLog = [];
  const heapListener = (/** @type {any} */ message) => { if (message.method === 'Heap.garbageCollected' && heapLog.length < 5000) heapLog.push(message.params.collection); };
  /** @param {(href: string) => boolean} arrived */
  const settle = async (arrived, timeout = 180_000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      await pause(300);
      try {
        const [href, state] = /** @type {[string, string]} */ (await run('[location.href, document.readyState]', false, 5_000));
        if (arrived(href) && state !== 'loading') return;
      } catch (error) {
        if (closed) throw error; // a provisional page commits under a new target; keep asking
      }
    }
    throw new WebDriverError('timeout', 'page did not finish navigating');
  };
  return {
    sessionId: `inspector:${socketUrl}`,
    served,
    /** Seed capture fixtures before the next document's game modules read saves.
     * New provisional targets receive the same script before resuming.
     * @param {string} source */
    async bootstrap(source) {
      await ready;
      await send('Page.enable', {}, 15_000);
      await send('Page.setBootstrapScript', { source }, 15_000);
      await send('Target.setPauseOnStart', { pauseOnStart: true }, 5_000, null);
      bootstrapScript = source;
    },
    getUrl: () => run('location.href', false, 10_000),
    /** Evaluate one expression as a user gesture (Runtime.evaluate's emulateUserGesture): an API that wants transient
     * activation, such as the Screen Wake Lock, accepts it. Returns the value, or throws what the page threw.
     * @param {string} expression */
    /** Start WebKit's sampling profiler (ScriptProfiler, with stack samples) on the page. */
    async profileStart() {
      await ready;
      await send('ScriptProfiler.startTracking', { includeSamples: true }, 15_000);
    },
    /** Stop the sampling profiler and answer its samples: each a timestamp (s) and its stack, innermost first. */
    async profileStop() {
      /** @type {(value: any) => void} */ let completed = () => undefined;
      const complete = new Promise((resolve) => { completed = resolve; });
      const listener = (/** @type {any} */ message) => { if (message.method === 'ScriptProfiler.trackingComplete') completed(message.params); };
      listeners.add(listener);
      try {
        await send('ScriptProfiler.stopTracking', {}, 15_000);
        const params = await Promise.race([complete, pause(60_000).then(() => null)]);
        return params?.samples?.stackTraces ?? [];
      } finally { listeners.delete(listener); }
    },
    /** DF18 (mini-dw3): JavaScriptCore's live heap now, summed by class (the Heap agent's snapshot, parsed here so the
     *  hundreds of MB of snapshot text never reach the caller): what a full collection marks. The snapshot itself runs a
     *  full collection and holds the page for seconds, so a route takes it after a leg, never inside one. */
    async heapSnapshot() {
      await ready;
      // the collection log (--frames) may hold the Heap agent on already: WebKit refuses a second enable
      await send('Heap.enable', {}, 15_000).catch((/** @type {unknown} */ error) => { if (!String(error).includes('already enabled')) throw error; });
      const result = await send('Heap.snapshot', {}, 180_000);
      return summarizeJscSnapshot(String(result?.snapshotData ?? '{}'));
    },
    /** DF8 (mini-driftwood13h): JavaScriptCore's collections from now on (the Heap agent's garbageCollected events). */
    async heapStart() {
      await ready;
      heapLog.length = 0;
      listeners.add(heapListener);
      await send('Heap.enable', {}, 15_000);
    },
    /** Stop the collection log and answer it on the page clock: [type, start ms, end ms] per collection. The inspector's
     * stopwatch is tied to performance.now() by three forced collections, each between two page clock reads; the tightest
     * window's middle is the offset (`anchorMs` its width). The forced ones are left out. */
    async heapStop() {
      /** @type {{ lo: number, hi: number } | null} */ let best = null;
      const forced = new Set();
      try {
        for (let i = 0; i < 3; i++) {
          const seen = heapLog.length;
          const t1 = Number(await run('performance.now()', false, 10_000));
          await send('Heap.gc', {}, 15_000);
          const t2 = Number(await run('performance.now()', false, 10_000));
          for (let wait = 0; heapLog.length === seen && wait < 20; wait++) await pause(100);
          const gc = heapLog.slice(seen).find((c) => c.type === 'full') ?? heapLog[seen];
          if (gc === undefined) continue;
          forced.add(gc);
          const lo = t1 - gc.startTime * 1000, hi = t2 - gc.startTime * 1000;
          if (best === null || hi - lo < best.hi - best.lo) best = { lo, hi };
        }
      } finally {
        listeners.delete(heapListener);
        await send('Heap.disable', {}, 15_000).catch(() => undefined);
      }
      if (best === null) return { collections: [], anchorMs: null, offsetMs: null };
      const offset = (best.lo + best.hi) / 2;
      // offsetMs maps any inspector stopwatch time (a ScriptProfiler sample's timestamp) onto the page clock: s * 1000 + offsetMs
      return { anchorMs: Math.round((best.hi - best.lo) * 10) / 10, offsetMs: Math.round(offset * 10) / 10, collections: heapLog.filter((c) => !forced.has(c))
        .map((c) => [c.type, Math.round(c.startTime * 1000 + offset), Math.round(c.endTime * 1000 + offset)]) };
    },
    async gesture(expression) {
      await ready;
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, emulateUserGesture: true }, 10_000);
      if (result?.wasThrown) throw new WebDriverError('javascript error', String(result.result?.description ?? JSON.stringify(result.result)));
      return result?.result?.value ?? null;
    },
    /** @param {string} url */
    async navigate(url) {
      const want = agentUrl(url);
      await run(`location.href = ${JSON.stringify(want)}; true`, false, 10_000);
      await settle((href) => href === want || (want !== 'about:blank' && href.startsWith(new URL(want).origin) && href !== 'about:blank'));
    },
    async reload() {
      const before = await run('performance.timeOrigin', false, 10_000);
      await run('location.reload(); true', false, 10_000);
      await settle(() => true);
      if (await run('performance.timeOrigin', false, 10_000) === before) await settle(() => true);
    },
    // The same tab, left where it is: sysmon's process monitor follows the processes alive when it starts, so the bench
    // puts this tab on the zone's origin before its readers start (bench.mjs) and the boot keeps that WebContent.
    freshTab: () => Promise.resolve(),
    // Overrides are for the boot: once the page has control the Network agent goes off, so it stops keeping bodies and
    // streaming events while frames are sampled (bench.mjs calls this at control).
    quiet: async () => {
      if (overrides.length === 0) return;
      await send('Network.setInterceptionEnabled', { enabled: false }, 15_000).catch(() => undefined);
      await send('Network.disable', {}, 15_000).catch(() => undefined);
    },
    // meta IPHONE13-DRIFTWOOD DW6: a cold link run boots with Safari's resource cache off for this page (Web Inspector's
    // "Disable Caches"), the nearest thing to an empty HTTP cache with no finger on the glass; a warm run turns it back on.
    /** @param {boolean} off */
    cacheOff: async (off) => {
      if (off) await send('Network.enable', {}, 15_000).catch(() => undefined);
      await send('Network.setResourceCachingDisabled', { disabled: off }, 15_000);
    },
    /** @param {string} script @param {unknown[]} [args] */
    evaluate: (script, args = []) => run(syncExpression(script, args), false, 60_000),
    /** @param {string} script @param {unknown[]} args @param {number} timeoutMs */
    evaluateAsync: (script, args, timeoutMs) => run(asyncExpression(script, args), true, timeoutMs + 5_000),
    /** @param {{__wsElement: number}} element */
    click: (element) => run(`(() => { const el = window.__wsInspectorElements?.[${String(element.__wsElement)}];
      if (!el) throw new Error('stale element');
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) el.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, { bubbles: true, cancelable: true }));
      el.click(); return true; })()`, false, 10_000),
    close: () => { closed = true; ws.close(); return Promise.resolve(); },
  };
}

/** Start (or reuse) ios_webkit_debug_proxy for this phone, and open attachments to its Safari page. With no Safari page
 * (after a reboot, or a lost tab), Safari is opened at `launchUrl` by devicectl: no automation session, so no Guided Access.
 * @param {string} udid @param {{ port?: number, overrides?: Override[], launchUrl?: string }} [options] */
export async function startInspector(udid, { port = 9322, overrides = [], launchUrl } = {}) {
  const running = await fetch(`http://127.0.0.1:${String(port)}/json`, { signal: AbortSignal.timeout(2_000) }).then(() => true, () => false);
  const proxy = running ? null : spawn('ios_webkit_debug_proxy', ['-c', `${udid}:${String(port)}`], { stdio: 'ignore' });
  const page = async () => {
    try { return await listPages(port, 8_000); } catch (error) {
      if (launchUrl === undefined) throw error;
      spawnSync('xcrun', ['devicectl', 'device', 'process', 'launch', '--device', udid, '--payload-url', launchUrl, 'com.apple.mobilesafari'], { stdio: 'ignore' });
      return listPages(port, 30_000);
    }
  };
  return {
    open: async () => attach((await page()).webSocketDebuggerUrl, { overrides }),
    // A fresh Safari, so a fresh WebContent: a second Nine boot in the process that held the first one was killed at the
    // 1536 MB line at texture upload (2026-11-19). devicectl only, no automation session, so no Guided Access.
    fresh: async () => {
      if (launchUrl === undefined) throw new Error('fresh() needs launchUrl');
      spawnSync('xcrun', ['devicectl', 'device', 'process', 'launch', '--device', udid, '--terminate-existing', '--payload-url', launchUrl, 'com.apple.mobilesafari'], { stdio: 'ignore' });
      return attach((await listPages(port, 45_000, launchUrl)).webSocketDebuggerUrl, { overrides });
    },
    stop: () => { proxy?.kill(); return Promise.resolve(); },
  };
}
