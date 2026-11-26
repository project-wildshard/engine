import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {devices} from "../browser-playwright.mjs";
import {developerSettings,saveFixture,NAME_ASKED} from '../debug-settings.mjs';
import {startStallProfile,finishStallProfile,bootTimelineEntries} from './stalls.mjs';
import {bootMemoryMarks,bootMemoryVerdict,liveHeapBytes,releaseDrawnThenRead} from './boot-memory-ratchet.mjs';
import {readBaselines,readCaps} from '../budgets/files.mjs';
import {reportLedger,zoneContentKey} from '../memory/ledgerVerdict.mjs';
import {pinnedContentKeys} from '../shard-size-gate.mjs';
import {enterZone} from '../zone-entry.mjs';

// Readiness is bounded by progress, not one flat number (engine red 44847945386, 2026-11-20). The old 235 s came from
// six hosted *total* loads (98-166 s, setup and the memory reads included); readiness itself was never logged. On
// 2026-11-20 the Ubuntu job's totals ran 138-301 s over thirteen greens and two runs hit 235 s still loading.
// On SwiftShader the boot's longest stage is firstFrame: 13.6 s of a 27 s local load (M-series), and the hosted
// runner loads about 8.4x slower (227 s against 27 s), so about 115 s for that one stage, with the page busy.
// A boot that finishes no stage and draws no frame for NINE_STALL_MS is hung; one that keeps moving may run to
// NINE_READY_CAP_MS, the 10 min job less its measured non-boot work (up to ~76 s in greens, 33 s setup in the red).
// Each load logs its readiness and stage times, so the next change to these numbers is measured.
// The 1.2 s props-idle gate is unchanged.
export const NINE_STALL_MS=150_000;
export const NINE_READY_CAP_MS=420_000;
const NINE_POLL_MS=5_000,NINE_LOG_MS=30_000,NINE_READ_MS=10_000;

/** One read of the page, run in it: a terminal failure, readiness, and how far the boot has come. Self-contained. */
export function readNineState() {
  const failure=document.querySelector('.ws-load-error');
  const message=failure?.querySelector('p:nth-of-type(2)')?.textContent?.trim();
  const error=failure===null?null:message!==undefined&&message!==''?message:'Terminal load failure screen opened';
  const harness=Reflect.get(window,'__wildshard'),world=harness?.world;
  // The one-cell world is a grid page: it plays `platform.grid`, and the cell it stands in is the grid's `inside`.
  const zone=harness?.shard?.grid?.state?.().inside??world?.game.level.id;
  const ready=zone==='nine-dragon-stack'&&world.game.frameCount>0&&world.hud.entered&&!world.hud.paused&&world.game.frameGate()&&!document.querySelector('.ws-load');
  const timing=Reflect.get(globalThis,'__bootTiming'),read=timing===undefined?undefined:Reflect.get(timing,'read');
  const data=typeof read==='function'?read.call(timing):timing,entries=data===undefined||data===null?[]:Reflect.get(data,'entries');
  const rows=Array.isArray(entries)?entries:[];
  return {error,ready,frames:world?.game?.frameCount??0,done:rows.filter(row=>row.end!==null).length,
    open:rows.filter(row=>row.end===null&&String(row.operation).startsWith('stage:')).map(row=>String(row.operation))};
}

/** @typedef {{error:string|null,ready:boolean,frames:number,done:number,open:string[]}} NineState */
/** Wait for Nine's readiness while the boot keeps moving: fail when it stalls for `stallMs` or passes `capMs`.
 * `read` gives null when the page did not answer in time; that is not progress.
 * @param {()=>Promise<NineState|null>} read
 * @param {{now?:()=>number,sleep?:(ms:number)=>Promise<void>,log?:(line:string)=>void,stallMs?:number,capMs?:number}} [options]
 * @returns {Promise<{readinessMs:number,last:NineState}>} */
export async function waitNineReady(read,options={}) {
  const {now=Date.now,sleep=ms=>new Promise(resolve=>{setTimeout(resolve,ms);}),log=line=>{console.log(line);},stallMs=NINE_STALL_MS,capMs=NINE_READY_CAP_MS}=options;
  const start=now();
  /** @type {NineState|null} */ let last=null;
  let moved=start,logged=start,mark='';
  const where=()=>last===null?'no answer from the page':`stage ${last.open.at(-1)??'(none open)'}, ${last.done} boot steps done, ${last.frames} frames`;
  const fail=(/** @type {string} */message)=>Object.assign(new Error(message),{nine:{readinessMs:now()-start,last}});
  for(;;){
    const state=await read(),at=now();
    if(state!==null){
      if(state.error!==null)throw fail(`Nine boot failed: ${state.error}`);
      if(state.ready)return {readinessMs:at-start,last:state};
      const key=`${state.done}/${state.frames}`;
      if(key!==mark){mark=key;moved=at;}
      last=state;
    }
    if(at-logged>=NINE_LOG_MS){logged=at;log(`nine-load ${Math.round((at-start)/1000)} s: ${where()}`);}
    if(at-moved>=stallMs)throw fail(`Nine boot made no progress for ${Math.round((at-moved)/1000)} s (${where()})`);
    if(at-start>=capMs)throw fail(`Nine boot not ready after ${Math.round((at-start)/1000)} s (${where()})`);
    await sleep(NINE_POLL_MS);
  }
}

// QA 11-25 row 115: nine-load read Nine's boot memory at its first readiness poll after control, while the home's
// after-control build ran: on Metal the boot is ready in about 4 s and that build then runs about 6 s (CPU geometry climbs
// to 47 MB and settles near 6), so one build read 9.8 MB and 237 MB on one run and 23.6 MB and 313 MB on the next. The read
// waits until the scene's CPU geometry has held still for NINE_SETTLE_MS, at most NINE_SETTLE_CAP_MS (hosted SwiftShader
// settles in its first window; the cap keeps the 10 min job inside its readiness cap plus non-boot work).
export const NINE_SETTLE_MS=3_000,NINE_SETTLE_CAP_MS=45_000;
const NINE_SETTLE_POLL_MS=500;

/** Wait until `read` (the scene's retained CPU geometry; null when the page did not answer) gives one value for `settleMs`,
 * or `capMs` passes. A null read is never still.
 * @param {()=>Promise<number|null>} read
 * @param {{now?:()=>number,sleep?:(ms:number)=>Promise<void>,settleMs?:number,capMs?:number,pollMs?:number}} [options]
 * @returns {Promise<{settled:boolean,waitedMs:number,retained:number|null}>} */
export async function waitNineSettled(read,options={}) {
  const {now=Date.now,sleep=ms=>new Promise(resolve=>{setTimeout(resolve,ms);}),settleMs=NINE_SETTLE_MS,capMs=NINE_SETTLE_CAP_MS,pollMs=NINE_SETTLE_POLL_MS}=options;
  const start=now();
  /** @type {number|null} */ let last=null;
  let since=start;
  for(;;){
    const value=await read(),at=now();
    if(value===null||value!==last){last=value;since=at;}
    else if(at-since>=settleMs)return {settled:true,waitedMs:at-start,retained:value};
    if(at-start>=capMs)return {settled:false,waitedMs:at-start,retained:value};
    await sleep(pollMs);
  }
}

/** NB6's actual standalone props boot, independent of screenshot and street
 * work. A fresh phone, real readiness, and the stock CPU-profile stall gate.
 * @param {import('playwright').Browser} browser @param {string} base @param {string} out */
export async function assertNineLoad(browser,base,out,/** @type {Parameters<typeof waitNineReady>[1]} */ wait={}) {
  const context=await browser.newContext({...devices['iPhone 16 Pro'],viewport:{width:402,height:874},deviceScaleFactor:2});
  /** @type {string[]} */ const faults=[];
  const started=Date.now();
  try {
    await developerSettings(context,{tier:'phone',volume:0});
    await saveFixture(context,NAME_ASKED);
    await saveFixture(context,{scope:'device',key:'firstPlayDone',data:true});
    const page=await context.newPage();
    page.on('pageerror',error=>faults.push(error.message));
    const profile=await startStallProfile(page);
    if(profile===null)throw new Error('Nine load ratchet requires a Chromium CPU profile');
    try {
      // J522 (CP22 deleted the chunk param): a measure of one zone enters it alone, as a one-cell world, through the tap's path
      await enterZone(page,{zone:'nine-dragon-stack',base,flags:{skipintro:'1',tier:'phone',touch:'1',mute:'1',nolock:'1',sw:'0'},alone:true,waitUntil:'domcontentloaded',timeout:30_000});
      // A busy page may not answer a read in time; that read is null, never progress.
      const readNine=()=>Promise.race([page.evaluate(readNineState).catch(()=>null),
        new Promise(resolve=>{setTimeout(()=>{resolve(null);},NINE_READ_MS);})]);
      const {readinessMs}=await waitNineReady(/** @type {()=>Promise<NineState|null>} */ (readNine),wait);
      const entries=await page.evaluate(bootTimelineEntries);
      const stagesMs=Object.fromEntries(entries.filter(row=>row.operation.startsWith('stage:')&&row.end!==null)
        .map(row=>[row.operation.slice(6),Math.round(Number(row.end)-row.start)]));
      console.log(`nine-load ready in ${Math.round(readinessMs/1000)} s; stages ${JSON.stringify(stagesMs)}`);
      const read=await finishStallProfile(page,profile);
      faults.push(...read.faults);
      if(!read.stalls.some(row=>row.stage==='props'))faults.push('Nine load has no completed props stage');
      const state=await page.evaluate(()=>{const world=window.__wildshard.requireWorld();return {shard:world.game.level.id,frames:world.game.frameCount,entered:world.hud.entered};});
      // QA 11-25 row 115: the boot's memory is read once its after-control build has settled, not mid-way through it.
      // QA 11-25 row 122: each read first lets every drawn, unchanged geometry's CPU copy go (`releaseDrawn`, what play
      // does after 240 renders): a hosted SwiftShader page draws a frame every few seconds, so its read caught the
      // after-control build's copies still waiting on those renders (12.06 to 15.38 MB, retained plus released constant)
      let releasedAfter=0;
      const readRetained=()=>Promise.race([page.evaluate(releaseDrawnThenRead).then(got=>{
        if(got===null)return null;releasedAfter+=got.released;return got.retained;}).catch(()=>null),
        new Promise(resolve=>{setTimeout(()=>{resolve(null);},NINE_READ_MS);})]);
      const settle=await waitNineSettled(/** @type {()=>Promise<number|null>} */ (readRetained));
      console.log(`nine-load memory read ${settle.settled?'settled':'not settled'} ${Math.round(settle.waitedMs/1000)} s after readiness; ${(releasedAfter/1e6).toFixed(2)} MB of drawn CPU copies let go before it`);
      // mini QA 2026-11-17 row 19: the boot's memory cuts hold (boot-memory-ratchet.mjs)
      const heap=await page.context().newCDPSession(page);
      let memory;
      try {
        const marks=await page.evaluate(bootMemoryMarks);
        const got=await page.evaluate(releaseDrawnThenRead);
        if(got!==null)releasedAfter+=got.released;
        const retained=got?.retained??null;
        const judging={contentKey:zoneContentKey('nine-dragon-stack',pinnedContentKeys()),budgets:{caps:readCaps(),baselines:readBaselines()}};
        memory=bootMemoryVerdict(marks,retained,await liveHeapBytes(heap),judging);
      } finally {await heap.detach().catch(()=>undefined);}
      faults.push(...memory.faults);
      // BUDGET-CAPS BC11: the two boot budgets in one table and budget-measures.json; the budgets workflow judges them
      reportLedger({rows:memory.rows,mode:'nine-boot',directory:out,commit:process.env.GITHUB_SHA,summaryFile:process.env.GITHUB_STEP_SUMMARY});
      const receipt={...state,elapsedMs:Date.now()-started,readinessMs,stagesMs,stalls:read.stalls,settle,releasedAfter,memory,faults};
      writeFileSync(join(out,'load.json'),`${JSON.stringify(receipt,null,2)}\n`);
      console.log(JSON.stringify(receipt));
      if(faults.length>0)throw new Error(faults.join('; '));
    } catch(error) {
      // Timeout used to discard all evidence before the props profile ran.
      // Preserve the original failure even if the unresponsive page cannot
      // supply a timeline. Context closure still drains the browser work.
      const timeline=await Promise.race([
        page.evaluate(bootTimelineEntries).catch(()=>null),
        new Promise(resolve=>{setTimeout(()=>{resolve(null);},5000);}),
      ]);
      const nine=error instanceof Error?Reflect.get(error,'nine'):undefined;
      writeFileSync(join(out,'load-error.json'),`${JSON.stringify({elapsedMs:Date.now()-started,stallMs:NINE_STALL_MS,capMs:NINE_READY_CAP_MS,
        readinessMs:nine?.readinessMs,last:nine?.last??null,error:error instanceof Error?error.message:String(error),faults,timeline},null,2)}\n`);
      throw error;
    } finally {await profile.detach().catch(()=>undefined);}
  } finally {await context.close();}
}
