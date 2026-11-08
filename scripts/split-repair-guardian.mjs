/// <reference path="../src/client/game/population.merge.d.ts" />
import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
/** A natural raid brings wolves to the actual guardian. No clock or event is set.
 * The authored first raid is 150–240 seconds; its travel and three barks get 60 more.
 * @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base */
export async function run(browser,phone,base) {
  const context=await browser.newContext({...phone,deviceScaleFactor:2}),page=await context.newPage();
  try {
    await saveFixture(context,{scope:'device',key:'devMode',data:true});
    await page.goto(`${base}/?chunk=nalati-grasslands&mute=1&nolock=1&sw=0`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>Reflect.get(window,'__wildshard')?.world!==undefined,undefined,{timeout:90000});
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.waitForFunction(()=>(Reflect.get(window,'__workerClient')?.().frames??0)>30);
    await page.evaluate(()=>{
      const world=Reflect.get(window,'__wildshard').requireWorld(),seen={barks:0,first:0,start:performance.now()};Reflect.set(window,'__repairGuardian',seen);
      world.game.app.events.on('creature.sound',event=>{if(event.cue==='dog_bark'){if(seen.barks===0)seen.first=performance.now()-seen.start;seen.barks++;}},world.game.levelScope);
      const y=Reflect.get(window,'__hf').heightAt(-105,212);world.player.link?.place?.(-105,y+0.4,212,0);
    });
    await page.waitForFunction(()=>Reflect.get(window,'__repairGuardian').barks>=3,undefined,{timeout:300000}).catch(()=>undefined);
    return await page.evaluate(()=>{const seen=Reflect.get(window,'__repairGuardian'),r=Reflect.get(window,'__workerClient')?.();return {ok:seen.barks>=3,barks:seen.barks,firstMs:Math.round(seen.first),elapsedMs:Math.round(performance.now()-seen.start),closed:r?.closed};});
  } finally {await context.close();}
}
