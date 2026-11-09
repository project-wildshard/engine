import {chromium,devices} from 'playwright';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {installInit} from '../parity/init.mjs';
import {poseAt,advance} from '../parity/frames.mjs';
import {developerSettings,saveFixture} from '../debug-settings.mjs';
import {loadingCardIndex} from '../loading-benchmark/catalogue.mjs';
import {installGpuProbe} from './gpu-census-page.mjs';
import {overdraw} from './gpu-census-overdraw.mjs';
import {gpuPairs,gpuPhoneModel} from './gpu-census-report.mjs';
import {graphCoverage,sourceMatchedCoverageAliases} from './gpu-census-coverage.mjs';
import { KEYCHAIN_ARGS } from '../chromium-keychain.mjs';

const nineIds=['cam-1','cam-5','cam-14','cam-27','approx-a','approx-b'];
const pineIds=['P1','P2','P3','P4'];
/** Pure selection: the CLI lends authored camera rows only after validating its
 * options. Importing or rejecting a request never reads omitted art files.
 * @param {string} slug @param {readonly string[]} selected
 * @param {readonly import('./gpu-census.mjs').GpuCensusCamera[]} [cameras] */
export function gpuCensusPoses(slug,selected,cameras=[]){
 const ids=slug==='nine-dragon-stack'?nineIds:slug==='pine-hollow'?pineIds:[];
 if(ids.length===0)throw new Error('Unsupported GPU census shard');
 if(selected.some(id=>!ids.includes(id)))throw new Error('Unknown requested census pose');
 const D=Math.PI/180;
 const pine=[{id:'P1',x:0,z:-235,yaw:Math.PI,pitch:0},{id:'P2',x:0,z:-200,yaw:Math.PI,pitch:0},{id:'P3',x:0,z:-28,yaw:Math.PI,pitch:0},{id:'P4',x:0,z:-28,yaw:Math.PI/2,pitch:-4*D}];
 if(slug==='pine-hollow')return pine.filter(pose=>selected.length===0||selected.includes(pose.id));
 const authored=[1,5,14].filter(n=>selected.length===0||selected.includes(`cam-${n}`)).map(n=>{
  const camera=cameras.find(row=>row.n===n),at=camera?.probe;
  if(camera===undefined||at===undefined||![at.x,at.y,at.z,at.yaw,at.pitch,camera.fov].every(Number.isFinite))throw new Error('Missing authored GPU census camera');
  return {x:at.x,y:at.y,z:at.z,yaw:at.yaw,pitch:at.pitch,id:`cam-${n}`,source:'art/legacy-goldens/compare/cameras24.json',fov:camera.fov};
 });
 const extra=[{id:'cam-27',x:74,y:146,z:6,yaw:.349066,pitch:.0349066,fov:93.01,source:'NF4 cameras-27.json / afed7029ce'},
 {id:'approx-a',x:.95,y:135,z:7.5,yaw:-12*D,pitch:-60*D,hover:true,source:'approx: phone2133-a + sp-o1 trial; not exact phone pose'},
 {id:'approx-b',x:.95,y:135,z:7.5,yaw:-12*D,pitch:-20*D,hover:true,source:'approx: phone2133-b shallower view; not exact phone pose'}];
 return [...authored,...extra].filter(pose=>selected.length===0||selected.includes(pose.id));
}
/** Modern GPU census entry: native loading cards, immutable preview, explicit modes. */
export async function runGpuCensus(){
const arg=(key,fallback)=>process.argv.find(s=>s.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const url=arg('url',''),out=arg('out','tmp/gpu-census'),slug=arg('chunk','nine-dragon-stack'),modes=arg('mode','shardfile').split(','),rounds=Number(arg('rounds','5')),K=Number(arg('frames','16'));
const requested=arg('poses',''),selected=requested===''?[]:requested.split(','),ids=slug==='nine-dragon-stack'?nineIds:pineIds;
if(selected.some(id=>!ids.includes(id)))throw new Error('Unknown requested census pose');
if(modes.includes('legacy'))throw new Error('The LEGACY census mode is gone (QD7 LD5); ENTER WORLD is the one entry');
if(!modes.every(x=>x==='shardfile'))throw new Error('Invalid pose/mode selection');
if(!['0','1'].includes(arg('coverage','0')))throw new Error('Invalid coverage capability');
const coverageHashPath=arg('coverage-source-hashes',''),coverageHashes=coverageHashPath===''?[]:JSON.parse(readFileSync(coverageHashPath,'utf8'));
sourceMatchedCoverageAliases([],coverageHashes);
if(!url||!['nine-dragon-stack','pine-hollow'].includes(slug)||!Number.isSafeInteger(rounds)||rounds<1||rounds>20||!Number.isSafeInteger(K)||K<1||K>64)throw new Error('Requires URL, supported shard and bounded rounds/frames');
const needsAuthored=slug==='nine-dragon-stack'&&(selected.length===0||selected.some(id=>['cam-1','cam-5','cam-14'].includes(id)));
const catalog=needsAuthored?JSON.parse(readFileSync('art/legacy-goldens/compare/cameras24.json','utf8')).cameras['nine-dragon-stack']:[];
const poses=gpuCensusPoses(slug,selected,catalog);
mkdirSync(out,{recursive:true});const version=await(await fetch(new URL('version.json',url))).json();
const readings=[],saveAll=()=>writeFileSync(`${out}/reading.json`,JSON.stringify({rows:readings,requested:{slug,modes,poses:poses.map(p=>p.id)},method:'paired frozen-frame throughput, includes CPU submission; no official timing credit',partitionStatus:'NOT_MEASURABLE (G872): overlapping subtraction, occlusion and tile flushes'},null,2));
const browser=await chromium.launch({headless:true,args:[...KEYCHAIN_ARGS, '--mute-audio','--use-angle=metal','--ignore-gpu-blocklist']});
const median=xs=>{const a=[...xs].sort((x,y)=>x-y);return a[Math.floor(a.length/2)];};
try{for(const mode of modes)for(const pose of poses){
 const context=await browser.newContext({...devices['iPhone 16 Pro'],viewport:{width:402,height:874},deviceScaleFactor:2});
 const row={build:version.build,slug,mode,pose,when:new Date().toISOString(),K,rounds,source:'frozen-frame throughput including CPU submission; fresh-write readPixels sync; no official phone GPU timing credit',errors:[]};
 readings.push(row);const file=`${out}/${slug}-${mode}-${pose.id}.json`,save=()=>{writeFileSync(file,JSON.stringify(row,null,2));saveAll();};
 try{
  await installInit(context,{lane:'sp-x8-g1',sha:version.build,browser:'chromium',capture:30,tier:'phone'});
  await developerSettings(context,{tier:'phone',volume:0,time:'night',weather:'rain'});
  await saveFixture(context,{scope:'global',key:'gfx',data:{dpr:'2',aa:'auto'}});
  const page=await context.newPage();const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});row.cpuRate=1;page.on('pageerror',e=>row.errors.push(e.message));
  await page.goto(url,{waitUntil:'load'});await page.locator('.ws-main-select').click();const names=await page.locator('.ws-menu-card b').allTextContents();await page.locator(`.ws-menu-dots i[data-i="${loadingCardIndex(names,slug)}"]`).click();
  const enter=page.locator('.ws-menu-play');if(await enter.isDisabled())throw new Error('ENTER WORLD disabled');await enter.click();
  await page.waitForFunction(()=>window.__wildshard?.world?.hud?.entered&&!document.querySelector('.ws-load'),undefined,{timeout:240000});
  await poseAt(page,pose);if(pose.hover)await page.evaluate(()=>window.__wildshard.world.player.setHover(true));await poseAt(page,pose);await advance(page,90);await poseAt(page,pose);
  await page.evaluate(()=>{window.__wildshard.world.game.frameGate=()=>false;});row.environment=await page.evaluate(installGpuProbe);save();
  if(row.environment.buffer[0]!==804||row.environment.buffer[1]!==1748||!/Metal/i.test(row.environment.renderer))throw new Error('Requires actual Metal 804x1748 buffer');
  const inventory=await page.evaluate(()=>window.__gpuCensus.batch('inventory',1));
  for(const material of inventory.materials){if(material.fragmentShader){material.fragmentShaderHash=createHash('sha256').update(material.fragmentShader).digest('hex');delete material.fragmentShader;}}
  row.inventory=inventory;
  const samples=[];for(let round=0;round<rounds;round++)samples.push(await page.evaluate(k=>window.__gpuCensus.batch('throughput',k),K));
  row.samples=samples;row.whole=median(samples.map(x=>x.whole));row.cpu=median(samples.map(x=>x.cpu));
  row.subtract=[];
  const variants=arg('subtract','1')==='0'?[]:['none','shadow','depthcopy','silhouette','jiehua','alpha-tested',...['rain-streaks','canopy-cards','crowd-umbrellas','facades-slabs','neon-signs-glyphs','lanterns','wet-reflection','movers','viewmodel','terrain','sky','other'].map(name=>`group:${name}`),...row.environment.passes.filter(p=>p.index>0).map(p=>`pass:${p.index}`),...row.environment.passes.flatMap(p=>p.effects.map((name,index)=>`effect:${p.index}:${index}`))];
  for(const variant of variants){const pairs=[];for(let i=0;i<rounds;i++){const baseline=await page.evaluate(k=>window.__gpuCensus.batch('throughput',k),K),off=await page.evaluate(([k,v])=>window.__gpuCensus.batch('throughput',k,v),[K,variant]);pairs.push({baseline:baseline.whole,off:off.whole,baselineCpu:baseline.cpu,offCpu:off.cpu});}const submittedDraws=variant.startsWith('group:')?inventory.materials.filter(m=>m.groups.includes(variant)).reduce((n,m)=>n+m.draws,0):null;row.subtract.push({variant,submittedDraws,...gpuPairs(pairs)});save();}
  row.baselineEnd=await page.evaluate(k=>window.__gpuCensus.batch('throughput',k),K);
  if(arg('overdraw','0')==='1')row.overdraw=await page.evaluate(overdraw,false);
  if(arg('coverage','0')==='1'){
   const before=await page.evaluateHandle(()=>{const g=window.__wildshard.requireWorld().game,r=g.renderer,gl=r.getContext();g.composer.render(0);const bytes=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return bytes;});
   try{
    row.graphCoverage=await page.evaluate(graphCoverage,sourceMatchedCoverageAliases(inventory.materials,coverageHashes));
    for(const fact of row.graphCoverage.rows)fact.fragmentShaderHashes=[...new Set(inventory.materials.filter(m=>m.name===fact.alias).map(m=>m.fragmentShaderHash).filter(Boolean))];
    row.coverageRestoration=await page.evaluate(beforePixels=>{const g=window.__wildshard.requireWorld().game,r=g.renderer,gl=r.getContext();g.composer.render(0);const bytes=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,bytes);const first=[];let pixels=0,max=0;for(let i=0;i<bytes.length;i+=4){let bad=false;for(let c=0;c<4;c++){const d=Math.abs(bytes[i+c]-beforePixels[i+c]);if(d>0)bad=true;max=Math.max(max,d);}if(bad){pixels++;if(first.length<20)first.push([i/4%gl.drawingBufferWidth,Math.floor(i/4/gl.drawingBufferWidth)]);}}return{pixels,max,first};},before);
    if(row.coverageRestoration.pixels>0)throw new Error('Coverage material restoration changed native pixels');
   }finally{await before.dispose();}
  }
  row.top5=[...row.subtract].sort((a,b)=>b.saved-a.saved).slice(0,5);row.complete=row.errors.length===0;row.calibration=slug==='nine-dragon-stack'&&mode==='shardfile'&&pose.id==='approx-a'?gpuPhoneModel(row.whole,79):null;row.partitionStatus='NOT_MEASURABLE (G872): overlapping subtraction, occlusion and tile flushes; no additive sum credit';save();console.log(JSON.stringify({pose:pose.id,mode,throughputMs:row.whole,cpuMs:row.cpu,top5:row.top5.map(x=>[x.variant,x.saved])}));
  await page.evaluate(()=>window.__gpuCensus.restore());
 }catch(e){row.error=e.stack;row.complete=false;save();console.error(pose.id,mode,e.message);throw e;}finally{await context.close();}
}}finally{await browser.close();}

}
