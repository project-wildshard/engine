import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
/** A real Blackpaw roar, observed at the owner frame and existing status view.
 * @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base */
export async function run(browser,phone,base) {
  const context=await browser.newContext({...phone,deviceScaleFactor:2}),page=await context.newPage();
  try {
    await saveFixture(context,{scope:'device',key:'devMode',data:true});
    await page.goto(`${base}/?chunk=pine-hollow&mute=1&nolock=1&sw=0`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>Reflect.get(window,'__wildshard')?.world!==undefined,undefined,{timeout:60000});
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.waitForFunction(()=>(Reflect.get(window,'__workerClient')?.().frames??0)>10);
    await page.evaluate(()=>{
      const world=Reflect.get(window,'__wildshard').requireWorld();
      world.player.link?.place?.(192,9,188,0);
    });
    const end=Date.now()+25000;let stun=0,icon=false,hp=100,expired=false;
    while(Date.now()<end) {
      if(stun===0)await page.evaluate(()=>{
        const world=Reflect.get(window,'__wildshard').requireWorld();
        const bear=world.animals.animals.find(row=>row.variant==='blackpaw'&&row.alive);
        if(bear!==undefined)world.player.link?.place?.(bear.position.x,bear.position.y,bear.position.z+3,0);
      });
      const seen=await page.evaluate(()=>{
        const world=Reflect.get(window,'__wildshard').requireWorld(),link=world.player.link;if(link===null)throw new Error('Missing wire');
        const client=Reflect.get(link,'client'),owner=client.owner(client.latest);
        return {stun:Number(owner.statusStun??0),hp:Number(owner.hp),icon:document.querySelector('[data-effect="effect.stun"]')!==null};
      });
      hp=seen.hp;stun=Math.max(stun,seen.stun);icon||=seen.icon;
      if(stun>0&&seen.stun===0){expired=true;break;}
      await page.waitForTimeout(50);
    }
    return {ok:stun>1&&icon&&expired,stun,icon,expired,hp};
  } catch(error) {
    console.log(await page.evaluate(()=>({fatal:[...document.querySelectorAll('#wserr,.ws-load-error,pre')].map(node=>node.textContent?.slice(-1000)),loading:document.querySelector('.ws-load')?.textContent?.slice(-500),active:Reflect.get(window,'__bootTiming')?.read().active})).catch(()=>null));throw error;
  } finally {await context.close();}
}
