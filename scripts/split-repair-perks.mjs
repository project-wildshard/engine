import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
/** Real shop command, server ownership and owner frame; no synthetic events.
 * @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base */
export async function run(browser,phone,base) {
  const context=await browser.newContext({...phone,deviceScaleFactor:2}),page=await context.newPage();
  try {
    await saveFixture(context,{scope:'device',key:'devMode',data:true});
    await saveFixture(context,{scope:'driftwood-isle',key:'purse',data:100,once:'repair-coins'});
    await page.goto(`${base}/?chunk=driftwood-isle&tier=phone&mute=1&nolock=1&sw=0`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof Reflect.get(window,'__workerClient')==='function',undefined,{timeout:60000});
    await page.waitForFunction(()=>Reflect.get(window,'__wildshard')?.world!==undefined,undefined,{timeout:60000});
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.waitForFunction(()=>(Reflect.get(window,'__workerClient')?.().frames??0)>10,undefined,{timeout:30000});
    await page.evaluate(()=>{
      const link=Reflect.get(window,'__wildshard').requireWorld().player.link;
      if(link===null)throw new Error('Missing wire');
      const hits=/** @type {number[]} */([]);Reflect.set(window,'__repairHits',hits);
      Reflect.get(link,'client').onCombat((/** @type {import('../src/shared/engine/net/messages').NetCombatEvent} */event)=>{if(event.kind==='hit'&&event.confirmFor>0)hits.push(event.amount);});
    });
    const strike=async()=>{
      await page.waitForTimeout(2200);
      const before=await page.evaluate(()=>Reflect.get(window,'__repairHits').length);
      for(let n=0;n<12;n++) {
        await page.evaluate(()=>{
          const world=Reflect.get(window,'__wildshard').requireWorld(),{player}=world;
          const body=world.animals.animals.find(row=>row.alive&&row.kind==='boar');if(body===undefined)throw new Error('No boar');
          player.link?.place?.(body.position.x,body.position.y,body.position.z+1.7,0);
        });
        await page.waitForTimeout(150);
        await page.evaluate(()=>{
          const world=Reflect.get(window,'__wildshard').requireWorld(),{player}=world;
          const body=world.animals.animals.find(row=>row.alive&&row.kind==='boar');if(body===undefined)throw new Error('No boar');
          player.yaw=Math.atan2(player.position.x-body.position.x,player.position.z-body.position.z);player.pitch=-0.15;
          world.game.app.input.press('attack');
        });
        await page.waitForTimeout(850);
        const hits=await page.evaluate(()=>Reflect.get(window,'__repairHits'));
        if(hits.length>before)return hits[before];
      }
      throw new Error('Real sword never connected');
    };
    const plain=await strike();
    await page.evaluate(()=>{
      const probe=Reflect.get(window,'__wildshard');
      const loot=/** @type {{shop:{open:()=>void;close:()=>void;o:{goods:{id:string}[]};onBuy:(good:{id:string})=>boolean}}} */(Reflect.get(probe.shard,'driftwood.loot'));
      loot.shop.open();
      const good=loot.shop.o.goods.find(row=>row.id==='heart-1');
      if(good===undefined || !loot.shop.onBuy(good)) throw new Error('Real shop refused sturdy heart');
      loot.shop.close();
    });
    await page.waitForFunction(()=>(Reflect.get(window,'__workerClient')?.().owned['own.heart-1']??0)>0,undefined,{timeout:5000});
    const values=await page.evaluate(()=>{
      const probe=Reflect.get(window,'__wildshard');
      const report=Reflect.get(window,'__workerClient')?.();if(report===undefined)throw new Error('Missing worker');
      const world=probe.requireWorld(),link=world.player.link;if(link===null)throw new Error('Missing player wire');
      const client=Reflect.get(link,'client');
      const owner=client.owner(client.latest);
      return {server:owner.maxHp??null,hp:owner.hp,page:world.game.app.player?.attributes.maxHealth,owned:report.owned,closed:report.closed};
    });
    await page.evaluate(()=>{
      const loot=/** @type {{shop:{open:()=>void;close:()=>void;o:{goods:{id:string}[]};onBuy:(good:{id:string})=>boolean}}} */(Reflect.get(Reflect.get(window,'__wildshard').shard,'driftwood.loot')),shop=loot.shop;
      const good=shop.o.goods.find((/** @type {{id:string}} */row)=>row.id==='whetstone-1');
      shop.open();if(good===undefined||!shop.onBuy(good))throw new Error('Whetstone purchase refused');shop.close();
    });
    await page.waitForFunction(()=>(Reflect.get(window,'__workerClient')?.().owned['own.whetstone-1']??0)>0);
    const sharpened=await strike();
    return {ok:values.server===120&&values.page===120&&values.closed===null&&sharpened===plain*1.25,...values,plain,sharpened};
  } catch(error) {
    console.log(await page.evaluate(()=>({fatal:[...document.querySelectorAll('#wserr,.ws-load-error')].map(node=>node.textContent),loading:document.querySelector('.ws-load')?.textContent?.slice(-600),active:Reflect.get(window,'__bootTiming')?.read().active,probe:typeof Reflect.get(window,'__wildshard')})).catch(()=>null));
    throw error;
  } finally {await context.close();}
}
