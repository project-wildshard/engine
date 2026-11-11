import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
/** A real direct heavy control on the shipped Sky Reach fan.
 * @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base */
export async function run(browser,phone,base) {
  const context=await browser.newContext({...phone,deviceScaleFactor:2}),page=await context.newPage();
  try {
    await saveFixture(context,{scope:'device',key:'devMode',data:true});
    await page.goto(`${base}/?chunk=far-reach&mute=1&nolock=1&sw=0`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>Reflect.get(window,'__wildshard')?.world!==undefined,undefined,{timeout:90000});
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.waitForFunction(()=>Reflect.get(window,'__wildshard')?.world?.animals.animals.some(row=>row.alive),undefined,{timeout:30000});
    await page.evaluate(()=>{
      const world=Reflect.get(window,'__wildshard').requireWorld(),link=world.player.link;if(link===null)throw new Error('No wire');
      const client=Reflect.get(link,'client'),command=client.command.bind(client),seen={attacks:0,heavy:0,hits:0,amount:0};Reflect.set(window,'__repairMelee',seen);
      client.command=(/** @type {import('@wildshard/wire/netCommand').NetCommand} */input)=>{
        if(input.attack!==undefined){seen.attacks++;if((input.buttons&128)!==0)seen.heavy++;}return command(input);
      };
      client.onCombat((/** @type {import('../src/shared/engine/net/messages').NetCombatEvent} */event)=>{if(event.kind==='hit'&&event.confirmFor>0){seen.hits++;seen.amount=event.amount;}});
    });
    for(let n=0;n<12;n++) {
      await page.evaluate(()=>{
        const {player,animals}=Reflect.get(window,'__wildshard').requireWorld();
        const body=animals.animals.find(row=>row.alive);if(body===undefined)throw new Error('No fan target');
        player.link?.place?.(body.position.x,body.position.y,body.position.z+2,0);
      });
      await page.waitForTimeout(180);
      await page.evaluate(()=>{
        const {player,animals,game}=Reflect.get(window,'__wildshard').requireWorld();
        const body=animals.animals.find(row=>row.alive);if(body===undefined)throw new Error('No fan target');
        player.yaw=Math.atan2(player.position.x-body.position.x,player.position.z-body.position.z);player.pitch=-0.2;
        game.app.input.press('heavy');
      });
      await page.waitForTimeout(1100);
      if(await page.evaluate(()=>Reflect.get(window,'__repairMelee').hits>0))break;
    }
    return await page.evaluate(()=>{
      const seen=Reflect.get(window,'__repairMelee');return {ok:seen.attacks>0&&seen.hits>0,...seen};
    });
  } finally {await context.close();}
}
