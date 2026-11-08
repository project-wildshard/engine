#!/usr/bin/env node
// Manual LS1 milestone proof. Deliberately outside hooks and the unit-test glob.
// Run through scripts/browser-lane.sh; uses production bytes and real workers.
/** @typedef {import('./types/worker-page').WorkerWindow} WorkerWindow */
/** @typedef {import('../src/client/engine/debug/probe').EngineProbe} EngineProbe */
import assert from 'node:assert/strict';
import { resolve as resolvePath } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, webkit, devices } from 'playwright';
import { serve } from './parity/serve.mjs';
import { saveFixture } from './debug-settings.mjs';
import { bootTimingDelay } from './parity/boot-timing-delay.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';

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
const delayKind = option('delay'), delayMs = Number(option('delay-ms')??1250);
assert.ok(Number.isFinite(delayMs)&&delayMs>0&&delayMs<=60000,'delay-ms must be 1..60000');
const handoff=process.argv.includes('--handoff');
const grid=process.argv.includes('--grid');
const serverNetwork=process.argv.includes('--server-network');
const shard=option('shard')??(delayKind==='server'||handoff||serverNetwork?'sunscar-dunes':'template');
const swDelay=delayKind==='sw-open'||delayKind==='sw-put';
const controlled = option('sw') === 'warm' || swDelay;
const remote=option('base');
if(remote!==undefined&&remote!=='https://wildshard-singleplayer.vercel.app')throw new Error('Remote proof requires the real production origin');
if(remote!==undefined){
  assert.equal(delayKind,undefined,'Network fault proxies require a local finished build');
  const response=await fetch(`${remote}/version.json`,{cache:'no-store'}),version=await response.json();
  assert.ok(response.ok);assert.equal(version.build,option('expect-build-id'));assert.equal(version.saveEpoch,1);
  console.log('Exact production timing proof',JSON.stringify(version));
}
const preview = remote===undefined?await serve(root, '', true):{url:remote,close:()=>undefined};
const expectedBuild=option('expect-build');
const proxy=delayKind!==undefined && (swDelay||delayKind==='server')?await bootTimingDelay(preview.url,delayKind,delayMs):undefined;
try {
if(expectedBuild!==undefined) {
  assert.match(expectedBuild,/^[0-9a-f]{40}$/);
  assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),expectedBuild,'checkout does not name the pushed SHA');
  assert.equal(execFileSync('git',['-C',root,'status','--porcelain=v1'],{encoding:'utf8'}).trim(),'','pushed-build proof requires a clean source tree');
  const version=/** @type {unknown} */(await (await fetch(`${preview.url}/version.json`)).json());
  assert.ok(typeof version==='object'&&version!==null&&'build' in version&&typeof version.build==='string'&&version.build.startsWith(`${expectedBuild.slice(0,7)}-`),'preview does not name the pushed build');
}
  const pick=option('browser')??'both';assert.ok(['both','chromium','webkit'].includes(pick));
  for (const name of ['chromium','webkit'].filter(browserName=>pick==='both'||pick===browserName)) {
    const engine=name==='chromium'?chromium:webkit;
    const browser = await engine.launch({headless:true, ...(name === 'chromium' ? {args:['--mute-audio']} : {})});
    try {
      const context = await browser.newContext({...devices['iPhone 16 Pro'], deviceScaleFactor:2});
      await saveFixture(context, {scope:'device',key:'devMode',data:true});
      if(process.argv.includes('--worker-bootstrap')) await context.addInitScript(()=>{
        /** @type {{label:string,steps:number,files:number,bytes:number}[]} */ const samples=[];
        Reflect.set(window,'__workerBootProof',samples);
        const observer=new MutationObserver(()=>{
          const card=document.querySelector('.ws-load'),row=card?.querySelector('[data-key="server"]');
          if(!(card instanceof HTMLElement)||row===null||row===undefined)return;
          const sample={label:row.textContent??'',steps:Number(card.dataset.serverSteps??0),files:Number(card.dataset.serverFiles??0),bytes:Number(card.dataset.serverBytes??0)};
          if(samples.length<1000&&JSON.stringify(sample)!==JSON.stringify(samples.at(-1)))samples.push(sample);
        });
        observer.observe(document,{childList:true,subtree:true,characterData:true,attributes:true});
      });
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
        const match = delayKind === 'worker-runtime' ? /serverRuntime[^/]*\.js$/u.test(path)
          : delayKind === 'worker' ? /serverWorker[^/]*\.js$/u.test(path)
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
      if(grid) {
        const title=new URL(address);title.searchParams.delete('chunk');
        await page.goto(title.href,{waitUntil:'domcontentloaded',timeout:30000});
        const burst=await page.evaluate(async()=>{
          const timing=/** @type {import('../src/shared/engine/boot/timing').BootTiming} */(Reflect.get(window,'__bootTiming'));
          const url=URL.createObjectURL(new Blob(['for(let n=0;n<5000;n++)postMessage({kind:"collector-proof",n});'],{type:'text/javascript'}));
          const worker=new Worker(url,{name:'ls1-aggregate-proof'});let delivered=0;
          try {
            await new Promise((resolve,reject)=>{worker.onmessage=()=>{if(++delivered===5000)resolve(undefined);};worker.onerror=event=>reject(new Error(event.message));});
            const entry=Object.entries(timing.realms??{}).find(([,realm])=>realm.purpose==='ls1-aggregate-proof');
            const realm=entry?.[0],summary=entry?.[1].messages;
            return {delivered,count:summary?.count,entries:timing.entries.filter(row=>row.realm===realm||row.detail.realm===realm).length,overflow:timing.overflow};
          } finally {worker.terminate();URL.revokeObjectURL(url);}
        });
        assert.equal(burst.delivered,5000);assert.equal(burst.count,5000,'worker receipts were not aggregated');
        assert.ok(burst.entries<=8,'worker burst allocated unbounded entries');
        assert.equal(Object.keys(burst.overflow??{}).length,0,'worker burst overflowed the collector');
        console.log(`${name}: 5000 real worker receipts retained in ${burst.entries} entries`);
        await Promise.all([page.waitForURL(url=>url.searchParams.has('chunk'),{waitUntil:'domcontentloaded',timeout:90000}),page.locator('.ws-main-grid').click()]);
      } else if(handoff) {
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
      await page.waitForFunction(()=>{const held=/** @type {import('../src/shared/engine/boot/timing').BootTiming|undefined} */(Reflect.get(window,'__bootTiming'));if(held===undefined)return false;return held.entries.some(row=>row.operation==='app:loader-complete')||Number(held.overflow?.entries)>0;},undefined,{timeout:120000});
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
        // Grid admission deliberately replaces its address with the title URL.
        // A reload therefore returns to the title; use its real GRID control
        // again rather than waiting for game work on a renderer-free title.
        if(grid){
          await page.locator('.ws-main-grid').waitFor({timeout:60000});
          await Promise.all([page.waitForEvent('domcontentloaded',{timeout:90000}),page.locator('.ws-main-grid').click()]);
        }
        try {await page.waitForFunction(observed,'app:first-game-step-end',{timeout:60000});}
        catch(error){
          console.error(`${name}: controlled reload did not reach its first game step`,await page.evaluate(()=>{
            const t=Reflect.get(window,'__bootTiming'),card=document.querySelector('.ws-load');return {url:location.href,state:document.documentElement.dataset.wsState,
              error:document.querySelector('#wserr .msg')?.textContent,overflow:t?.overflow,active:t?.read().active,
              tail:t?.entries.slice(-12),step:card instanceof HTMLElement?card.dataset.step:undefined};
          }),faults);throw error;
        }
        await page.waitForFunction(observed,'app:loader-complete',{timeout:120000});
      }
      const timing=await page.evaluate(snapshot);
      assert.ok(timing);
      assert.equal(Object.keys(timing.overflow??{}).length,0,'bounded collector overflowed');
      if(process.argv.includes('--inspect')) console.log(JSON.stringify({server:timing.entries.filter(row=>row.operation.startsWith('server:')).map(row=>({operation:row.operation,realm:row.realm,start:row.start,end:row.end})),workerResources:timing.resources.filter(row=>row.realm!=='page').map(row=>row.url)}));
      const operations=new Set(timing.entries.map(row=>row.operation));
      if(process.argv.includes('--worker-bootstrap')) {
        assert.ok(operations.has('server:worker-bootstrap-ready'),'actual bootstrap receipt absent');
        assert.ok(timing.entries.some(row=>row.operation==='server:worker-runtime-import'&&row.result==='complete'&&row.end!==null),'actual runtime import never completed');
        const samples=/** @type {{label:string,steps:number,files:number,bytes:number}[]} */(await page.evaluate(()=>Reflect.get(window,'__workerBootProof')));
        assert.ok(samples.some(row=>row.label.includes('Worker boot')&&row.steps>0&&row.files>0&&row.bytes>0),`Worker boot lacks real visible work/verified inputs: ${JSON.stringify(samples)}`);
        console.log(`${name}: Worker boot real visible samples=${samples.length}, steps=${Math.max(...samples.map(row=>row.steps))}`);
      }
      const ordinary=timing.entries.filter(row=>row.operation==='worker:message-receive').length;
      const received=Object.entries(timing.counters).filter(([key,row])=>key.endsWith(':messages-received')&&row.unit==='messages').reduce((sum,[,row])=>sum+row.loaded,0);
      if(grid) {
        assert.ok(received>0,`${name}: grid worker messages have no realm aggregate; raw entries=${ordinary}`);
        assert.equal(ordinary,0,'ordinary worker messages still allocate individual entries');
        for(const [realm,entry]of Object.entries(timing.realms??{}))if(entry.messages!==undefined){
          const messages=entry.messages;assert.equal(messages.count,timing.counters[`${realm}:messages-received`]?.loaded);
          assert.equal(Object.values(messages.kinds).reduce((sum,count)=>sum+count,0),messages.count);
          assert.ok(messages.first<=messages.last&&Object.keys(messages.kinds).length<=33);
        }
        assert.ok(await page.evaluate(()=>{const owner=/** @type {WorkerWindow} */(window);return Boolean(owner.__wildshard.shard.grid.state().live?.live?.gameplayReady);}),'grid did not reach gameplay readiness');
        await page.evaluate(FLOOR_GRID_ENTER);
        await page.waitForFunction(()=>{const owner=/** @type {WorkerWindow} */(window);return typeof owner.__workerClient==='function'&&owner.__workerClient().frames>=30&&owner.__wildshard.shard.grid.state().cellLoading===null;},undefined,{timeout:90000});
        const entered=await page.evaluate(()=>{const owner=/** @type {WorkerWindow} */(window),state=owner.__wildshard.shard.grid.state(),report=owner.__workerClient();return {home:state.home,playing:state.cells.find(cell=>cell.shows==='playing')?.instance,board:state.cellLoading,frames:report.frames,closed:report.closed};});
        assert.equal(entered.playing,entered.home,'fresh grid did not enter its home');assert.equal(entered.closed,null);
        console.log(`${name}: entered ${entered.playing}, home board=${entered.board}, frames=${entered.frames}, pushed=${expectedBuild??'candidate'}`);
      }
      const failures=timing.entries.filter(row=>row.operation.endsWith(':failure')).map(row=>row.detail.message);
      for (const operation of ['app:html-script-start','app:collector-installed','app:shell-dom-ready','app:entry-body',
        'app:loading-adopt','worker:module-body','worker:code-ready','worker:configuration-received',
        'server:world-boot','server:booted-send','server:booted-receive','app:first-game-step-end','app:loader-complete']) {
        assert.ok(operations.has(operation),`${name}: missing ${operation}; failures=${JSON.stringify(failures)}; page=${faults.join(';')}`);
      }
      const end=timing.entries.find(row=>row.operation==='app:loader-complete')?.end;
      const firstStep=timing.entries.find(row=>row.operation==='app:first-game-step-end')?.end;
      const entryStart=timing.entries.find(row=>row.operation==='app:entry-body')?.start;
      assert.ok(typeof end==='number' && typeof entryStart==='number');
      const spans=timing.entries.filter(row=>row.end!==null && row.end>row.start && row.start<end && row.result!=='unresolved-at-loader-complete')
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
        const requests=timing.entries.filter(row=>row.realm==='service-worker'&&row.operation==='sw:request');
        assert.ok(requests.length>0,'real SW request groups absent');
        let phases=0;
        for(const request of requests){
          const rows=request.detail.phases;
          assert.ok(Array.isArray(rows)&&rows.length>0&&rows.length<=32,'SW phases absent or unbounded');
          for(const phase of /** @type {unknown[]} */(rows)){
            assert.ok(typeof phase==='object'&&phase!==null&&'operation' in phase&&typeof phase.operation==='string'&&phase.operation.startsWith('sw:')
              &&'start' in phase&&typeof phase.start==='number'&&Number.isFinite(phase.start)&&phase.start>=request.start
              &&'end' in phase&&typeof phase.end==='number'&&Number.isFinite(phase.end)&&phase.end>=phase.start
              &&request.end!==null&&phase.end<=request.end,'SW phase timestamps escaped their exact request');
          }
          phases+=rows.length;
        }
        assert.ok(phases>requests.length,'SW phases were replaced by request labels');
        console.log(`${name}: controlled SW retained ${phases} exact phases in ${requests.length} requests; overflow=0`);
      }
      if(delayKind) {
        assert.ok(delayed||proxy?.matched(),`${delayKind} route never matched`);
        const operation=delayKind==='sw-open'?'sw:cache-open':delayKind==='sw-put'?'sw:body-and-cache-publication':delayKind==='worker-runtime'?'server:worker-runtime-import':delayKind==='worker'?'worker:fetch-evaluate-start':delayKind==='server'?'server:world-boot':delayKind==='styles'?'wait:Startup stylesheets':delayKind==='tables'?'app:tables-import-and-prepare':'app:document-and-module-graph';
        assert.ok(timing.entries.some(row=>row.operation===operation && row.end!==null && row.end-row.start>=delayMs-100),`${operation}: injected delay lost`);
      }
      assert.equal(faults.length,0,faults.join('\n'));
      const renderFrame=await page.evaluate(()=>{
        const probe=/** @type {EngineProbe|undefined} */(Reflect.get(window,'__wildshard'));
        return probe?.world ? probe.requireWorld().game.renderer.info.render.frame : 0;
      });
      assert.ok(renderFrame>0,'real world did not render');
      console.log(`${name}: PASS first-step=${Math.round(firstStep??0)}ms loader-complete=${Math.round(end)}ms unnamed=${Math.round(maxGap)}ms entries=${timing.entries.length} resources=${timing.resources.length} atomic=${timing.counters['atomic:completed']?.loaded} byteStreams=${bytes.length} chunks=${bytes.reduce((sum,[,row])=>sum+row.events,0)} messages=${received} grid=${grid} delay=${delayKind??'none'} frame=${renderFrame}`);
      await context.close();
    } finally {await browser.close();}
  }
} finally {proxy?.close();preview.close();}
