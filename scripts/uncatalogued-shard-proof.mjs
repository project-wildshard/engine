// LS8: a real built page refuses an unlisted world before downloading another world.
// Kept outside hooks/test globs. Build preparation is Ring 2; each refusal is under ten seconds.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {browserPool} from './parity/pool.mjs';
import {serve} from './parity/serve.mjs';

/** @param {import('playwright').Browser} browser @param {string} base @param {string} slug */
export async function uncataloguedShardCase(browser,base,slug) {
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,serviceWorkers:'block'});
  const page=await context.newPage(),cdp=await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  /** @type {string[]} */ const discoveries=[];
  /** @type {string[]} */ const errors=[];
  let navigations=0;
  page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/discovery.json'))discoveries.push(request.url());});
  page.on('pageerror',error=>{errors.push(error.message);});
  page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
  const url=new URL(base);
  for(const [key,value] of Object.entries({chunk:slug,tier:'phone',touch:'1',mute:'1',nolock:'1',sw:'0'}))url.searchParams.set(key,value);
  const started=Date.now(),deadline=started+8000;
  try {
    await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:8000});
    await page.locator('.ws-main-notice').waitFor({state:'visible',timeout:Math.max(1,deadline-Date.now())});
    const notice=await page.locator('.ws-main-notice').textContent()??'';
    assert.match(notice,/world.*not listed/iu,'The refusal must explain why this world did not open');
    assert.equal(new URL(page.url()).searchParams.get('chunk'),slug,'A miss must not silently select another URL');
    assert.deepEqual(discoveries,[],'A refused URL must not download a substitute world');
    assert.deepEqual(errors,[]);assert.equal(navigations,1,'A catalogue miss must not retry the same invalid request');
    const ms=Date.now()-started;assert.ok(ms<10000,`Refusal took ${ms} ms`);
    return {slug,ms,notice,discoveries,navigations,cpuRate:4};
  } catch(error) {
    throw new Error(JSON.stringify({slug,ms:Date.now()-started,discoveries,errors,body:(await page.locator('body').textContent()??'').slice(0,1800)}),{cause:error});
  } finally {await context.close();}
}

if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const root=process.cwd(),out=resolve(process.argv.find(arg=>arg.startsWith('--out='))?.slice(6)??'tmp/uncatalogued-shard');
  mkdirSync(out,{recursive:true});
  const preview=await serve(root,'',true),pool=browserPool(root,1,process.platform==='darwin'?'metal':'swiftshader');
  try {
    const browser=await pool.browser(0),cases=[];
    for(const slug of ['template','not-in-this-catalogue'])cases.push(await uncataloguedShardCase(browser,preview.url,slug));
    writeFileSync(join(out,'refusals.json'),`${JSON.stringify(cases,null,2)}\n`);console.log(JSON.stringify(cases));
  } finally {await pool.close();preview.close();}
}
