#!/usr/bin/env node
// Manual LS2-LS6 proof on real boots. Deliberately outside hooks and the unit-test glob.
// Run through scripts/browser-lane.sh after `pnpm build:ring`:
//   scripts/browser-lane.sh node scripts/loading-card-proof.mjs [--shard=template] [--out=<dir>] [--throttle] [--gpu] [--grid]
// --gpu (J204): Chromium on this Mac's real GPU (ANGLE Metal) instead of headless SwiftShader; --throttle still slows its CPU 4x.
// It boots the built product at iPhone portrait size in Chromium and WebKit, records every change of the
// card's bars with the LS1 counters that moved with it, screenshots the card loading and ready, and reports
// each stretch of over 2 s where the bar took less than 1 %, by the stage that held it.
import { mkdirSync, writeFileSync,readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import { chromium, webkit, devices } from 'playwright';
import { serve } from './parity/serve.mjs';
import { saveFixture,debugSettings } from './debug-settings.mjs';
import {walk as walkGrid,entered,settled,observed} from './worker-client-grid-entry.mjs';
import { barStalls, untracedChanges } from './loading-bar-rule.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';

/** @param {string} name */
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = resolvePath(option('root') ?? '.'), shard = option('shard') ?? '_template';
const out = resolvePath(option('out') ?? 'tmp/loading-card'), throttle = process.argv.includes('--throttle'), gpu = process.argv.includes('--gpu');
const chromiumArgs = [...KEYCHAIN_ARGS, '--mute-audio', ...(gpu ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : [])];
const only = option('browser');
const grid=process.argv.includes('--grid');
if(option('arrival')!==undefined)throw new Error('Seeded titleArrival is not a saved-place proof; use --grid');
mkdirSync(out, { recursive: true });

/** Browser-side recorder: one row per bar change, with the LS1 counters at that moment. */
function recordBars() {
  /** @type {import('./loading-bar-rule.mjs').BarRow[]} */
  const rows = [];
  Reflect.set(window, '__barLog', rows);
  /** @type {{t: number, startBytes: number, startTotal: number, startFiles: number, serverSteps: number, serverFiles: number, serverBytes: number}[]} */
  const counts = []; Reflect.set(window, '__countLog', counts);
  const startSteps=['app:document-and-module-graph','app:page-entry-import','app:tables-import-and-prepare',
    'app:tier-menu-download-imports','app:three-import','app:main-import','app:selected-discovery'];
  const timing=()=>/** @type {import('../src/shared/engine/boot/timing').BootTiming|undefined} */(Reflect.get(window,'__bootTiming'));
  const start=()=>{
    const t=timing(),text=document.getElementById('boot-module-files')?.textContent;
    const inventory=/** @type {{common?:[string,number][]}} */(JSON.parse(text===undefined||text===null||text===''?'{}':text)).common??[];
    const modules=new Map(inventory.map(([url,bytes])=>[new URL(url,location.href).href,bytes]));
    const received=new Map();
    for(const row of t?.resources??[])if(row.realm==='page'&&typeof row.url==='string'&&typeof row.decodedBodySize==='number'&&row.decodedBodySize>0){
      const size=modules.get(row.url);if(size!==undefined)received.set(row.url,Math.min(size,row.decodedBodySize));
    }
    return {kind:'start',adopted:(t?.entries??[]).some(row=>row.operation==='app:loading-adopt'),
      done:startSteps.filter(op=>(t?.entries??[]).some(row=>row.operation===op&&row.end!==null&&row.result==='complete')).length,
      total:startSteps.length,bytes:[...received.values()].reduce((a,b)=>a+b,0),
      byteTotal:[...modules.values()].reduce((a,b)=>a+b,0),files:received.size};
  };
  /** @param {string} bar @returns {import('./loading-bar-rule.mjs').ProducerReading|undefined} */
  const evidence=bar=>{
    const t=timing();
    if(bar==='start')return start();
    if(bar==='download'){
      const row=t?.work?.download?.();
      // the head's own ratio (engine src/shared/engine/boot/timing.ts downloadShown): wire sizes when the build declares them
      if(row===undefined)return undefined;
      const wire=/** @type {{totalBytes:number,completedBytes:number,arrivingBytes?:number}|undefined} */(Reflect.get(row,'wire'));
      return {kind:'download',done:wire===undefined?row.completedBytes:Math.min(wire.totalBytes,wire.completedBytes+(wire.arrivingBytes??0)),total:wire===undefined?row.totalBytes:wire.totalBytes,complete:row.complete,known:row.progressKnown!==false,inline:!(t?.entries??[]).some(entry=>entry.operation==='app:loading-adopt')};
    }
    if(bar==='load'){
      const row=t?.work?.load?.();
      return row===undefined?undefined:{kind:'load',configured:row.path!=='pending',rows:row.rows.map(({state,fraction,weight})=>({state,fraction,weight})),
        complete:(t?.entries??[]).some(entry=>entry.operation==='app:control-ready')};
    }
    return undefined;
  };
  const seen=new Map();let step='',ready=false,previousCount='',firstFrame=false;
  Reflect.set(window,'__firstLoadingFrame',null);
  /** @param {HTMLElement} fill */
  const sampleBar=fill=>{
    const bar=fill.dataset.phaseBar??'',pct=Number.parseFloat(fill.style.width||'0');
    if(seen.get(bar)===pct)return;
    seen.set(bar,pct);
    rows.push({t:performance.now(),bar,pct,step,atomic:0,bytes:0,files:0,source:evidence(bar)});
  };
  const hooked=new WeakSet();
  /** @param {HTMLElement} fill */
  const hook=fill=>{
    if(hooked.has(fill))return;hooked.add(fill);
    const style=fill.style,read=style.getPropertyValue.bind(style),write=style.setProperty.bind(style);
    // Chromium exposes width as an own CSS named property; WebKit puts the
    // accessor on CSSStyleProperties. Forward both through native CSSOM on
    // this actual bar only, before the inline document writer executes.
    Object.defineProperty(style,'width',{configurable:true,get:()=>read('width'),set:value=>{write('width',value);sampleBar(fill);}});
  };
  const sample=()=>{
    const card=document.querySelector('.ws-load');if(!(card instanceof HTMLElement))return;
    if(!firstFrame){firstFrame=true;requestAnimationFrame(()=>{Reflect.set(window,'__firstLoadingFrame',{name:card.querySelector('[data-el=slug]')?.textContent,art:getComputedStyle(document.documentElement).getPropertyValue('--ws-load-portrait').trim(),shell:Object.hasOwn(card.dataset,'shell')});});}
    const t=timing(),first=start();let serverSteps=0,serverFiles=0,serverBytes=0;
    const completed=(t?.entries??[]).filter(row=>row.realm!=='page'&&row.operation.startsWith('server:')&&row.result==='complete'&&row.end!==null);
    serverSteps=completed.length;serverFiles=completed.filter(row=>row.operation.startsWith('server:verified-input:')).length;
    for(const row of Object.values(t?.counters??{}))if(row.unit==='verified-input-bytes')serverBytes+=row.loaded;
    const reading={startBytes:first.bytes,startTotal:first.byteTotal,startFiles:first.files,serverSteps,serverFiles,serverBytes};
    const identity=JSON.stringify(reading);if(identity!==previousCount){previousCount=identity;counts.push({t:performance.now(),...reading});}
    const now=card.dataset.step??'';if(now!==step){step=now;rows.push({t:performance.now(),bar:'step',pct:0,step,atomic:0,bytes:0,files:0});}
    if(!ready&&Object.hasOwn(card.dataset,'ready')){ready=true;Reflect.set(window,'__readyAt',performance.now());}
    for(const fill of card.querySelectorAll('[data-phase-bar]'))if(fill instanceof HTMLElement){hook(fill);sampleBar(fill);}
  };
  new MutationObserver(sample).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-step','data-ready']});
  document.addEventListener('DOMContentLoaded',sample,{once:true});

}

const remote=option('base');
if(remote!==undefined&&remote!=='https://play.wildshard.io')throw new Error('Remote proof requires the real production origin');
if(remote!==undefined){
  const response=await fetch(`${remote}/version.json`,{cache:'no-store'}),version=await response.json();
  if(!response.ok||version.build!==option('expect-build-id')||version.saveEpoch!==1)throw new Error('Unexpected production build or save epoch');
  console.log('Exact production loading proof',JSON.stringify(version));
}
const html=remote===undefined?readFileSync(join(root,'dist','index.html'),'utf8'):await(await fetch(remote,{cache:'no-store'})).text();
const title=/id="ws-title-rows"[^>]*>(.*?)<\/script>/su.exec(html)?.[1];
if(title===undefined)throw new Error('Built title catalogue is absent');
const installed=/** @type {{slug:string}[]} */(JSON.parse(title));
for(const requested of grid?['driftwood-isle','open-plot-ember-forge']:[shard])
  if(!installed.some(row=>row.slug===requested))throw new Error(`Built catalogue lacks ${requested}; use its exact slug/full build`);
const preview = remote===undefined?await serve(root, '', true):{url:remote,close:()=>undefined};
const report = [];
try {
  for (const name of ['chromium', 'webkit']) {
    if (only !== undefined && only !== name) continue;
    const engine = name === 'chromium' ? chromium : webkit;
    const profile=grid?mkdtempSync(join(out,`${name}-profile-`)):null;
    const browser=grid?null:await engine.launch({headless:true,...(name==='chromium'?{args:chromiumArgs}: {})});
    try {
      const context=profile!==null?await engine.launchPersistentContext(profile,{...devices['iPhone 16 Pro'],deviceScaleFactor:2,headless:true,
        ...(name==='chromium'?{args:chromiumArgs}: {})}):await browser?.newContext({...devices['iPhone 16 Pro'],deviceScaleFactor:2});
      if(context===undefined)throw new Error('Proof context not created');
      try {
      await context.grantPermissions(name==='chromium'?['clipboard-read','clipboard-write']:['clipboard-read']);
      await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
      await debugSettings(context,{holdLoading:true});
      await context.addInitScript(recordBars);
      const page = await context.newPage();
      /** @type {string[]} */ const faults = [];
      // each grid entry reports the faults raised from the end of the previous entry (its Exit) through its own Exit;
      // the page, and so its error listener, spans all three
      let faultCursor=0;
      page.on('pageerror', error => faults.push(error.message));
      if (throttle && name === 'chromium') {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8 * 8, uploadThroughput: 750e3 / 8 });
      }
      /** @type {{x:number,z:number}|null} */ let earnedPose=null;
      // Arm the metadata fault before the preceding real Exit navigation.
      // Re-loading an already-active title adds an unrelated WebKit native
      // cancellation path; neither arrival nor progress is part of this fault.
      const omitEmberArt=async()=>{
        await context.route('**/*',async route=>{
          if(!route.request().isNavigationRequest()){await route.continue();return;}
          const response=await route.fetch(),body=await response.text();
          const changed=body.replace(/(id="ws-title-rows"[^>]*>)(.*?)(<\/script>)/su,(_all,head,json,tail)=>{
            const rows=JSON.parse(json);for(const row of rows)if(row.slug==='open-plot-ember-forge')row.card.portrait='';
            return head+JSON.stringify(rows)+tail;
          });
          await route.fulfill({response,body:changed});
        });
        // The fault targets the network document, not an older embedded SW
        // DOCUMENT. Keep the earned durable save and all immutable bytes.
        await page.evaluate(async()=>{for(const registration of await navigator.serviceWorker.getRegistrations())await registration.unregister();});
      };
      if(grid)await page.goto(`${preview.url}/?mute=1&nolock=1&sw=0`,{waitUntil:'domcontentloaded'});
      for(const attempt of grid?['fresh-grid','saved-ember','missing-art']:['entry']){
      const tag=`${name}${gpu&&name==='chromium'?'-gpu':''}${throttle&&name==='chromium'?'-throttled':''}-${grid?attempt:shard}`;
      /** @type {{name:string,art:string}|null} */let destination=null;
      if(grid){
        await page.locator('.ws-main-grid').waitFor({timeout:60000});
        destination=await page.evaluate(slug=>{
          const rows=JSON.parse(document.getElementById('ws-title-rows')?.textContent??'[]');
          const row=rows.find((/** @type {{slug:string}} */candidate)=>candidate.slug===slug);if(row===undefined)throw new Error('Full catalogue destination absent');
          return {name:row.name,art:row.card?.portrait??''};
        },attempt==='fresh-grid'?'driftwood-isle':'open-plot-ember-forge');
        const loaded=page.waitForEvent('domcontentloaded',{timeout:60000});
        await page.locator('.ws-main-grid').click();await loaded;
      }else await page.goto(`${preview.url}/?chunk=${encodeURIComponent(shard)}&tier=phone&mute=1&nolock=1&sw=0`,{waitUntil:'commit',timeout:30000});
      await page.waitForFunction(() => document.querySelector('.ws-load:not([data-shell])') !== null, null, { timeout: 60000 });
      await page.screenshot({ path: join(out, `${tag}-loading.png`) });
      await page.waitForSelector('.ws-load[data-ready]', { timeout: 120000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(out, `${tag}-ready.png`) });
      if(destination!==null){
        const first=await page.evaluate(()=>Reflect.get(window,'__firstLoadingFrame'));
        const adopted=await page.evaluate(()=>({name:document.querySelector('.ws-load [data-el=slug]')?.textContent,
          art:getComputedStyle(document.documentElement).getPropertyValue('--ws-load-portrait').trim()}));
        const matches=(/** @type {{name:string|undefined,art:string}|null} */view)=>view?.name===destination.name&&(destination.art===''?view.art==='none':view.art.includes(destination.art));
        if(!matches(first)||!matches(adopted))faults.push(`saved-place card mismatch for ${attempt}`);
        if(attempt==='missing-art'&&destination.art!=='')faults.push('missing-art fixture did not remove art');
        console.log(`${tag}: first/adopted destination ${matches(first)&&matches(adopted)?'ok':'FAILED'}, art ${destination.art===''?'none':'own'}`);
      }
      // Forward the native write and preserve rejection. Only a trusted locator
      // click may trigger Copy; read back only after this proof's own write won.
      await page.evaluate(()=>{
        const original=navigator.clipboard.writeText.bind(navigator.clipboard);
        Reflect.set(window,'__nativeCopy',original);
        navigator.clipboard.writeText=text=>{
          const raw=/** @type {import('../src/shared/engine/boot/timing').BootTiming} */(Reflect.get(window,'__bootTiming')).read();
          const expected={entries:raw.entries.map(({id,start,end})=>({id,start,end})),resources:raw.resources.length,
            counters:Object.keys(raw.counters).length,realms:Object.keys(raw.realms??{}).length};
          const receipt={text,expected,settled:false,success:false};Reflect.set(window,'__copyReceipt',receipt);
          return original(text).then(()=>{receipt.settled=true;receipt.success=true;return undefined;},(/** @type {unknown} */error)=>{receipt.settled=true;throw error;});
        };
      });
      await page.locator('.ws-load-copy').click();
      await page.waitForFunction(()=>Reflect.get(window,'__copyReceipt')?.settled===true);
      const copied=await page.evaluate(async()=>{
        const receipt=Reflect.get(window,'__copyReceipt');
        if(receipt.success!==true)return {ok:false,reason:'native write rejected'};
        const native=await navigator.clipboard.readText();
        if(native!==receipt.text)return {ok:false,reason:'native readback differs'};
        const marker='timeline (LS1):\n',at=native.indexOf(marker);
        if(at===-1)return {ok:false,reason:'no complete timeline'};
        const parsed=JSON.parse(native.slice(at+marker.length)),expected=receipt.expected;
        const entries=parsed.entries.map((/** @type {{id:number,start:number,end:number|null}} */{id,start,end})=>({id,start,end}));
        const complete=JSON.stringify(entries)===JSON.stringify(expected.entries)&&parsed.resources.length===expected.resources
          &&Object.keys(parsed.counters).length===expected.counters&&parsed.realms.length===expected.realms;
        return {ok:complete&&parsed.exportPrivacy==='own-paths-other-urls-and-free-text-removed'&&document.querySelector('.ws-load-copy')?.textContent==='Copied',
          reason:complete?`complete safe report: ${entries.length} events`:'timeline or numeric facts truncated'};
      });
      if(!copied.ok)faults.push(`copy diagnostics: ${copied.reason}`);
      console.log(`${tag}: native copy ${copied.ok?'ok':'FAILED'} · ${copied.reason}`);
      // Fault injection proves the real control exposes refusal; it is separate
      // from the native successful transfer above and grants no progress credit.
      await page.evaluate(()=>{navigator.clipboard.writeText=()=>Promise.reject(new DOMException('Proof refusal','NotAllowedError'));});
      await page.locator('.ws-load-copy').click();
      await page.waitForFunction(()=>document.querySelector('.ws-load-copy')?.textContent==='Copy failed');
      await page.evaluate(()=>{navigator.clipboard.writeText=Reflect.get(window,'__nativeCopy');});
      const log = await page.evaluate(() => Reflect.get(window, '__barLog'));
      const readyAt = await page.evaluate(() => Reflect.get(window, '__readyAt'));
      if (process.argv.includes('--dump')) writeFileSync(join(out, `${tag}-timing.json`), JSON.stringify(await page.evaluate(() => Reflect.get(window, '__bootTiming')?.read()), null, 1));
      // LS7: each Load row's own measured ms (the card's timeline, exclusive of nested work), the source of its bar weight
      if (process.argv.includes('--dump')) writeFileSync(join(out, `${tag}-rows.json`), JSON.stringify(await page.evaluate(() => {
        const card = document.querySelector('.ws-load');
        /** @type {{path?: string, rows?: {key: string, state: string, ms: number, weight?: number}[]} | undefined} */
        const snapshot = card === null ? undefined : Reflect.get(card, Symbol.for('engine.loading.snapshot'));
        return { path: snapshot?.path, rows: (snapshot?.rows ?? []).map(({ key, state, ms, weight }) => ({ key, state, ms, weight })) };
      }), null, 1));
      const counts = await page.evaluate(() => Reflect.get(window, '__countLog'));
      const lastCount = counts.at(-1);
      const measured = lastCount !== undefined && lastCount.startBytes > 0 && lastCount.startTotal >= lastCount.startBytes
        && lastCount.serverSteps > 0 && lastCount.serverFiles > 0 && lastCount.serverBytes > 0;
      console.log(`${tag}: measured counts ${measured ? 'ok' : 'FAILED'} ${JSON.stringify(lastCount)}`);
      if (!measured) faults.push('Start code bytes or Server internal work counts absent');
      const row={tag,faults:/** @type {string[]} */([]),log,readyAt,counts};report.push(row);
      if(grid){
        await page.locator('.ws-load-play').click();
        await page.waitForFunction(()=>document.querySelector('.ws-load')===null);
        await entered(page);
        const cell=await settled(page,attempt==='fresh-grid'?'driftwood-isle':'open-plot-4-1');
        if(cell.board!==null||cell.closed!==null)throw new Error('Entered cell retained its board or lost the server');
        if(attempt!=='fresh-grid'&&(earnedPose===null||Math.hypot(cell.serverX-earnedPose.x,cell.serverZ-earnedPose.z)>.003))throw new Error('Saved card disagrees with actual resumed pose');
        console.log(`${tag}: actual entered cell ${cell.current}, closed board`);
        if(attempt==='fresh-grid'){
          console.log(`${tag}: native renderer`,await page.evaluate(()=>{
            const world=Reflect.get(window,'__wildshard').world;if(world===undefined)throw new Error('No live world for native renderer observation');
            const gl=world.game.renderer.getContext(),extension=gl.getExtension('WEBGL_debug_renderer_info');
            return extension===null?gl.getParameter(gl.RENDERER):gl.getParameter(extension.UNMASKED_RENDERER_WEBGL);
          }));
          console.log(`${tag}: ordinary road leg 1`);await walkGrid(page,0,-281.25);
          console.log(`${tag}: ordinary road leg 2`);await walkGrid(page,1125,-281.25);
          console.log(`${tag}: ordinary Ember entry`);await walkGrid(page,1125,-390);
          console.log(`${tag}: real Ember crossing`,JSON.stringify(await settled(page,'open-plot-4-1')));
          await page.evaluate(()=>{const save=Reflect.get(window,'__workerClientSave');if(save===undefined)throw new Error('No real save control');return save();});
          const saved=await observed(page);if(!saved.saved)throw new Error('Real Ember save was not acknowledged');
          earnedPose={x:saved.serverX,z:saved.serverZ};
        }
        if(attempt!=='missing-art'){
          if(attempt==='saved-ember')await omitEmberArt();
          await page.evaluate(()=>{const game=Reflect.get(window,'__wildshard');if(game?.world===undefined)throw new Error('No live world');game.world.hud.setPaused(true);});
          await page.getByText('Exit to main',{exact:true}).click();
          await page.locator('.ws-main-grid').waitFor({timeout:60000});
        }
      }
      row.faults=faults.slice(faultCursor);faultCursor=faults.length;
      }
      }finally{await context.close();}
    }finally{await browser?.close();if(profile!==null)rmSync(profile,{recursive:true});}
  }
} finally { preview.close(); }
let failed = false;
for (const { tag, faults, log, readyAt, counts } of report) {
  // The rule's window opens when the first card paints a bar, before any module (the inline Start counter).
  const opened = log[0]?.t ?? 0, { stalls, backwards } = barStalls(log, opened, readyAt), untraced = untracedChanges(log);
  console.log(`${tag}: ready ${(readyAt / 1000).toFixed(1)} s, ${log.filter((/** @type {{bar: string}} */ row) => row.bar !== 'step').length} bar changes, `
    + `${stalls.length} stalls over 2 s, ${backwards.length} backwards, ${untraced.length} untraced, faults ${faults.length}${faults.length > 0 ? `: ${faults.join(' | ')}` : ''}`);
  for (const stall of stalls) console.log(`  stall ${(stall.ms / 1000).toFixed(1)} s at ${(stall.from / 1000).toFixed(1)} s: needs finer feedback in ${stall.stages.join(' > ') || 'unnamed'}`);
  for (const row of untraced) console.log(`  untraced ${row.bar} -> ${row.pct}% at ${(row.t / 1000).toFixed(2)} s (${row.step})`);
  writeFileSync(join(out, `${tag}-bars.json`), JSON.stringify({ readyAt, stalls, backwards, untraced, log, counts }));
  failed ||= backwards.length > 0 || untraced.length > 0 || faults.length > 0 || process.argv.includes('--strict') && stalls.length > 0;
}
if (failed) process.exitCode = 1;
console.log(`shots in ${out}`);
