// Clean document measurement: no Developer, harness pins, product census or menu.
import { devices } from 'playwright';
import * as v from 'valibot';
import { launchMemoryBrowser } from '../chromium-memory-browser.mjs';
import { saveFixture } from '../debug-settings.mjs';
import { sampledHeapBytes, majorHeapGCs } from './jsHeap.mjs';

/** @param {string} base @param {'_template'|'blender-template'} shard */
export async function measureCleanHeap(base,shard) {
  const versionSchema=v.object({build:v.pipe(v.string(),v.minLength(1))});
  const version=async()=>{
    const response=await fetch(new URL('/version.json',base),{signal:AbortSignal.timeout(5000),cache:'no-store'});
    if(!response.ok)throw new Error('Heap reading source identity unavailable');
    return v.parse(versionSchema,await response.json()).build;
  };
  const build=await version();
  const owned=await launchMemoryBrowser(['--mute-audio','--use-angle=metal','--ignore-gpu-blocklist']);
  try {
    const context=await owned.browser.newContext({...devices['iPhone 16 Pro'],serviceWorkers:'block'});
    await saveFixture(context,{scope:'device',key:'devMode',data:false});
    await saveFixture(context,{scope:'global',key:'settings',data:{tier:'phone',fps:'auto',volume:0}});
    await saveFixture(context,{scope:'global',key:'gfx',data:{dpr:'2',aa:'auto'}});
    const page=await context.newPage();page.setDefaultTimeout(240000);
    /** @type {string[]} */ const errors=[];
    page.on('pageerror',error=>{errors.push(error.message);});
    const cdp=await context.newCDPSession(page);
    const sampling={samplingInterval:16384,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true};
    await cdp.send('HeapProfiler.enable');await cdp.send('HeapProfiler.startSampling',sampling);
    const route=new URL(base);route.search='';route.searchParams.set('chunk',shard);
    for(const [key,value] of Object.entries({mute:'1',nolock:'1',sw:'0'}))route.searchParams.set(key,value);
    await page.goto(route.href,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(`Boolean(document.querySelector('#wserr .msg')?.textContent)||(!document.querySelector('.ws-load')&&Boolean(window.__wildshard?.world?.game))`);
    const failure=await page.evaluate(`document.querySelector('#wserr .msg')?.textContent??null`);
    if(failure!==null)throw new Error(String(failure));
    await page.evaluate(`window.__wildshard.requireWorld().hud.enterNow()`);
    await page.waitForFunction(`window.__wildshard.requireWorld().game.frameGate()`);
    const boot=await cdp.send('HeapProfiler.stopSampling');
    // Explicit post-GC settled JS heap belongs only to this diagnostic. This
    // mode never calls or qualifies the uncollected native floor reader.
    await cdp.send('HeapProfiler.collectGarbage');
    const settled=await cdp.send('Runtime.getHeapUsage');
    /** @type {unknown[]} */ const events=[];
    const receive=(/** @type {{value:unknown[]}} */ event)=>{events.push(...event.value);};
    cdp.on('Tracing.dataCollected',receive);
    await cdp.send('Tracing.start',{transferMode:'ReportEvents',categories:'devtools.timeline,v8,disabled-by-default-v8.gc'});
    await cdp.send('HeapProfiler.startSampling',sampling);
    const start=performance.now();await page.waitForTimeout(60000);
    const idle=await cdp.send('HeapProfiler.stopSampling'),seconds=(performance.now()-start)/1000;
    const ended=new Promise(resolve=>{cdp.once('Tracing.tracingComplete',resolve);});
    await cdp.send('Tracing.end');await ended;cdp.off('Tracing.dataCollected',receive);
    const clean=v.parse(v.object({pins:v.boolean(),developer:v.boolean(),href:v.string()}),await page.evaluate(`({pins:window.__wildshardHarness!==undefined,developer:JSON.parse(localStorage.getItem('wildshard.save.v2.device')??'{"keys":{}}').keys?.devMode?.data===true,href:location.href})`));
    if(clean.pins||clean.developer||new URL(clean.href).searchParams.get('chunk')!==shard)throw new Error('Heap clean-path admission failed');
    if(errors.length>0)throw new Error(errors.join('\n'));
    if(await version()!==build)throw new Error('Heap reading source changed during measurement');
    return {shard,build,protocol:'chromium-clean-heap/1',idleSeconds:seconds,postGC:true,clean,
      metrics:{bootAllocatedBytes:sampledHeapBytes(boot.profile),settledUsedBytes:settled.usedSize,
        idleBytesPerSecond:sampledHeapBytes(idle.profile)/seconds,majorGCsPer30Seconds:majorHeapGCs(events,seconds)}};
  }finally{await owned.close();}
}
