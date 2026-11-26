import { equal, flatten, object } from './value.mjs';
import { advance, poseAt } from './frames.mjs';
import { touch, TOUCH } from './walk.mjs';

/** @typedef {{step:string,weapon:string,target:string,near:{x:number,z:number},distance:number,hit:number,kill:number|null,settleFrames?:number}} Step */
/** @type {Record<string,Step[]>} */
export const STEPS={
  'driftwood-isle':[{step:'swing',weapon:'sword',target:'crab',near:{x:-7,z:-143},distance:1.8,hit:3,kill:15}],
  'pine-hollow':[{step:'shot',weapon:'crossbow',target:'boar',near:{x:0,z:-200},distance:12,hit:20,kill:20},{step:'shot2',weapon:'bow',target:'boar',near:{x:0,z:-200},distance:12,hit:20,kill:20}],
  'nalati-grasslands':[{step:'swing',weapon:'sabre',target:'wolf',near:{x:0,z:232},distance:1.8,hit:3,kill:15},{step:'shot',weapon:'bow',target:'wolf',near:{x:0,z:232},distance:12,hit:20,kill:20}],
  'nine-dragon-stack':[{step:'swing',weapon:'sword',target:'training-dummy',near:{x:0,z:0},distance:1.8,hit:3,kill:null}],
};
/** Resolve the real weapon and target; the player's new XZ samples its own ground through probe.pose()/Player.spawn().
 * Copying the target's Y can put a distant firing position underneath a hillside.
 * @param {Step} s */
export function combatSetup(s) {
  const probe=window.__wildshard,p=probe.requireWorld().player;
  const weapon=probe.requireWorld().weapons.list.find((w)=>w.id===s.weapon);
  if(!weapon)throw new Error(`Scripted weapon absent: ${s.weapon}`);
  probe.requireWorld().weapons.unlock(weapon.id);probe.combat.equip(weapon.id);
  if(probe.requireWorld().weapons.current.id!==weapon.id)throw new Error(`Scripted equip failed: ${weapon.id}`);
  const target=probe.combat.target(s.target,s.near),at=target.position;
  let dx=p.position.x-at.x,dz=p.position.z-at.z;const len=Math.hypot(dx,dz);if(len<0.01){dx=0;dz=1;}else{dx/=len;dz/=len;}
  const cy=at.y+target.dims.bodyY*('scale' in target?target.scale:1);
  // Structure-first levels have a terrain datum below their built floors; retain that target floor's explicit Y.
  const floor=probe.requireWorld().game.level.ground.structures===true?{y:at.y}:{};
  return {pose:{x:at.x+dx*s.distance,z:at.z+dz*s.distance,...floor,yaw:Math.atan2(dx,dz)},aim:{x:at.x,y:cy,z:at.z}};
}
/** @param {import('playwright').Page} page @param {{shard:string,tier:string,lane:string}} opts */
export async function combat(page,opts) {
  if(opts.shard==='nine-dragon-stack'){await page.evaluate(()=>window.__wildshard.arena());await advance(page,2);}
  await page.evaluate(()=>window.__wildshard.sounds());
  /** @type {import('./value.mjs').RecordValue} */const result={swing:'n/a',shot:'n/a',shot2:'n/a',hitsToKill:{},kills:[],loot:{written:[]}};
  /** @type {string[]} */ const written=[];
  for(const step of STEPS[opts.shard] ?? []) {
    // A scenario may follow a live dash; finish it before sampling the target-relative aim pose.
    if(step.settleFrames)await advance(page,step.settleFrames);
    const setup=await page.evaluate(combatSetup,step);
    await poseAt(page,setup.pose);
    await advance(page,30); // land and settle the weapon switch, camera and input mode
    await page.evaluate((aim)=>{const p=window.__wildshard.requireWorld().player;const d=Math.hypot(p.position.x-aim.x,p.position.z-aim.z);p.pitch=Math.atan2(aim.y-(p.position.y+1.68),d);},setup.aim);
    await advance(page,2);
    const limits=await page.evaluate(()=>{const p=window.__wildshard;return {hits:p.combat.hits.length,kills:p.combat.kills.length,saves:p.saves.written.length,clock:p.state().clockNow,capture:window.__wildshardHarness?.capture!==null && window.__wildshardHarness?.capture!==undefined};});
    const multiplier=opts.lane==='gh-macos15' && !limits.capture ? 2 : 1,hitLimit=step.hit*multiplier,killLimit=step.kill===null?null:step.kill*multiplier;
    let hits=0,killed=false,hitWithinS=Number.POSITIVE_INFINITY,killWithinS=Number.POSITIVE_INFINITY;
    const wall=Date.now(),deadline=Math.max(hitLimit,killLimit??0);
    for(let attempt=0;attempt<Math.ceil(deadline*30);attempt++) {
      const hold=step.weapon==='bow'?1000:100;
      if(opts.tier==='phone')await touch(page,TOUCH.attack,{hold});
      else {const v=page.viewportSize();await page.mouse.move((v?.width??1600)/2,(v?.height??900)/2);await page.mouse.down();await advance(page,Math.ceil(hold*30/1000));await page.mouse.up();await advance(page,1);}
      await advance(page,15);
      // Crossbows fire only when their reload is ready, rather than repeated dry fires.
      for(let n=0;n<90 && await page.evaluate(()=>window.__wildshard.requireWorld().weapons.current.state.reloading);n++)await advance(page,1);
      const state=await page.evaluate((b)=>{const p=window.__wildshard;return {hits:p.combat.hits.length-b.hits,killed:p.combat.kills.length>b.kills,clock:p.state().clockNow-b.clock};},limits);
      const elapsed=limits.capture?state.clock:(Date.now()-wall)/1000;
      hits=state.hits;killed=state.killed;if(hits>0 && !Number.isFinite(hitWithinS))hitWithinS=elapsed;if(killed)killWithinS=elapsed;
      if(killed || (step.kill===null && hits>0) || elapsed>=deadline)break;
    }
    result[step.step]={weapon:step.weapon,target:step.target,hits,hitWithinS:Number.isFinite(hitWithinS)?hitWithinS:null,killed,killWithinS:Number.isFinite(killWithinS)?killWithinS:null,hitLimit,killLimit};
    object(result.hitsToKill)[step.step]=hits;
    if(killed){await advance(page,60);written.push(...await page.evaluate((n)=>window.__wildshard.saves.written.slice(n),limits.saves));}
  }
  result.kills=await page.evaluate(()=>[...window.__wildshard.combat.kills]);result.loot={written:[...new Set(written)].filter((key)=>key!=='session:ws.alive').sort()};result.sounds=object(await page.evaluate(()=>window.__wildshard.sounds()));
  return result;
}
/** @param {import('playwright').Page} page @param {string} tier */
export async function pauseResume(page,tier) {
  const returnState=await page.evaluate(()=>window.__wildshard.state().appState);
  await (tier==='phone'?touch(page,TOUCH.pause,{consume:false}):page.keyboard.press('Escape'));
  await page.locator('.ws-gmenu.show').waitFor({state:'visible'});
  const before=await page.evaluate(()=>{window.__parity.free=true;return window.__wildshard.state();});
  await page.evaluate(async()=>{const control=window.__parity;await (control.wait?control.wait(60):new Promise((resolve)=>{let remaining=60;const tick=()=>{if(--remaining===0)resolve(undefined);else control.rawRAF(tick);};control.rawRAF(tick);}));});
  await page.evaluate(()=>{window.__parity.free=false;});
  // Arm before input, but never await the callback before clicking RESUME.
  await page.evaluate(()=>{const w=/** @type {Window & {__parityResumed?:unknown}} */ (window);w.__parityResumed=null;window.__wildshard.onResume(()=>{w.__parityResumed=window.__wildshard.state();});});
  await (tier==='phone'?touch(page,'.ws-gmenu-close',{consume:false}):page.locator('.ws-gmenu-close').click());
  await page.waitForFunction(()=>Boolean(/** @type {Window & {__parityResumed?:unknown}} */ (window).__parityResumed));
  const after=await page.evaluate(()=>/** @type {Window & {__parityResumed?:unknown}} */ (window).__parityResumed);
  const a=flatten(before),b=flatten(after),diff=[...new Set([...Object.keys(a),...Object.keys(b)])].filter((p)=>p!=='appState' && !equal(a[p],b[p]));
  return {before,after,diff,appStates:[before.appState,object(after).appState],returnState};
}
