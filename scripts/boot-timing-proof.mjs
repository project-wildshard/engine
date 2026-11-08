#!/usr/bin/env node
// Manual LS1 milestone proof. Deliberately outside hooks and the unit-test glob.
// Run through scripts/browser-lane.sh; uses production bytes and real workers.
import assert from 'node:assert/strict';
import { resolve as resolvePath } from 'node:path';
import { chromium, webkit, devices } from 'playwright';
import { serve } from './parity/serve.mjs';
import { saveFixture } from './debug-settings.mjs';
import { bootTimingDelay } from './parity/boot-timing-delay.mjs';

/** @param {string} name */
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
/** Browser-side accessor; the callback's code travels to the actual built page. */
function snapshot() {
  const timing = /** @type {import('../src/shared/engine/boot/timing').BootTiming | undefined} */ (Reflect.get(window,'__bootTiming'));
  return timing?.read();
}
/** @param {string} operation */
function observed(operation) {
  const timing = /** @type {import('../src/shared/engine/boot/timing').BootTiming | undefined} */ (Reflect.get(window,'__bootTiming'));
  return timing?.entries.some(row=>row.operation===operation) ?? false;
}
const root = resolvePath(option('root') ?? '.'), expectedAbsent = process.argv.includes('--expect-absent');
const delayKind = option('delay'), delayMs = 1250;
const handoff=process.argv.includes('--handoff');
const serverNetwork=process.argv.includes('--server-network');
const shard=option('shard')??(delayKind==='server'||handoff||serverNetwork?'sunscar-dunes':'template');
const swDelay=delayKind==='sw-open'||delayKind==='sw-put';
const controlled = option('sw') === 'warm' || swDelay;
const preview = await serve(root, '', true);
const proxy=delayKind!==undefined && (swDelay||delayKind==='server')?await bootTimingDelay(preview.url,delayKind,delayMs):undefined;
try {
  for (const name of ['chromium','webkit']) {
    const engine=name==='chromium'?chromium:webkit;
    const browser = await engine.launch({headless:true, ...(name === 'chromium' ? {args:['--mute-audio']} : {})});
    try {
      const context = await browser.newContext({...devices['iPhone 16 Pro'], deviceScaleFactor:2});
      await saveFixture(context, {scope:'device',key:'devMode',data:true});
      if(serverNetwork) await context.addInitScript(()=>{
        const post=Reflect.get(Worker.prototype,'postMessage');
        // Exercise a real server cache miss by withholding only its optional
        // page-held byte loan. The control/game/harness ports stay unchanged.
        /** @this {Worker} @param {unknown} message @param {Transferable[]|StructuredSerializeOptions} [transfer] */
        Worker.prototype.postMessage=function postMessage(message,transfer) {
          const config=typeof message==='object' && message!==null && 'catalogue' in message;
          const next=config && Array.isArray(transfer) && transfer.length===4?transfer.slice(0,3):transfer;
          Reflect.apply(post,this,[message,next]);
        };
      });
      await context.addInitScript(() => {
        const mute = () => {for (const element of document.querySelectorAll('audio,video')) if(element instanceof HTMLMediaElement)element.muted=true;};
        document.addEventListener('DOMContentLoaded',mute,{once:true});
      });
      let delayed = false;
      if (delayKind && !swDelay && delayKind!=='server') await context.route('**/*',async route => {
        const path = new URL(route.request().url()).pathname;
        const match = delayKind === 'worker' ? /serverWorker[^/]*\.js$/u.test(path)
          : delayKind === 'server' ? /\/spawn\/server-.*\.json$/u.test(path)
          : delayKind === 'styles' ? path.endsWith('.css')
          : delayKind === 'tables' ? /tables.*\.json$/u.test(path)
          : path.endsWith('.js');
        if (match && (!delayed || delayKind==='worker' || delayKind==='server')) {delayed=true;await new Promise(resolve => {setTimeout(resolve,delayMs);});}
        await route.continue();
      });
      const page = await context.newPage();
      /** @type {string[]} */ const faults=[];
      page.on('pageerror',error=>faults.push(error.message));
      const address=`${proxy?.url??preview.url}/?chunk=${encodeURIComponent(shard)}&tier=phone&mute=1&nolock=1&sw=${controlled?'1':'0'}`;
      if(handoff) {
        const title=new URL(address);title.searchParams.delete('chunk');
        await page.goto(title.href,{waitUntil:'domcontentloaded',timeout:30000});
        await page.locator('.ws-main-select').click();
        await Promise.all([
          page.waitForURL(url=>url.searchParams.get('chunk')===shard,{waitUntil:'domcontentloaded',timeout:30000}),
          page.locator('.ws-menu-play').click(),
        ]);
      } else await page.goto(address,{waitUntil:'domcontentloaded',timeout:30000});
      if (expectedAbsent) {
        assert.equal(await page.evaluate(()=>typeof Reflect.get(window,'__bootTiming')),'undefined');
        console.log(`${name}: RED reproduced: navigation and early module work have no retained collector`);
        await context.close();continue;
      }
      await page.waitForFunction(observed,'app:first-game-step-end',{timeout:60000});
      await page.waitForFunction(observed,'app:loader-complete',{timeout:30000});
      if(controlled) {
        await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
        // A new-build book/table miss with all the immutable product bodies held.
        // Publication must still be measured before the existing response delivery.
        if(delayKind==='sw-put') await page.evaluate(async()=>{
          for(const cacheName of await caches.keys()) {
            const cache=await caches.open(cacheName);
            for(const key of await cache.keys()) if(/\/assets\/boot-tables-|\/assets\/spawn\/server-/u.test(key.url)) await cache.delete(key);
          }
        });
        await page.reload({waitUntil:'domcontentloaded',timeout:30000});
        await page.waitForFunction(observed,'app:first-game-step-end',{timeout:60000});
        await page.waitForFunction(observed,'app:loader-complete',{timeout:30000});
      }
      const timing=await page.evaluate(snapshot);
      assert.ok(timing);
      if(process.argv.includes('--inspect')) console.log(JSON.stringify({server:timing.entries.filter(row=>row.operation.startsWith('server:')).map(row=>({operation:row.operation,realm:row.realm,start:row.start,end:row.end})),workerResources:timing.resources.filter(row=>row.realm!=='page').map(row=>row.url)}));
      const operations=new Set(timing.entries.map(row=>row.operation));
      for (const operation of ['app:html-script-start','app:collector-installed','app:shell-dom-ready','app:entry-body',
        'app:loading-adopt','worker:module-body','worker:code-ready','worker:configuration-received',
        'server:world-boot','server:booted-send','server:booted-receive','app:first-game-step-end']) {
        assert.ok(operations.has(operation),`${name}: missing ${operation}`);
      }
      const end=timing.entries.find(row=>row.operation==='app:first-game-step-end')?.end;
      const entryStart=timing.entries.find(row=>row.operation==='app:entry-body')?.start;
      assert.ok(typeof end==='number' && typeof entryStart==='number');
      const spans=timing.entries.filter(row=>row.end!==null && row.end>row.start && row.start<end)
        .map(row=> /** @type {[number,number,string]} */ ([Math.max(0,row.start),Math.min(end,row.end??end),row.operation])).sort((a,b)=>a[0]-b[0]);
      let through=0,maxGap=0;
      for(const [start,finish] of spans){maxGap=Math.max(maxGap,start-through);through=Math.max(through,finish);}
      maxGap=Math.max(maxGap,end-through);
      assert.ok(maxGap<=1000,`${name}: unnamed gap ${maxGap}ms`);
      assert.ok(timing.resources.some(row=>row.initiator==='script' && typeof row.pageStart==='number' && row.pageStart<entryStart),'early buffered scripts absent');
      assert.ok(timing.entries.some(row=>row.operation==='worker:clock-roundtrip' && typeof row.detail.workerTimeOrigin==='number' && row.detail.workerTimeOrigin>0),'worker origin/ping absent');
      assert.ok(timing.counters['atomic:completed']?.loaded>10,'atomic completions absent');
      const bytes=Object.entries(timing.counters).filter(([,row])=>row.unit==='decoded-body-bytes' && row.loaded>0);
      if(!controlled) assert.ok(bytes.length>0,'real streamed response bytes absent');
      if(serverNetwork) {
        assert.ok(timing.entries.some(row=>row.realm.startsWith('worker:') && row.operation.startsWith('server:fetch-headers:')),'server network branch not exercised');
        assert.ok(bytes.some(([operation])=>operation.startsWith('worker:')),'worker streamed chunks absent');
      }
      assert.ok(timing.build && typeof timing.navigation?.responseEnd==='number' && timing.navigation.responseEnd>0 && timing.largestGap,'metadata absent');
      if(handoff) {
        const arrival=timing.handoff,input=arrival?.input;
        assert.ok(arrival?.validated===true && arrival.timeOrigin!==timing.timeOrigin && typeof arrival.received==='number' && arrival.received<entryStart,'navigation handoff missing');
        assert.ok(typeof input==='object' && input!==null && 'eventTimeStamp' in input && typeof input.eventTimeStamp==='number' && 'handlerEntry' in input && typeof input.handlerEntry==='number','old input stamps missing');
      }
      if(controlled) {
        assert.ok(timing.serviceWorker?.controller,'warm page was not controlled');
        assert.ok(timing.entries.some(row=>row.realm==='service-worker' && row.operation==='sw:cache-match'),'SW cache records absent');
        assert.ok(timing.entries.some(row=>row.realm==='service-worker' && row.operation==='sw:navigation-handler-and-delivery'),'SW navigation record absent');
      }
      assert.equal(Object.keys(timing.overflow??{}).length,0,'bounded collector overflowed');
      if(delayKind) {
        assert.ok(delayed||proxy?.matched(),`${delayKind} route never matched`);
        const operation=delayKind==='sw-open'?'sw:cache-open':delayKind==='sw-put'?'sw:body-and-cache-publication':delayKind==='worker'?'worker:fetch-evaluate-start':delayKind==='server'?'server:world-boot':delayKind==='styles'?'wait:Startup stylesheets':delayKind==='tables'?'app:tables-import-and-prepare':'app:document-and-module-graph';
        assert.ok(timing.entries.some(row=>row.operation===operation && row.end!==null && row.end-row.start>=delayMs-100),`${operation}: injected delay lost`);
      }
      assert.equal(faults.length,0,faults.join('\n'));
      const renderFrame=await page.evaluate(()=>{
        const probe=/** @type {import('../src/client/engine/debug/probe').EngineProbe|undefined} */(Reflect.get(window,'__wildshard'));
        return probe?.world ? probe.requireWorld().game.renderer.info.render.frame : 0;
      });
      assert.ok(renderFrame>0,'real world did not render');
      console.log(`${name}: PASS first-step=${Math.round(end)}ms unnamed=${Math.round(maxGap)}ms entries=${timing.entries.length} resources=${timing.resources.length} atomic=${timing.counters['atomic:completed']?.loaded} byteStreams=${bytes.length} chunks=${bytes.reduce((sum,[,row])=>sum+row.events,0)} delay=${delayKind??'none'} frame=${renderFrame}`);
      await context.close();
    } finally {await browser.close();}
  }
} finally {proxy?.close();preview.close();}
