/// <reference path="../src/client/game/population.merge.d.ts" />
import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
/** Wait beside the guardian for the authored 150–240 second pasture raid.
 * Only the player is placed; no creature, clock or event is changed.
 * SR12: the page's own flock grazes here, so its FlockBrain bleats (onSound -> pageCrowds -> creature.sound sheep_bleat):
 * a page-only cue: the guardian's server outputs carry the bark, never a bleat.
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
      const world=Reflect.get(window,'__wildshard').requireWorld(),link=world.player.link,client=link===null?null:Reflect.get(link,'client'),seen={barks:0,first:0,start:performance.now(),tick:client?.latest?.tick??0,outputs:0,bleats:0};Reflect.set(window,'__repairGuardian',seen);
      world.game.app.events.on('creature.sound',event=>{if(event.cue==='sheep_bleat')seen.bleats++;if(event.cue==='dog_bark'){if(seen.barks===0)seen.first=performance.now()-seen.start;seen.barks++;}},world.game.levelScope);
      client?.onView((/** @type {import('../src/shared/engine/net/messages').NetView} */view)=>{if(view.name==='creature.output:emit')seen.outputs++;});
      const y=Reflect.get(window,'__hf').heightAt(-105,212);world.player.link?.place?.(-105,y+0.4,212,0);
    });
    await page.waitForFunction(()=>Reflect.get(window,'__repairGuardian').barks>=3,undefined,{timeout:360000}).catch(()=>undefined);
    return await page.evaluate(()=>{const seen=Reflect.get(window,'__repairGuardian'),r=Reflect.get(window,'__workerClient')?.(),world=Reflect.get(window,'__wildshard').requireWorld(),link=world.player.link,client=link===null?null:Reflect.get(link,'client');return {ok:seen.barks>=3&&seen.bleats>0,barks:seen.barks,bleats:seen.bleats,outputs:seen.outputs,firstMs:Math.round(seen.first),elapsedMs:Math.round(performance.now()-seen.start),ticks:(client?.latest?.tick??0)-seen.tick,closed:r?.closed,hp:r?.hp,falls:r?.falls,wolves:world.animals.animals.filter(row=>row.kind==='wolf').length};});
  } finally {await context.close();}
}
