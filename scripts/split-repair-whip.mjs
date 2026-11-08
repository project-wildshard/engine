import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
/** Observe an actual whip control and its page/server settlement edges.
 * @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base */
export async function run(browser,phone,base) {
  const context=await browser.newContext({...phone,deviceScaleFactor:2}),page=await context.newPage();
  try {
    await saveFixture(context,{scope:'device',key:'devMode',data:true});
    await page.goto(`${base}/?chunk=sunscar-dunes&mute=1&nolock=1&sw=0`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>Reflect.get(window,'__wildshard')?.world!==undefined,undefined,{timeout:90000});
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.waitForFunction(()=>Reflect.get(window,'__wildshard')?.world?.animals.animals.some(row=>row.alive),undefined,{timeout:30000});
    await page.evaluate(()=>{
      const world=Reflect.get(window,'__wildshard').requireWorld(),link=world.player.link;if(link===null)throw new Error('No wire');
      const seen={hits:0,weaponHits:0,localDamage:0,floats:0,hpWritesOutsideRows:0,rowHpWrites:0};Reflect.set(window,'__repairWhip',seen);
      for(const body of world.animals.animals) {
        let hp=body.hp,showing=false;const show=body.showRow.bind(body);
        Object.defineProperty(body,'hp',{configurable:true,get:()=>hp,set:(/** @type {number} */value)=>{hp=value;if(showing)seen.rowHpWrites++;else seen.hpWritesOutsideRows++;}});
        body.showRow=(row,dt)=>{showing=true;try{show(row,dt);}finally{showing=false;}};
      }
      Reflect.get(link,'client').onCombat((/** @type {import('../src/shared/engine/net/messages').NetCombatEvent} */event)=>{if(event.kind==='hit'&&event.confirmFor>0)seen.hits++;});
      world.game.app.events.on('weapon.hit',()=>{seen.weaponHits++;},world.game.levelScope);
      world.game.app.events.on('damage.dealt',({req})=>{if(req.target.tags.includes('actor.creature'))seen.localDamage++;},world.game.levelScope);
      const observer=new MutationObserver(rows=>{for(const row of rows)if(row.target instanceof Element&&row.target.matches('.ws-combat-float.show'))seen.floats++;});
      observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['class']});world.game.levelScope.onDispose(()=>{observer.disconnect();});
    });
    for(let n=0;n<12;n++) {
      await page.evaluate(()=>{
        const {player,animals}=Reflect.get(window,'__wildshard').requireWorld(),body=animals.animals.find(row=>row.alive);if(body===undefined)throw new Error('No whip target');
        player.link?.place?.(body.position.x,body.position.y,body.position.z+3,0);
      });
      await page.waitForTimeout(180);
      await page.evaluate(()=>{
        const {player,animals,game}=Reflect.get(window,'__wildshard').requireWorld(),body=animals.animals.find(row=>row.alive);if(body===undefined)throw new Error('No whip target');
        player.yaw=Math.atan2(player.position.x-body.position.x,player.position.z-body.position.z);player.pitch=-0.15;game.app.input.press('attack');
      });
      await page.waitForTimeout(1000);
      if(await page.evaluate(()=>Reflect.get(window,'__repairWhip').hits>0))break;
    }
    return await page.evaluate(()=>{
      const seen=Reflect.get(window,'__repairWhip');return {ok:seen.hits===1&&seen.weaponHits===1&&seen.localDamage===0&&seen.floats===1&&seen.hpWritesOutsideRows===0&&seen.rowHpWrites>0,...seen};
    });
  } finally {await context.close();}
}
