/// <reference path="../src/client/game/population.merge.d.ts" />
import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
/** Approach a real herd on foot; observe normal production event consumers.
 * @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base */
export async function run(browser,phone,base) {
  const context=await browser.newContext({...phone,deviceScaleFactor:2}),page=await context.newPage();
  try {
    await saveFixture(context,{scope:'device',key:'devMode',data:true});
    await page.goto(`${base}/?chunk=nalati-grasslands&mute=1&nolock=1&sw=0`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>Reflect.get(window,'__wildshard')?.world!==undefined,undefined,{timeout:90000});
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.waitForFunction(()=>Reflect.get(window,'__wildshard')?.world?.animals.animals.some(row=>row.kind==='horse'),undefined,{timeout:30000});
    await page.evaluate(()=>{
      const world=Reflect.get(window,'__wildshard').requireWorld(),seen={signals:/** @type {string[]} */([]),sounds:/** @type {string[]} */([]),knockdowns:0,notices:/** @type {string[]} */([]),shots:0};
      Reflect.set(window,'__repairSignals',seen);
      world.game.app.events.on('creature.signal',event=>{seen.signals.push(event.name);},world.game.levelScope);
      world.game.app.events.on('creature.sound',event=>{seen.sounds.push(event.cue);},world.game.levelScope);
      world.game.app.events.on('creature.knockdown',()=>{seen.knockdowns++;},world.game.levelScope);
      world.game.app.events.on('creature.notice',event=>{seen.notices.push(event.text);},world.game.levelScope);
      world.game.app.events.on('weapon.fired',()=>{seen.shots++;},world.game.levelScope);
      const equipment=world.game.app.equipment;
      equipment?.select('bow',true);
      const y=Reflect.get(window,'__hf').heightAt(81,46);world.player.link?.place?.(81,y+0.4,46,0);
    });
    await page.waitForFunction(()=>Reflect.get(window,'__wildshard')?.world?.animals.animals.some(row=>row.kind==='horse'&&row.variant==='stallion'),undefined,{timeout:15000});
    await page.waitForTimeout(700);
    if(process.argv.includes('--inspect'))return await page.evaluate(()=>{
      const world=Reflect.get(window,'__wildshard').requireWorld(),link=world.player.link;if(link===null)throw new Error('No wire');
      const client=Reflect.get(link,'client');return {ok:true,page:world.animals.animals.filter(row=>row.kind==='horse').map(row=>({id:row.entityId,variant:row.variant,label:row.label,x:row.position.x,z:row.position.z})),wire:[...client.entities.values()].filter(info=>info.initial.kind==='horse').map(info=>({id:info.id,initial:info.initial}))};
    });
    for(let n=0;n<120;n++) {
      await page.evaluate(turn=>{
        const world=Reflect.get(window,'__wildshard').requireWorld(),{player,game}=world;
        const horses=world.animals.animals.filter(row=>row.alive&&row.kind==='horse'&&row.variant==='stallion').sort((a,b)=>a.position.distanceToSquared(player.position)-b.position.distanceToSquared(player.position));
        const stamped=Reflect.get(window,'__repairSignals').signals.includes('stampede');
        if(stamped)horses.sort((a,b)=>b.speed-a.speed);
        const horse=horses[0];if(horse===undefined)return;
        player.link?.place?.(horse.position.x+(stamped?Math.sin(horse.yaw)*1.5:0),horse.position.y+0.4,horse.position.z+(stamped?Math.cos(horse.yaw)*1.5:6),0);
        player.yaw=Math.atan2(player.position.x-horse.position.x,player.position.z-horse.position.z);player.pitch=Math.atan2(horse.position.y+0.9-player.position.y-1.68,Math.hypot(horse.position.x-player.position.x,horse.position.z-player.position.z));player.touchMove.y=0;player.touchSprint=false;
        if(game.app.equipment!==null)game.app.equipment.altHeld=!stamped&&turn%8<6;
      },n);
      await page.waitForTimeout(350);
      if(await page.evaluate(()=>{const seen=Reflect.get(window,'__repairSignals');return seen.signals.includes('stampede')&&seen.knockdowns>0&&seen.sounds.length>0;}))break;
    }
    return await page.evaluate(()=>{
      const seen=Reflect.get(window,'__repairSignals'),r=Reflect.get(window,'__workerClient')?.();return {ok:seen.signals.includes('stampede')&&seen.sounds.length>0&&seen.knockdowns>0,...seen,hits:r?.hits,arrows:r?.owned['held.arrows'],falls:r?.falls,hp:r?.hp,held:Reflect.get(window,'__wildshard').requireWorld().game.app.equipment?.current.id,closed:r?.closed};
    });
  } finally {await context.close();}
}
