/// <reference path="../src/client/game/population.merge.d.ts" />
import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
/** Ride a real camp horse into a living wolf's bite; no event or damage is injected.
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
      const world=Reflect.get(window,'__wildshard').requireWorld(),link=world.player.link;
      if(link===null)throw new Error('No wire');
      const client=Reflect.get(link,'client'),seen={bites:0,maxServerPanic:0,maxPagePanic:0,hurt:0,mounted:false,rows:0};Reflect.set(window,'__repairPanic',seen);
      world.game.app.events.on('creature.signal',event=>{if(event.name==='rider-bitten')seen.bites++;},world.game.levelScope);
      client.onFrame((/** @type {import('../src/shared/engine/net/frame').DecodedFrame} */frame)=>{if(frame.ride!==null){seen.mounted=true;seen.rows++;seen.maxServerPanic=Math.max(seen.maxServerPanic,frame.ride[22]??0);}});
      const horse=world.animals.animals.filter(row=>row.kind==='horse'&&row.variant!=='stallion').sort((a,b)=>a.position.distanceToSquared(world.player.position)-b.position.distanceToSquared(world.player.position))[0];
      if(horse===undefined)throw new Error('No camp horse');
      link.place?.(horse.position.x,horse.position.y+0.4,horse.position.z+2,0);
    });
    for(let turn=0;turn<12;turn++) {
      await page.waitForTimeout(350);
      if(await page.evaluate(()=>Reflect.get(window,'__repairPanic').mounted))break;
      await page.evaluate(()=>{const world=Reflect.get(window,'__wildshard').requireWorld();world.game.app.input.press('use');});
    }
    if(!await page.evaluate(()=>Reflect.get(window,'__repairPanic').mounted))return await page.evaluate(()=>({ok:false,reason:'not mounted',...Reflect.get(window,'__repairPanic'),prompts:[...document.querySelectorAll('.ws-prompt')].map(row=>row.textContent)}));
    await page.evaluate(()=>{const world=Reflect.get(window,'__wildshard').requireWorld(),y=Reflect.get(window,'__hf').heightAt(-145,90);world.player.link?.place?.(-145,y+0.4,90,0);});
    await page.waitForFunction(()=>Reflect.get(window,'__wildshard').requireWorld().animals.animals.some(row=>row.kind==='wolf'),undefined,{timeout:20000});
    for(let turn=0;turn<100;turn++) {
      await page.evaluate(()=>{
        const world=Reflect.get(window,'__wildshard').requireWorld(),{player}=world,seen=Reflect.get(window,'__repairPanic');
        seen.maxPagePanic=Math.max(seen.maxPagePanic,player.ride===null?0:Number(Reflect.get(player.ride,'panicT')??0));
        const wolves=world.animals.animals.filter(row=>row.alive&&row.kind==='wolf').sort((a,b)=>a.position.distanceToSquared(player.position)-b.position.distanceToSquared(player.position)),wolf=wolves[0];
        if(wolf===undefined)return;
        if(seen.bites===0)player.link?.place?.(wolf.position.x,wolf.position.y+0.4,wolf.position.z+1.8,0);
      });
      await page.waitForTimeout(350);
      if(await page.evaluate(()=>{const seen=Reflect.get(window,'__repairPanic');return seen.bites>0&&seen.maxServerPanic>0&&seen.maxPagePanic>0;}))break;
    }
    return await page.evaluate(()=>{const seen=Reflect.get(window,'__repairPanic'),r=Reflect.get(window,'__workerClient')?.(),world=Reflect.get(window,'__wildshard').requireWorld(),link=world.player.link,client=link===null?null:Reflect.get(link,'client');return {ok:seen.bites>0&&seen.maxServerPanic>0&&seen.maxPagePanic>0,...seen,hp:r?.hp,closed:r?.closed,position:world.player.position,riding:client?.latest?.ride!==null,wolves:world.animals.animals.filter(row=>row.kind==='wolf').map(row=>({position:row.position,state:row.state}))};});
  } finally {await context.close();}
}
