import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {devices} from 'playwright';
import {developerSettings,saveFixture,NAME_ASKED} from '../debug-settings.mjs';
import {startStallProfile,finishStallProfile} from './stalls.mjs';

/** NB6's actual standalone props boot, independent of screenshot and street
 * work. A fresh phone, real readiness, and the stock CPU-profile stall gate.
 * @param {import('playwright').Browser} browser @param {string} base @param {string} out */
export async function assertNineLoad(browser,base,out) {
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
      const url=new URL(base);
      for(const [key,value] of Object.entries({chunk:'nine-dragon-stack',skipintro:'1',tier:'phone',touch:'1',mute:'1',nolock:'1',sw:'0'}))url.searchParams.set(key,value);
      await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:30_000});
      await page.waitForFunction(()=>{
        const world=window.__wildshard?.world;
        return world?.game.level.id==='nine-dragon-stack'&&world.game.frameCount>0&&world.hud.entered&&!world.hud.paused&&world.game.frameGate()&&!document.querySelector('.ws-load');
      },null,{timeout:180_000});
      const read=await finishStallProfile(page,profile);
      faults.push(...read.faults);
      if(!read.stalls.some(row=>row.stage==='props'))faults.push('Nine load has no completed props stage');
      const state=await page.evaluate(()=>{const world=window.__wildshard.requireWorld();return {shard:world.game.level.id,frames:world.game.frameCount,entered:world.hud.entered};});
      const receipt={...state,elapsedMs:Date.now()-started,stalls:read.stalls,faults};
      writeFileSync(join(out,'load.json'),`${JSON.stringify(receipt,null,2)}\n`);
      console.log(JSON.stringify(receipt));
      if(faults.length>0)throw new Error(faults.join('; '));
    } finally {await profile.detach().catch(()=>undefined);}
  } finally {await context.close();}
}
