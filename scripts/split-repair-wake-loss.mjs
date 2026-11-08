import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
/** Real Pine boss entry and death. Night is selected through the shipped Debug control.
 * @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base */
export async function run(browser,phone,base) {
  const context=await browser.newContext({...phone,deviceScaleFactor:2}),page=await context.newPage();
  try {
    await saveFixture(context,{scope:'device',key:'devMode',data:true});
    await page.goto(`${base}/?chunk=pine-hollow&mute=1&nolock=1&sw=0`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>Reflect.get(window,'__wildshard')?.world!==undefined,undefined,{timeout:90000});
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.waitForFunction(()=>(Reflect.get(window,'__workerClient')?.().frames??0)>30);
    await page.evaluate(()=>{
      const world=Reflect.get(window,'__wildshard').requireWorld(),seen={outcomes:/** @type {string[]} */([]),deaths:0,engaged:false};Reflect.set(window,'__repairWake',seen);
      world.game.app.events.on('boss.attempt',event=>{seen.outcomes.push(event.outcome);},world.game.levelScope);
      world.game.app.events.on('player.died',()=>{seen.deaths++;},world.game.levelScope);
      Reflect.get(window,'__workerClientTime')?.('night');
      const y=Reflect.get(window,'__hf').heightAt(154,-30);world.player.link?.place?.(154,y+0.4,-30,0);
    });
    const end=Date.now()+65000;
    while(Date.now()<end) {
      const done=await page.evaluate(()=>{
        const world=Reflect.get(window,'__wildshard').requireWorld(),seen=Reflect.get(window,'__repairWake');
        const row=Reflect.get(window,'__workerClientFights')?.().find(value=>value.id==='pine.king');
        if(row?.state==='fight'||row?.state==='beat')seen.engaged=true;
        if(seen.deaths>0)return true;
        if(row?.at!==undefined&&row.at!==null&&seen.engaged)world.player.link?.place?.(row.at.x,row.at.y+0.4,row.at.z+1.5,0);
        return false;
      });
      if(done)break;await page.waitForTimeout(350);
    }
    await page.waitForTimeout(2000);
    return await page.evaluate(()=>{const seen=Reflect.get(window,'__repairWake');return {ok:seen.engaged&&seen.deaths>0&&seen.outcomes.includes('lost'),...seen};});
  } finally {await context.close();}
}
