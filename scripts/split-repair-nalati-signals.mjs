/// <reference path="../src/client/game/population.merge.d.ts" />
import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
/** Approach a real herd on foot; observe normal production event consumers.
 * @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base */
export async function run(browser,phone,base) {
  const context=await browser.newContext({...phone,deviceScaleFactor:2}),page=await context.newPage();
  try {
    await context.addInitScript(()=>{Reflect.set(window,'__wildshardHarness',{seed:18970,capture:null});});
    await saveFixture(context,{scope:'device',key:'devMode',data:true});
    await page.goto(`${base}/?chunk=nalati-grasslands&mute=1&nolock=1&sw=0`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>Reflect.get(window,'__wildshard')?.world!==undefined,undefined,{timeout:90000});
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.mouse.click(5,5); // Real gesture unlocks WebAudio; the URL keeps its master muted.
    await page.waitForFunction(()=>Reflect.get(window,'__wildshard')?.world?.animals.animals.some(row=>row.kind==='horse'),undefined,{timeout:30000});
    await page.evaluate(()=>{
      const world=Reflect.get(window,'__wildshard').requireWorld(),seen={signals:/** @type {string[]} */([]),sounds:/** @type {string[]} */([]),knockdowns:0,notices:/** @type {string[]} */([]),shots:0};
      Reflect.set(window,'__repairSignals',seen);
      Reflect.get(window,'__wildshard').sounds();
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
      const seen=Reflect.get(window,'__repairSignals'),r=Reflect.get(window,'__workerClient')?.(),audio=Reflect.get(window,'__wildshard').sounds().event;return {ok:seen.signals.includes('stampede')&&seen.sounds.length>0&&seen.knockdowns>0&&seen.notices.includes('Stampede!')&&seen.notices.includes('Knocked down!')&&(audio.stampede??0)>0,...seen,audio,hits:r?.hits,arrows:r?.owned['held.arrows'],falls:r?.falls,hp:r?.hp,held:Reflect.get(window,'__wildshard').requireWorld().game.app.equipment?.current.id,closed:r?.closed};
    });
  } finally {await context.close();}
}

/** SR12: a replicated storm reaction reaches its cue. A storm is called up the way a page's sky word goes (`__workerClientSky`);
 * the server's weather program places the strikes, its `weather.*` rows carry each telegraph, NetClimate.sync hands the record
 * to the storm cue's listener, and the cue plays lightningCrackle when the strike is in range of the player.
 * @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base */
export async function storm(browser,phone,base) {
  const context=await browser.newContext({...phone,deviceScaleFactor:2}),page=await context.newPage(),errors=/** @type {string[]} */([]);
  page.on('pageerror',error=>{errors.push(error.message.slice(0,300));});
  try {
    await context.addInitScript(()=>{Reflect.set(window,'__wildshardHarness',{seed:18970,capture:null});});
    await saveFixture(context,{scope:'device',key:'devMode',data:true});
    await page.goto(`${base}/?chunk=nalati-grasslands&mute=1&nolock=1&sw=0`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>Reflect.get(window,'__wildshard')?.world!==undefined,undefined,{timeout:90000});
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.mouse.click(5,5); // Real gesture unlocks WebAudio; the URL keeps its master muted.
    await page.waitForFunction(()=>(Reflect.get(window,'__workerClient')?.().frames??0)>30,undefined,{timeout:90000});
    const read=()=>page.evaluate(()=>{
      const probe=Reflect.get(window,'__wildshard'),world=probe.requireWorld();
      const rig=/** @type {{weather?: {state: string}, storm?: {stormActive: boolean, record: (event: string) => Readonly<Record<string, number>>}} | undefined} */(Object.entries(probe.shard).find(([key])=>key.includes('weather'))?.[1]);
      const heard=Reflect.get(window,'__repairStorm'),played=probe.sounds().event;
      for(const [name,count]of Object.entries(played))heard[name]=(heard[name]??0)+count;
      const telegraph=rig?.storm?.record('telegraph'),p=world.player.position;
      return {state:rig?.weather?.state??null,active:rig?.storm?.stormActive===true,age:telegraph?.age??null,away:telegraph===undefined?null:Math.hypot((telegraph.x??0)-p.x,(telegraph.z??0)-p.z),crackles:heard.lightningCrackle??0,titan:(Reflect.get(window,'__workerClientFights')?.()??[]).find(row=>row.id==='storm-titan')?.state??null};
    });
    await page.evaluate(()=>{
      const probe=Reflect.get(window,'__wildshard'),world=probe.requireWorld();
      probe.sounds(); Reflect.set(window,'__repairStorm',{});
      const y=Reflect.get(window,'__hf').heightAt(-105,212);world.player.link?.place?.(-105,y+0.4,212,0);
    });
    const before=await read();
    await page.evaluate(()=>{Reflect.get(window,'__workerClientSky')?.('storm');});
    // A telegraph record starts 1e6 s old and resets to 0 each time the server's row serial moves.
    let last=before,nearest=Infinity;
    for(let n=0;n<60&&last.crackles===0;n++) {
      await page.waitForTimeout(1000);
      last=await read();
      if(last.age!==null&&last.age<1e5&&last.away!==null)nearest=Math.min(nearest,last.away);
    }
    return {ok:before.crackles===0&&last.active&&nearest<160&&last.crackles>0&&last.titan!=='fight'&&errors.length===0,before,last,nearest:Math.round(nearest),errors:errors.slice(0,3)};
  } finally {await context.close();}
}
