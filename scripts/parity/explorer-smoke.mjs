#!/usr/bin/env node
// V3: every primary shard's actual Model Explorer catalogue and built thumbnails.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { browserPool } from './pool.mjs';
import { serve } from './serve.mjs';
import { bootCases, discoverCatalogue } from './boot-smoke.mjs';
import { saveFixtureCode, harnessPinCode } from '../debug-settings.mjs';

/** Browser-side, read-only: the existing card canvases after the ordinary Explorer has drawn every one.
 * No re-render, material replacement or injected scene supplies the pixels. */
export function explorerCards() {
  return [...document.querySelectorAll('.ws-x-grid .ws-x-model')].map(card => {
    if(!(card instanceof HTMLElement))throw new Error('Invalid model card');
    const id=card.dataset.id??'', canvas=card.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return {id,ready:false,pixels:0,darkShare:1};
    const context=canvas.getContext('2d');
    if (context===null || canvas.width===0 || canvas.height===0) return {id,ready:false,pixels:0,darkShare:1};
    const data=context.getImageData(0,0,canvas.width,canvas.height).data;
    let dark=0,pixels=0;
    for(let at=0;at<data.length;at+=16){
      pixels++;
      if(Math.max(data[at]??0,data[at+1]??0,data[at+2]??0)<16)dark++;
    }
    return {id,ready:true,pixels,darkShare:pixels===0?1:dark/pixels};
  });
}

/** @param {readonly {slug:string,status:string,legacy:boolean,shardSelect?:boolean}[]} catalogue */
export function explorerCases(catalogue) {
  return [...new Set([...bootCases(catalogue).filter(row=>row[0]!=='grid').map(row=>row[1]),
    ...catalogue.filter(row=>!row.legacy && row.shardSelect===false).map(row=>row.slug)])];
}

/** Split the actual discovered route order, retaining every route exactly once.
 * Each runner remains serial; the default local command still covers all routes.
 * @param {readonly string[]} cases @param {string} [group] */
export function explorerPartition(cases,group='all') {
  if (!['all','explorer-a','explorer-b'].includes(group)) throw new Error('Unknown Explorer case group');
  if (new Set(cases).size !== cases.length || cases.some(slug=>slug.length===0)) throw new Error('Invalid Explorer route inventory');
  if (group==='all') return [...cases];
  const half=group==='explorer-a'?0:1;
  return cases.filter((_slug,index)=>index%2===half);
}

/** @param {readonly {id:string,ready:boolean,pixels:number,darkShare:number}[]} cards */
export function explorerFailures(cards) {
  const seen=new Set(), failures=[];
  for(const card of cards){
    if(card.id.length===0 || seen.has(card.id))failures.push('Missing or duplicate model identity');
    seen.add(card.id);
    if(!card.ready || !Number.isFinite(card.pixels) || card.pixels<=0)failures.push(`${card.id}: thumbnail never drew`);
    else if(!Number.isFinite(card.darkShare) || card.darkShare<0 || card.darkShare>=.9)failures.push(`${card.id}: thumbnail is at least 90% near-black`);
  }
  return failures;
}

/** Readiness only, at the existing polling cadence; pixel validation still runs after every card draws. */
export function explorerState() {
  const fatal=[...document.querySelectorAll('#wserr,.ws-load-error,.ws-game-dev-alert,[data-boot-fatal]')].map(node=>node.textContent);
  const root=document.querySelector('.ws-x.show[data-mode="model"]');
  const cards=root?.querySelectorAll('.ws-x-grid .ws-x-model');
  const readyIds=cards===undefined?[]:[...cards].filter(card=>card.querySelector('canvas')!==null).map(card=>{
    if(!(card instanceof HTMLElement))throw new Error('Invalid model card');
    return card.dataset.id??'';
  });
  const probe = /** @type {import('../../src/client/engine/debug/probe').EngineProbe | undefined} */ (window.__wildshard);
  const identity = {url:location.href,timeOrigin:performance.timeOrigin,slug:probe?.shard.slug??null};
  return {fatal,document:identity,empty:root?.querySelector('.ws-x-empty-models.show')!==null && root!==null,
    ready:cards!==undefined && cards.length>0 && readyIds.length===cards.length,readyIds};
}

/** Read pixels and both roster witnesses in one browser task. Model-ready
 * events cannot invalidate a thumbnail between these synchronous reads. */
export function explorerCapture(){
  function state(){
  const fatal=[...document.querySelectorAll('#wserr,.ws-load-error,.ws-game-dev-alert,[data-boot-fatal]')].map(node=>node.textContent);
  const root=document.querySelector('.ws-x.show[data-mode="model"]');
  const cards=root?.querySelectorAll('.ws-x-grid .ws-x-model');
  const readyIds=cards===undefined?[]:[...cards].filter(card=>card.querySelector('canvas')!==null).map(card=>{
    if(!(card instanceof HTMLElement))throw new Error('Invalid model card');
    return card.dataset.id??'';
  });
  const probe = /** @type {import('../../src/client/engine/debug/probe').EngineProbe | undefined} */ (window.__wildshard);
  const identity = {url:location.href,timeOrigin:performance.timeOrigin,slug:probe?.shard.slug??null};
  return {fatal,document:identity,empty:root?.querySelector('.ws-x-empty-models.show')!==null && root!==null,
    ready:cards!==undefined && cards.length>0 && readyIds.length===cards.length,readyIds};
  }
  function readCards(){
  return [...document.querySelectorAll('.ws-x-grid .ws-x-model')].map(card => {
    if(!(card instanceof HTMLElement))throw new Error('Invalid model card');
    const id=card.dataset.id??'', canvas=card.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return {id,ready:false,pixels:0,darkShare:1};
    const context=canvas.getContext('2d');
    if (context===null || canvas.width===0 || canvas.height===0) return {id,ready:false,pixels:0,darkShare:1};
    const data=context.getImageData(0,0,canvas.width,canvas.height).data;
    let dark=0,pixels=0;
    for(let at=0;at<data.length;at+=16){
      pixels++;
      if(Math.max(data[at]??0,data[at+1]??0,data[at+2]??0)<16)dark++;
    }
    return {id,ready:true,pixels,darkShare:pixels===0?1:dark/pixels};
  });
  }
  const before=state(),cards=readCards(),after=state();
  return {before,cards,after};
}

/** A stopped renderer must not bypass the existing no-progress hang guard.
 * @template T
 * @param {Promise<T>} work @param {number} remainingMs
 * @returns {Promise<T>}
 */
async function withinProgressBudget(work,remainingMs){
  /** @type {ReturnType<typeof setTimeout>|undefined} */ let timer;
  try{
    /** @type {Promise<never>} */ const stalled=new Promise((_resolve,reject)=>{
      timer=setTimeout(()=>{reject(new Error('Explorer catalogue/thumbnail stalled for 180 seconds without progress'));},Math.max(0,remainingMs));
    });
    return await Promise.race([work,stalled]);
  }finally{if(timer!==undefined)clearTimeout(timer);}
}

/** Refuse prior or foreign ready catalogues on a reused page.
 * @param {{url:string,timeOrigin:number,slug:string|null}} observed
 * @param {string} base @param {string} slug @param {number|undefined} previous */
export function verifyExplorerDocument(observed,base,slug,previous){
  const url=new URL(observed.url);
  if(url.origin!==new URL(base).origin || url.searchParams.get('chunk')!==slug || observed.slug!==slug ||
    !Number.isFinite(observed.timeOrigin) || observed.timeOrigin===previous)
    throw new Error(`Explorer requested ${slug} but observed a stale or foreign catalogue`);
}

/** Passive native timings; no render calls, asset mocks or shader changes. */
export function explorerDiagnostics(){
  const probe = /** @type {import('../../src/client/engine/debug/probe').EngineProbe | undefined} */ (window.__wildshard);
  const navigation=performance.getEntriesByType('navigation')[0];
  const resources=performance.getEntriesByType('resource').filter(row=>row instanceof PerformanceResourceTiming).map(row=>({
    url:row.name,type:row.initiatorType,durationMs:row.duration,transferBytes:row.transferSize,encodedBytes:row.encodedBodySize,
    startMs:row.startTime,responseStartMs:row.responseStart,deliveryType:Reflect.get(row,'deliveryType')??null}));
  const measures=performance.getEntriesByType('measure').map(row=>({name:row.name,startMs:row.startTime,durationMs:row.duration}));
  return {document:{url:location.href,timeOrigin:performance.timeOrigin,slug:probe?.shard.slug??null},
    timingBufferFull:Reflect.get(window,'__explorerTimingFull')===true,navigation:navigation?.toJSON()??null,resources,measures};
}

const CONTEXT_CATALOGUES=4;

/** Retain native HTTP/shader caches across a bounded group of world documents.
 * Retiring the native context bounds document/isolate ownership; origin
 * storage deletion alone does not collect the previous document's Wasm banks.
 * Faults and document provenance remain shared across every group.
 * @param {import('playwright').Browser} browser @param {string} base */
export async function openExplorerSession(browser,base,isolated=false){
  /** @type {string[]} */ const faults=[];
  /** @type {{previous:number|undefined}} */ const lifetime={previous:undefined};
  let generation=1,used=0,busy=false,closed=false;
  const limit=isolated?1:CONTEXT_CATALOGUES;
  /** @type {Awaited<ReturnType<typeof openExplorerContext>>|undefined} */ let active=await openExplorerContext(browser,base,faults,lifetime,generation,isolated);
  const retire=async()=>{const previous=active;active=undefined;try{await previous?.close();}catch(error){closed=true;throw error;}};
  return {sweep:async(/** @type {string} */slug,/** @type {string} */out)=>{
    if(closed)throw new Error('Explorer session is closed');
    if(busy)throw new Error('Explorer session already owns a catalogue');
    busy=true;const started=Date.now();
    try{
      if(used===limit){
        const replace=async()=>{
          await retire();if(closed)throw new Error('Explorer session is closed');
          generation++;
          const next=await openExplorerContext(browser,base,faults,lifetime,generation,isolated);
          if(closed){await next.close();throw new Error('Explorer session is closed');}
          active=next;used=0;
        };
        try{await withinProgressBudget(replace(),180000-(Date.now()-started));}catch(error){closed=true;throw error;}
      }
      const context=active;if(context===undefined)throw new Error('Explorer context has ended');
      used++;await context.sweep(slug,out,used,started);
    }finally{busy=false;}
  },close:async()=>{if(closed)return;closed=true;await retire();}};
}

/** Retain native HTTP/shader caches across fresh world documents. Clear
 * persistent origin data after retiring each document's writers, matching
 * the original independent input fixtures without accumulating world bodies.
 * @param {import('playwright').Browser} browser @param {string} base
 * @param {string[]} faults @param {{previous:number|undefined}} lifetime
 * @param {number} generation @param {boolean} isolated */
async function openExplorerContext(browser,base,faults,lifetime,generation,isolated){
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,serviceWorkers:'block'});
  try{
    // The existing harness identity suppresses telemetry without request
    // routing, which would disable the native HTTP cache for every asset.
    await context.addInitScript({content:`if(location.origin===${JSON.stringify(new URL(base).origin)}){localStorage.clear();sessionStorage.clear();performance.setResourceTimingBufferSize(8000);performance.addEventListener('resourcetimingbufferfull',()=>{Reflect.set(window,'__explorerTimingFull',true);});${saveFixtureCode({scope:'device',key:'devMode',data:true})};${harnessPinCode({lane:'explorer-smoke'})};}`});
    const page=await context.newPage();
    // WebKit has no CDP. An isolated session owns a fresh context for exactly
    // one catalogue, so retirement replaces all origin storage natively.
    const storage=isolated?null:await context.newCDPSession(page);
    const reset=async()=>{
      // Leaving first retires the old world's dedicated workers and prevents
      // them from publishing into the store after its deletion has completed.
      await page.goto('about:blank',{waitUntil:'domcontentloaded',timeout:30000});
      await storage?.send('Storage.clearDataForOrigin',{origin:new URL(base).origin,
        storageTypes:'cache_storage,indexeddb,local_storage,service_workers,file_systems,websql,storage_buckets,cookies,shared_storage,interest_groups'});
    };
    page.on('pageerror',error=>faults.push(error.message));
    page.on('crash',()=>faults.push('Page crashed'));
    page.on('console',message=>{if(message.type()==='error')faults.push(message.text());});
    page.on('response',response=>{if(response.status()>=400)faults.push(`HTTP ${response.status()}: ${response.url()}`);});
    return {sweep:async(/** @type {string} */slug,/** @type {string} */out,/** @type {number} */catalogue,/** @type {number} */started)=>{
      await sweepPage(page,faults,base,slug,out,lifetime,reset,{generation,catalogue,maxCatalogues:isolated?1:CONTEXT_CATALOGUES},started);
    },close:()=>context.close()};
  }catch(error){await context.close();throw error;}
}

/** Preserve the one-case entry point for focused callers.
 * @param {import('playwright').Browser} browser @param {string} base @param {string} slug @param {string} out @param {boolean} [isolated] */
export async function sweepExplorer(browser,base,slug,out,isolated=false){
  const session=await openExplorerSession(browser,base,isolated);
  try{await session.sweep(slug,out);}finally{await session.close();}
}

/** @param {import('playwright').Page} page @param {string[]} faults @param {string} base @param {string} slug
 * @param {string} out @param {{previous:number|undefined}} lifetime @param {()=>Promise<void>} reset
 * @param {{generation:number,catalogue:number,maxCatalogues:number}} session @param {number} started */
async function sweepPage(page,faults,base,slug,out,lifetime,reset,session,started){
  const hangMs=180000;
  let progressAt=started;
  /** @type {Map<string,number>} */ const firstReady=new Map();
  /** @type {ReturnType<typeof explorerCards>} */ let cards=[];
  try{
    await withinProgressBudget(reset(),hangMs-(Date.now()-progressAt));
    const url=new URL(base);
    for(const [key,value]of Object.entries({chunk:slug,explore:'model',tier:'phone',touch:'1',mute:'1',nolock:'1',sw:'0'}))url.searchParams.set(key,value);
    await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:30000});
    let empty=false,drawn=false;
    /** @type {ReturnType<typeof explorerCapture>|undefined} */ let captured;
    while(Date.now()-progressAt<hangMs){
      if(faults.length>0)throw new Error(faults.join('\n'));
      const state=await withinProgressBudget(page.evaluate(explorerState),hangMs-(Date.now()-progressAt)),observedMs=Date.now()-started;
      // CF5: a software GPU can take longer overall while still drawing new
      // cards. Only a newly drawn identity extends the no-progress hang guard;
      // polling and repeated redraws of the same cards never extend it.
      for(const id of state.readyIds)if(!firstReady.has(id)){firstReady.set(id,observedMs);progressAt=Date.now();}
      if(state.fatal.length>0)throw new Error(`Explorer fatal: ${state.fatal.join('; ')}`);
      if(state.empty||state.ready)verifyExplorerDocument(state.document,base,slug,lifetime.previous);
      if(state.empty||state.ready){
        const snapshot=await withinProgressBudget(page.evaluate(explorerCapture),hangMs-(Date.now()-progressAt));
        if(snapshot.before.fatal.length>0)throw new Error(`Explorer fatal: ${snapshot.before.fatal.join('; ')}`);
        verifyExplorerDocument(snapshot.before.document,base,slug,lifetime.previous);
        verifyExplorerDocument(snapshot.after.document,base,slug,lifetime.previous);
        if(snapshot.before.document.timeOrigin!==state.document.timeOrigin || snapshot.after.document.timeOrigin!==snapshot.before.document.timeOrigin)
          throw new Error('Explorer document changed during pixel validation');
        if(snapshot.before.empty){empty=true;cards=snapshot.cards;captured=snapshot;break;}
        // A readiness notification before this atomic task still waits for
        // its real replacement within the original no-progress budget.
        cards=snapshot.cards;
        if(snapshot.before.ready && cards.length>0 && cards.every(card=>card.ready && card.pixels>0)){captured=snapshot;drawn=true;break;}
      }
      await new Promise(_resolve=>{setTimeout(_resolve,250);});
    }
    if(!empty && !drawn)throw new Error('Explorer catalogue/thumbnail stalled for 180 seconds without progress');
    const failures=explorerFailures(cards);
    if(!empty && cards.length===0)failures.push('Explorer catalogue disappeared');
    if(faults.length>0)failures.push(...faults);
    if(failures.length>0)throw new Error(`${slug}: ${failures.join('; ')}`);
    if(captured===undefined)throw new Error('Missing final Explorer capture');
    const final=captured.after;
    verifyExplorerDocument(final.document,base,slug,lifetime.previous);
    if(final.fatal.length>0)failures.push(...final.fatal);
    if(empty?!final.empty:!final.ready || JSON.stringify(final.readyIds)!==JSON.stringify(cards.map(card=>card.id)) || JSON.stringify(captured.before.readyIds)!==JSON.stringify(cards.map(card=>card.id)))failures.push('Explorer catalogue changed during pixel validation');
    if(faults.length>0)failures.push(...faults);
    const diagnostics=await withinProgressBudget(page.evaluate(explorerDiagnostics),hangMs-(Date.now()-progressAt));
    verifyExplorerDocument(diagnostics.document,base,slug,lifetime.previous);
    if(diagnostics.document.timeOrigin!==final.document.timeOrigin)failures.push('Explorer document changed during final capture');
    if(faults.length>0)failures.push(...faults);
    const result={slug,session,elapsedMs:Date.now()-started,hangMs,empty,cards,failures,document:final.document,captureBefore:captured.before,captureAfter:final,diagnostics,firstReadyMs:Object.fromEntries(firstReady)};
    writeFileSync(join(out,`${slug}.json`),`${JSON.stringify(result,null,2)}\n`);
    if(failures.length>0)throw new Error(`${slug}: ${failures.join('; ')}`);
    lifetime.previous=final.document.timeOrigin;
    console.info(`Explorer ${slug}: ${empty?'explicit empty catalogue':`${cards.length} real thumbnails`} PASS`);
  }catch(error){
    await page.screenshot({path:join(out,`${slug}-failure.jpg`),type:'jpeg',quality:70,timeout:5000}).catch(()=>undefined);
    // Keep the last completed observation. A second unbounded renderer read
    // after the hang refusal would hide the very stall this receipt records.
    writeFileSync(join(out,`${slug}-failure.json`),`${JSON.stringify({slug,session,elapsedMs:Date.now()-started,hangMs,idleMs:Date.now()-progressAt,error:String(error),faults,cards,firstReadyMs:Object.fromEntries(firstReady)},null,2)}\n`);
    throw error;
  }
}

async function main(){
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const option=(/** @type {string} */name)=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
  const out=resolve(option('out')??'boot-smoke-results/explorer');mkdirSync(out,{recursive:true});
  const group=option('case-group')??'all';
  explorerPartition([],group); // Refuse an unknown group before owning a preview or browser.
  const external=option('url');
  if(external===undefined && !existsSync(join(root,'dist/index.html')))throw new Error('Build dist before Explorer smoke');
  const preview=external===undefined?await serve(root,'',true):null,base=external??preview?.url;
  if(base===undefined)throw new Error('Missing exact built dist');
  // CI's software GPU is shared: two simultaneous catalogues contend during
  // shader compilation. Each case retains a bounded no-progress hang guard.
  const pool=browserPool(root,1,process.platform==='darwin'?'metal':'swiftshader');
  try{
    const catalogue=await discoverCatalogue(await pool.browser(0),base),cases=explorerCases(catalogue),selected=explorerPartition(cases,group);
    writeFileSync(join(out,'cases.json'),`${JSON.stringify({catalogue,cases,selection:{group,cases:selected}},null,2)}\n`);
    const session=await openExplorerSession(await pool.browser(0),base);
    try{for(const slug of selected)await session.sweep(slug,out);}finally{await session.close();}
  }finally{try{await pool.close();}finally{preview?.close();}}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
