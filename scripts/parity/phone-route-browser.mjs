import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { setTimeout as sleep } from 'node:timers/promises';
import { devices, webkit } from 'playwright';
import { soakInspector } from '../soak/inspector.mjs';
import { answerApi, bootLifecycleDiagnostic } from './boot-smoke.mjs';
import { saveFixtureCode } from '../debug-settings.mjs';
import { phoneTouchButton } from './phone-route-page.mjs';
import { randomUUID } from 'node:crypto';
import { decodeProtocolPng } from './fast-png.mjs';

/** @typedef {Pick<import('../soak/inspector.mjs').Inspector,'opened'|'send'|'close'|'waitForPageTarget'>} Inspector */
/** @param {unknown} result */
function value(result) {
  if (typeof result !== 'object' || result === null || !('result' in result) || typeof result.result !== 'object' || result.result === null) throw new Error('Invalid Safari evaluation result');
  if ('wasThrown' in result && result.wasThrown === true) throw new Error(JSON.stringify(result.result));
  return 'value' in result.result ? result.result.value : undefined;
}

/** Select the actual requested Safari document, not its same-origin version
 * probe or a previous game tab. @param {unknown} list @param {string} url */
export function phonePageTarget(list,url) {
  if (!Array.isArray(list)) return undefined;
  /** @type {readonly unknown[]} */ const rows = list;
  for (const row of rows) {
    if (typeof row !== 'object' || row === null || !('url' in row) || row.url !== url || !('webSocketDebuggerUrl' in row) || typeof row.webSocketDebuggerUrl !== 'string') continue;
    return {url,webSocketDebuggerUrl:row.webSocketDebuggerUrl};
  }
  return undefined;
}

/** Compose independently valid source statements before either browser executes them.
 * @param {string} paintScript @param {string} visit */
export function phoneBootstrap(paintScript, visit = 'phone-route') {
  return `${saveFixtureCode({ scope: 'device', key: 'devMode', data: true })};\nwindow.__wildshardHarness={seed:357,capture:null};\n${paintScript};\n${saveFixtureCode({scope:'global',key:'settings',merge:true,data:{volume:0}})};\nwindow.__phoneRouteBootURL=location.href;window.__phoneRouteVisit=${JSON.stringify(visit)};window.__phoneRouteDocument=crypto.randomUUID();`;
}

/** The expected navigation must arrive in this visit's new entry document, not another Safari tab or the old title.
 * @param {unknown} snapshot @param {string} url @param {import('./phone-route.mjs').PhoneDocument} previous */
export function phoneDocumentMatches(snapshot, url, previous) {
  if (typeof snapshot !== 'object' || snapshot === null || !('url' in snapshot) || snapshot.url !== url
    || !('visit' in snapshot) || snapshot.visit !== previous.visit || !('document' in snapshot) || typeof snapshot.document !== 'string'
    || snapshot.document.length === 0 || snapshot.document === previous.document || !('boot' in snapshot) || typeof snapshot.boot !== 'string') return false;
  try { const boot = new URL(snapshot.boot), expected = new URL(url);
    return boot.origin === expected.origin && boot.pathname === expected.pathname && boot.searchParams.has('chunk');
  } catch { return false; }
}

const documentExpression = '({url:location.href,visit:window.__phoneRouteVisit,document:window.__phoneRouteDocument,boot:window.__phoneRouteBootURL})';

/** Retain the exact bounded native command instead of collapsing every failure
 * to "spawnSync xcrun ETIMEDOUT".
 * @param {string[]} args
 * @param {(command:string,args:string[],options:{encoding:'utf8',timeout:number})=>string} [execute] */
export function runNativePhoneCommand(args, execute = execFileSync) {
  const argv = ['simctl', ...args], started = performance.now();
  try { return execute('xcrun', argv, { encoding: 'utf8', timeout: 10000 }); }
  catch (error) {
    const elapsedMs = performance.now() - started;
    throw new Error(`Native phone command ${JSON.stringify(['xcrun', ...argv])} failed after ${elapsedMs.toFixed(3)}ms: ${String(error)}`, { cause: error });
  }
}

/** Keep the target-aware connection that owns this visit's bootstrap across
 * the provisional navigation. Closing it before commit loses that owner.
 * @param {Pick<Inspector,'send'>} inspector @param {string} url
 * @param {import('./phone-route.mjs').PhoneDocument} previous @param {number} deadline */
export async function followNativePhoneDocument(inspector,url,previous,deadline) {
  let last;
  while(Date.now()<deadline){
    try{
      last=value(await inspector.send('Runtime.evaluate',{expression:documentExpression,returnByValue:true}));
      if(phoneDocumentMatches(last,url,previous))return;
    }catch(error){last=String(error);}
    await sleep(100);
  }
  throw new Error(`Native phone navigation did not reach its owned document: ${JSON.stringify(last)?.slice(0,2048)}`);
}

/** Capture the actual composited WebKit viewport, with the original 10s cap.
 * No substitute image or retry is permitted if the native page cannot answer.
 * @param {Pick<Inspector,'send'>} inspector @param {string} path */
export async function captureNativePhonePage(inspector,path) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */ let timer;
  let expired=false;
  /** @type {Promise<never>} */
  const limit=new Promise((_resolve,reject)=>{
    timer=setTimeout(()=>{expired=true;reject(new Error('Native phone snapshot exceeded its original 10s deadline'));},10_000);
  });
  const capture=async()=>{
    const viewport=value(await inspector.send('Runtime.evaluate',{expression:'({width:innerWidth,height:innerHeight})',returnByValue:true}));
    if(typeof viewport!=='object'||viewport===null||!('width' in viewport)||!('height' in viewport)
      ||typeof viewport.width!=='number'||typeof viewport.height!=='number'||![viewport.width,viewport.height].every(Number.isFinite)
      ||viewport.width<=0||viewport.height<=0||viewport.width*viewport.height>16_000_000)throw new Error('Invalid native phone viewport');
    const result=await inspector.send('Page.snapshotRect',{x:0,y:0,width:viewport.width,height:viewport.height,coordinateSystem:'Viewport'});
    const prefix='data:image/png;base64,';
    if(typeof result!=='object'||result===null||!('dataURL' in result)||typeof result.dataURL!=='string'
      ||!result.dataURL.startsWith(prefix)||result.dataURL.length>24_000_000)throw new Error('Invalid native phone snapshot');
    const png=decodeProtocolPng(result.dataURL.slice(prefix.length));
    const bytes=path.endsWith('.jpg')?await sharp(png).jpeg({quality:80}).toBuffer():png;
    await sharp(bytes).metadata();
    if(expired)throw new Error('Native phone snapshot arrived after its deadline');
    writeFileSync(path,bytes);return bytes;
  };
  try{return await Promise.race([capture(),limit]);}
  finally{clearTimeout(timer);}
}

/** Native-only transport ports keep lifecycle controls independent of an actual
 * Simulator. Production uses the same bounded native commands and Inspector.
 * @param {string} engine @param {string} base @param {string} _out
 * @param {import('./phone-route-browser.mjs').NativePhonePorts} [native]
 * @returns {Promise<import('./phone-route.mjs').PhonePage>} */
export async function openPhoneBrowser(engine, base, _out, native = {}) {
  const visit = randomUUID();
  /** @type {string[]} */ const faults = [];
  if (engine === 'webkit') {
    const browser = await webkit.launch();
    const context = await browser.newContext({ ...devices['iPhone 16 Pro'], deviceScaleFactor: 2, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', error => faults.push(error.message));
    page.on('crash', () => faults.push('WebKit page crashed'));
    page.on('response', response => { if (response.status() >= 400 && !new URL(response.url()).pathname.startsWith('/api/')) faults.push(`HTTP ${response.status()}: ${response.url()}`); });
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/errors' && request.method() === 'POST') {let report;try{report=JSON.parse(request.postData()??'null');}catch{report={malformed:request.postData()};}if(!bootLifecycleDiagnostic(report,true))faults.push(`Game error report: ${JSON.stringify(report)}`);} });
    await context.route('**/api/telemetry', route => answerApi(route));
    // AC11: a release page's errors go to api.wildshard.io; the request listener above keeps the report, the API never sees it.
    await context.route(url => url.hostname === 'api.wildshard.io' && url.pathname === '/api/errors', route => answerApi(route));
    await context.addInitScript({ content: phoneBootstrap('', visit) });
    return { engine: 'webkit-iphone', faults,
      async cold(url, paintScript) { await context.addInitScript({ content: paintScript }); await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); },
      async click(selector) { await page.locator(selector).tap({ timeout: 10000 }); },
      evaluate: expression => page.evaluate(expression),
      async followNavigation(url, previous, deadline) {
        await page.waitForURL(url,{waitUntil:'domcontentloaded',timeout:Math.max(1,Math.min(90000,deadline-Date.now()))});
        await page.waitForFunction(`(${phoneDocumentMatches.toString()})(${documentExpression},${JSON.stringify(url)},${JSON.stringify(previous)})`,null,
          {timeout:Math.max(1,deadline-Date.now())});
      },
      screenshot: path => page.screenshot({ path, type: path.endsWith('.jpg') ? 'jpeg' : 'png', timeout: 10000 }),
      async close() { try { await context.close(); } finally { await browser.close(); } },
    };
  }
  const udid = native.udid ?? process.env.SIM_UDID;
  if (engine !== 'simulator' || !udid) throw new Error('Native phone route requires the existing Simulator lane');
  const simctl = native.command ?? runNativePhoneCommand;
  const sock = simctl(['getenv', udid, 'RWI_LISTEN_SOCKET']).trim();
  const proxy = native.proxy?.(sock) ?? spawn('ios_webkit_debug_proxy', ['-s', `unix:${sock}`, '-c', 'null:9221,:9232-9240'], { stdio:'ignore' });
  /** @type {Inspector|null} */ let inspector = null;
  const raw = async (/** @type {string} */ expression) => {
    if (inspector === null) throw new Error('Safari inspector unavailable');
    return value(await inspector.send('Runtime.evaluate', {expression, returnByValue:true, emulateUserGesture:true}));
  };
  async function connect(/** @type {string} */ url, /** @type {import('./phone-route.mjs').PhoneDocument|undefined} */ previous,
    deadline = Date.now() + 90000) {
    inspector?.close(); inspector = null;
    while (Date.now() < deadline) {
      // All endpoints describe the same single device; an absent port must not
      // add its entire timeout ahead of the live Inspector port.
      const lists = await Promise.all(Array.from({length:9},async (_,index) => {
        try { return native.targets === undefined
          ? /** @type {unknown} */ (await (await fetch(`http://127.0.0.1:${9232+index}/json`, {signal:AbortSignal.timeout(500)})).json())
          : await native.targets(9232+index); }
        catch { return null; }
      }));
      for (const list of lists) {
        if (!Array.isArray(list)) continue;
        /** @type {readonly unknown[]} */ const rows = list;
        for (const row of rows) {
          const found = phonePageTarget([row],url);
          if (found === undefined) continue;
          inspector = (native.inspector ?? soakInspector)(found.webSocketDebuggerUrl);
          try {
            await inspector.opened;
            await inspector.waitForPageTarget(Math.max(0, Math.min(30000, deadline - Date.now())));
            if (previous === undefined || phoneDocumentMatches(await raw(documentExpression),url,previous)) return;
          } catch { /* another/retired target is not this navigation */ }
          inspector.close(); inspector = null;
        }
      }
      await sleep(100);
    }
    throw new Error('No Safari inspector for exact phone preview');
  }
  // RWI's scalar evaluate does not await promises. Keep one owned result slot,
  // observe its completion, and preserve the real promise's rejection/deadline.
  async function evaluate(/** @type {string} */ expression) {
    await raw(`(()=>{const slot={done:false};window.__phoneRouteEvaluation=slot;Promise.resolve(${expression}).then(value=>Object.assign(slot,{done:true,value}),error=>Object.assign(slot,{done:true,error:String(error)}));return true;})()`);
    const deadline = Date.now() + 155000;
    while (Date.now() < deadline) {
      const result = await raw('window.__phoneRouteEvaluation');
      if (typeof result !== 'object' || result === null) throw new Error('Phone route evaluation lost its document');
      if ('done' in result && result.done === true) {
        if ('error' in result) throw new Error(String(result.error));
        return 'value' in result ? result.value : undefined;
      }
      await sleep(100);
    }
    throw new Error('Phone route asynchronous owner deadline');
  }
  return { engine: 'simulator-safari', faults,
    async cold(url, paintScript) {
      // Preparation has already launched Safari and proved two real frames.
      // Keep that native process; coldness belongs to the cleared game origin.
      const probe = new URL('/version.json',base).href;
      simctl(['openurl',udid,probe]); await connect(probe,undefined);
      await evaluate(`(async()=>{localStorage.clear();sessionStorage.clear();await Promise.all((await caches.keys()).map(key=>caches.delete(key)));await Promise.all((await navigator.serviceWorker.getRegistrations()).map(row=>row.unregister()));return true;})()`);
      if (inspector === null) throw new Error('Safari inspector unavailable');
      await inspector.send('Page.enable');
      await inspector.send('Page.setBootstrapScript', { source: phoneBootstrap(paintScript, visit) });
      // Bootstrap belongs to this page. simctl openurl may create another tab;
      // this Safari's target protocol has Runtime.evaluate, not Page.navigate.
      await raw(`setTimeout(()=>{location.href=${JSON.stringify(url)};},0);true`);
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        let document;
        try { document = await raw('({url:location.href,boot:window.__phoneRouteBootURL})'); } catch { await sleep(100); continue; }
        if (typeof document === 'object' && document !== null && 'url' in document && document.url === url && 'boot' in document && document.boot === url) return;
        await sleep(100);
      }
      throw new Error('Native destination bootstrap did not complete');
    },
    async click(selector) {
      await raw(`(${phoneTouchButton.toString()})(${JSON.stringify(selector)})`);
    },
    evaluate,
    async followNavigation(url, previous, deadline) {
      if(inspector===null)throw new Error('Safari inspector unavailable');
      await followNativePhoneDocument(inspector,url,previous,Math.min(deadline,Date.now()+90000));
    },
    screenshot(path) {
      if(inspector===null)throw new Error('Safari inspector unavailable');
      return captureNativePhonePage(inspector,path);
    },
    close() {
      inspector?.close(); proxy.kill('SIGTERM');
      if (native.close === undefined) spawnSync('xcrun', ['simctl','terminate',udid,'com.apple.mobilesafari'], {stdio:'ignore'});
      else native.close();
      return Promise.resolve();
    },
  };
}
