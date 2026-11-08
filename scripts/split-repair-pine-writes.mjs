import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
import { paidSave } from './worker-client-pine.mjs';
/** Real shot, carcass use and worker save/reload; fixture supplies starting pack only.
 * @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base */
export async function run(browser,phone,base) {
  const context=await browser.newContext({...phone,deviceScaleFactor:2}),page=await context.newPage();
  try {
    await saveFixture(context,{scope:'device',key:'devMode',data:true});
    const seed=paidSave('hind');
    await saveFixture(context,{scope:'standalone-lone-pine-hollow',key:'continuation',once:'repair-harvest',data:seed.save});
    const enter=async()=>{
      await page.waitForFunction(()=>Reflect.get(window,'__wildshard')?.world!==undefined,undefined,{timeout:90000});
      await page.evaluate(FLOOR_GRID_ENTER);
      await page.waitForFunction(()=>(Reflect.get(window,'__workerClient')?.().frames??0)>30);
    };
    await page.goto(`${base}/?chunk=pine-hollow&mute=1&nolock=1&sw=0`,{waitUntil:'domcontentloaded'});await enter();
    await page.waitForFunction(()=>Reflect.get(window,'__wildshard')?.world?.animals.animals.some(row=>row.kind==='deer'),undefined,{timeout:30000});
    await page.evaluate(({x,z})=>{
      const world=Reflect.get(window,'__wildshard').requireWorld();
      const body=world.animals.animals.filter(row=>row.kind==='deer').sort((a,b)=>Math.hypot(a.position.x-x,a.position.z-z)-Math.hypot(b.position.x-x,b.position.z-z))[0];
      if(body===undefined)throw new Error('Seeded deer was not projected');Reflect.set(window,'__repairDeer',body.entityId);
    },seed.target);
    await page.evaluate(()=>Reflect.get(window,'__workerClientHits')?.(60));
    let corpse=null;
    for(let n=0;n<30;n++) {
      corpse=await page.evaluate(()=>{
        const world=Reflect.get(window,'__wildshard').requireWorld(),{player}=world;
        const body=world.animals.animals.find(row=>row.entityId===Reflect.get(window,'__repairDeer'));if(body===undefined)return null;
        const {x,y,z}=body.position;player.link?.place?.(x,y,z+5,0);
        return {x,y,z,alive:body.alive};
      });
      if(corpse!==null&&!corpse.alive)break;
      await page.waitForTimeout(150);
      if(corpse!==null)await page.evaluate(({x,y,z})=>{
        const {player,game}=Reflect.get(window,'__wildshard').requireWorld();
        player.yaw=Math.atan2(player.position.x-x,player.position.z-z);player.pitch=Math.atan2(y+0.9-player.position.y-1.68,Math.hypot(x-player.position.x,z-player.position.z));
        game.app.input.press('attack');
      },corpse);
      await page.waitForTimeout(250);
    }
    if(corpse===null||corpse.alive)throw new Error('Real fixture deer did not die');
    await page.keyboard.press('KeyR');
    await page.waitForFunction(()=>(Reflect.get(window,'__workerClient')?.().owned['ammo.iron']??31)<31,undefined,{timeout:5000});
    console.log(await page.evaluate(()=>{const r=Reflect.get(window,'__workerClient')?.();return {shot:{hits:r?.hits,falls:r?.falls,held:r?.held,ammo:r?.owned['ammo.iron']},target:Reflect.get(window,'__repairDeer')};}));
    await page.evaluate(({x,y,z})=>{
      const {player}=Reflect.get(window,'__wildshard').requireWorld();player.link?.place?.(x,y,z+1.5,0);player.yaw=0;player.pitch=-0.5;
    },corpse);
    await page.waitForTimeout(600);
    console.log(await page.evaluate(()=>({prompt:Reflect.get(window,'__wildshard').requireWorld().hud.promptText})));
    await page.evaluate(()=>Reflect.get(window,'__wildshard').requireWorld().game.app.input.press('use'));
    await page.waitForTimeout(4000);
    const harvested=await page.evaluate(()=>Reflect.get(window,'__workerClient')?.().owned['item.deer-hide']??0);
    await page.evaluate(()=>Reflect.get(window,'__workerClientSave')?.());
    console.log(await page.evaluate(()=>{const r=Reflect.get(window,'__workerClient')?.();return {save:{ok:r?.savedOk,tick:r?.savedTick,hide:r?.owned['item.deer-hide']}};}));
    await page.reload({waitUntil:'domcontentloaded'});await enter();await page.waitForTimeout(1500);
    console.log(await page.evaluate(()=>{const r=Reflect.get(window,'__workerClient')?.();return {back:{restored:r?.restored,hide:r?.owned['item.deer-hide'],ammo:r?.owned['ammo.iron']}};}));
    const restored=await page.evaluate(()=>Reflect.get(window,'__workerClient')?.().owned['item.deer-hide']??0);
    const before=await page.evaluate(()=>Reflect.get(window,'__workerClient')?.());
    const end=Date.now()+45000;
    while(Date.now()<end&&(await page.evaluate(()=>Reflect.get(window,'__workerClient')?.().falls))===before?.falls) {
      await page.evaluate(()=>{
        const world=Reflect.get(window,'__wildshard').requireWorld();
        const bear=world.animals.animals.find(row=>row.alive&&row.kind==='bear');
        if(bear===undefined){world.player.link?.place?.(192,9,188,0);return;}
        world.player.link?.place?.(bear.position.x,bear.position.y,bear.position.z+1,Math.PI);
      });
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(7000);
    const dead=await page.evaluate(()=>Reflect.get(window,'__workerClient')?.());
    await page.waitForTimeout(1000);
    const next=await page.evaluate(()=>Reflect.get(window,'__workerClient')?.().owned['ammo.iron']);
    return {ok:harvested===1&&restored===1&&(dead?.falls??0)>(before?.falls??0)&&dead?.owned['ammo.iron']===31&&next===31,harvested,restored,spent:before?.owned['ammo.iron'],falls:dead?.falls,respawn:dead?.owned['ammo.iron'],next};
  } finally {await context.close();}
}
