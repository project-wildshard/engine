import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
/** A normal crossbow bolt hits a page-owned ambient hare, never a server row.
 * @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base */
export async function run(browser,phone,base) {
  const context=await browser.newContext({...phone,deviceScaleFactor:2}),page=await context.newPage();
  try {
    await saveFixture(context,{scope:'device',key:'devMode',data:true});
    await page.goto(`${base}/?chunk=pine-hollow&mute=1&nolock=1&sw=0`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>Reflect.get(window,'__wildshard')?.world!==undefined,undefined,{timeout:90000});
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.waitForFunction(()=>Reflect.get(window,'__pineLife')?.hares?.length>0,undefined,{timeout:30000});
    await page.evaluate(()=>{
      const world=Reflect.get(window,'__wildshard').requireWorld(),seen={aimed:false,retired:false,shots:0,contacts:/** @type {unknown[]} */([])};Reflect.set(window,'__repairHare',seen);
      if(typeof world.crossbow!=='object'||world.crossbow===null)throw new Error('No crossbow');
      const real=Reflect.get(world.crossbow,'boltHit').bind(world.crossbow);
      Reflect.set(world.crossbow,'boltHit',(/** @type {{shot:number}} */bolt,/** @type {import('../src/client/engine/combat/types').TargetHit} */hit,/** @type {import('three').Vector3} */dir)=>{
        seen.contacts.push({kind:hit.animal.kind,local:hit.animal.presentationOnly===true,shot:bolt.shot});return real(bolt,hit,dir);
      });
    });
    for(let n=0;n<12;n++) {
      await page.evaluate(()=>{
        const {player}=Reflect.get(window,'__wildshard').requireWorld(),hare=Reflect.get(window,'__pineLife').hares[0];
        const height=Reflect.get(window,'__hf').heightAt(hare.x,hare.z+18);player.link?.place?.(hare.x,height,hare.z+18,0);player.touchMove.y=0;player.touchSprint=false;
      });
      await page.waitForTimeout(180);
      const aimed=await page.evaluate(()=>{
        const world=Reflect.get(window,'__wildshard').requireWorld(),{player,game}=world,hare=Reflect.get(window,'__pineLife').hares[0];
        const y=Reflect.get(window,'__hf').heightAt(hare.x,hare.z)+0.2;
        player.yaw=Math.atan2(player.position.x-hare.x,player.position.z-hare.z);player.pitch=Math.atan2(y-player.position.y-1.68,Math.hypot(hare.x-player.position.x,hare.z-player.position.z));
        return game.app.equipment?.current.state.loaded ?? false;
      });
      if(!aimed){await page.keyboard.press('KeyR');await page.waitForTimeout(1200);continue;}
      await page.waitForTimeout(50);
      await page.evaluate(()=>{
        const world=Reflect.get(window,'__wildshard').requireWorld(),{player,game}=world,aim=player.sampleAimCommand();
        const from=game.camera.position.clone().set(aim.origin.x,aim.origin.y,aim.origin.z),dir=from.clone().set(aim.direction.x,aim.direction.y,aim.direction.z);
        if(typeof world.crossbow!=='object'||world.crossbow===null)throw new Error('No crossbow');
        const hit=Reflect.get(world.crossbow,'targets').raycast(from,dir,30),seen=Reflect.get(window,'__repairHare');
        if(hit?.animal.kind==='hare') {
          seen.aimed=true;const real=hit.animal.applyDamage.bind(hit.animal);
          hit.animal.applyDamage=(/** @type {number} */amount,/** @type {import('three').Vector3} */point,/** @type {import('three').Vector3} */direction)=>{const killed=real(amount,point,direction);if(killed)seen.retired=true;return killed;};
          const distance=Math.hypot(hit.point.x-player.position.x,hit.point.z-player.position.z);
          player.pitch=Math.atan2(hit.point.y+4.9*(distance/62)**2-player.position.y-1.68,distance);
        }
      });
      await page.waitForTimeout(50);
      await page.evaluate(()=>{Reflect.get(window,'__wildshard').requireWorld().game.app.input.press('attack');Reflect.get(window,'__repairHare').shots++;});
      await page.waitForTimeout(500);
      if(await page.evaluate(()=>Reflect.get(window,'__repairHare').retired))break;
    }
    return await page.evaluate(()=>{const seen=Reflect.get(window,'__repairHare');return {ok:seen.aimed&&seen.retired,...seen};});
  } finally {await context.close();}
}
